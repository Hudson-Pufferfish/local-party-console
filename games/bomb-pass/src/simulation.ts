import {
  clampRadialBoundary,
  integrateMotion,
  resolveCircleBufferPairs,
  type CircleBufferPairHooks,
  type CirclePairModifier,
  type PhysicsBody2D,
} from '../../../shared/src/physics-2d/index.ts';
import {
  BOMB_CONSTANTS as C,
  BOMB_FLAG_ALIVE,
  BOMB_FLAG_DISCONNECTED,
  BOMB_FLAG_EXPLODED,
  BOMB_FLAG_HOLDING,
  BOMB_FLAG_SD_CONTENDER,
  BOMB_HEADER as H,
  BOMB_PHASE as P,
  BOMB_PLAYER_BASE as PLAYER,
  BOMB_PLAYER_STRIDE as STRIDE,
  BOMB_ROUND_FLAG as RF,
} from './constants.ts';

const OFFSCREEN = 10000;
const MIN_DIST = C.puckRadius * 2;
const MIN_DIST_SQ = MIN_DIST * MIN_DIST;
const BLAST_RADIUS_SQ = C.blastRadius * C.blastRadius;
const DIST_TIE_EPS = 1e-4;
const SPEED_TIE_EPS = 1e-6;

interface Channel {
  axisX: number;
  axisY: number;
  buttons: number;
  edge: number;
}

export interface BombPassSimulation {
  readonly state: Float32Array;
  applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void;
  step(dt: number): void;
  startMatch(slots: number[], seed?: number): void;
  setConnectedMask(mask: number): void;
}

function createChannel(): Channel {
  return { axisX: 0, axisY: 0, buttons: 0, edge: 0 };
}

function targetScoreForJoined(count: number): number {
  const scaled = (count - 1) * C.targetMultiplier;
  return scaled > C.minTargetScore ? scaled : C.minTargetScore;
}

export function createBombPassSimulation(): BombPassSimulation {
  const state = new Float32Array(C.stateFloats);
  const joined = new Uint8Array(C.maxPlayers);
  const spawnOrder = new Int8Array(C.maxPlayers);
  const eliminatedTick = new Int32Array(C.maxPlayers);
  const sdContenders = new Uint8Array(C.maxPlayers);
  const pickPool = new Int8Array(C.maxPlayers);
  const inputs: Channel[] = [
    createChannel(),
    createChannel(),
    createChannel(),
    createChannel(),
    createChannel(),
    createChannel(),
    createChannel(),
    createChannel(),
  ];
  const scratchBody: PhysicsBody2D = { x: 0, y: 0, vx: 0, vy: 0 };

  let joinedCount = 0;
  let matchTarget: number = C.minTargetScore;
  let roundTick = 0;
  let connectedMask = 0xff;
  let prevConnectedMask = 0xff;
  let rngState = C.defaultSeed >>> 0;

  // Scalar scratch for single-transfer-per-tick resolution (zero heap allocation)
  let candSlot = -1;
  let candDistSq = 0;
  let candCloseSpeed = 0;
  let activeHolderAtPair = -1;

  const pairHooks: CircleBufferPairHooks = {
    isActive: (slot: number): boolean => (state[PLAYER + slot * STRIDE + 8] & BOMB_FLAG_ALIVE) !== 0,
    onImpact: (i: number, j: number, modifier: CirclePairModifier): void => {
      if (candSlot < 0 || activeHolderAtPair < 0) return;
      if (
        (i === activeHolderAtPair && j === candSlot)
        || (j === activeHolderAtPair && i === candSlot)
      ) {
        modifier.scaleI = C.transferRecoilScale;
        modifier.scaleJ = C.transferRecoilScale;
      }
    },
  };

  eliminatedTick.fill(-1);

  function nextRandom(): number {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let z = rngState;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  function maxScore(): number {
    let best = 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const sc = state[PLAYER + i * STRIDE + 9];
      if (sc > best) best = sc;
    }
    return best;
  }

  function leaderCount(top: number): number {
    if (top <= 0) return 0;
    let count = 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      if (state[PLAYER + i * STRIDE + 9] === top) count += 1;
    }
    return count;
  }

  function hasUniqueWinnerNow(): boolean {
    const top = maxScore();
    return top >= matchTarget && leaderCount(top) === 1;
  }

  function isMatchSuddenDeathNow(): boolean {
    const top = maxScore();
    return top >= matchTarget && leaderCount(top) > 1;
  }

  function syncDisconnectedFlags(): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const base = PLAYER + i * STRIDE;
      let flags = state[base + 8] | 0;
      if ((connectedMask & (1 << i)) === 0) {
        flags |= BOMB_FLAG_DISCONNECTED;
      } else {
        flags &= ~BOMB_FLAG_DISCONNECTED;
      }
      state[base + 8] = flags;
    }
  }

  function syncBombFlags(): void {
    const holder = state[H.bombHolder] | 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      let flags = state[base + 8] | 0;
      if (i === holder && (flags & BOMB_FLAG_ALIVE) !== 0) {
        flags |= BOMB_FLAG_HOLDING;
      } else {
        flags &= ~BOMB_FLAG_HOLDING;
      }
      state[base + 8] = flags;
    }
  }

  function clearBomb(): void {
    state[H.bombHolder] = -1;
    state[H.bombTimer] = 0;
    state[H.transferCooldown] = 0;
    syncBombFlags();
  }

  function parkNonContender(slot: number): void {
    inputs[slot].edge = 0;
    const base = PLAYER + slot * STRIDE;
    state[base] = OFFSCREEN;
    state[base + 1] = OFFSCREEN;
    state[base + 2] = 0;
    state[base + 3] = 0;
    state[base + 5] = 0;
    state[base + 6] = 0;
    state[base + 7] = 0;
    let flags = 0;
    if ((connectedMask & (1 << slot)) === 0) flags |= BOMB_FLAG_DISCONNECTED;
    state[base + 8] = flags;
  }

  function isContenderForSpawn(slot: number, roundSD: boolean, matchSD: boolean, topScore: number): boolean {
    if (roundSD) return sdContenders[slot] === 1;
    if (matchSD) return state[PLAYER + slot * STRIDE + 9] === topScore;
    return true;
  }

  function placeSpawn(keepAngle: boolean): void {
    const rFlags = state[H.roundFlags] | 0;
    const roundSD = (rFlags & RF.roundSuddenDeath) !== 0;
    const matchSD = !roundSD && ((rFlags & RF.matchSuddenDeath) !== 0 || isMatchSuddenDeathNow());
    const topScore = matchSD ? maxScore() : 0;

    let count = 0;
    for (let i = 0; i < joinedCount; i += 1) {
      const slot = spawnOrder[i];
      if (isContenderForSpawn(slot, roundSD, matchSD, topScore)) count += 1;
    }
    if (count === 0) return;

    let placed = 0;
    for (let i = 0; i < joinedCount; i += 1) {
      const slot = spawnOrder[i];
      const base = PLAYER + slot * STRIDE;
      if (!isContenderForSpawn(slot, roundSD, matchSD, topScore)) {
        parkNonContender(slot);
        continue;
      }
      const theta = (Math.PI * 2 * placed) / count;
      state[base] = C.rSpawn * Math.cos(theta);
      state[base + 1] = C.rSpawn * Math.sin(theta);
      state[base + 2] = 0;
      state[base + 3] = 0;
      if (!keepAngle) {
        state[base + 4] = theta + Math.PI;
      }
      let flags = BOMB_FLAG_ALIVE;
      if (roundSD) flags |= BOMB_FLAG_SD_CONTENDER;
      if ((connectedMask & (1 << slot)) === 0) flags |= BOMB_FLAG_DISCONNECTED;
      state[base + 8] = flags;
      placed += 1;
    }
  }

  function resetBodies(): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      inputs[i].edge = 0;
      const base = PLAYER + i * STRIDE;
      state[base] = 0;
      state[base + 1] = 0;
      state[base + 2] = 0;
      state[base + 3] = 0;
      state[base + 4] = 0;
      state[base + 5] = 0;
      state[base + 6] = 0;
      state[base + 7] = 0;
      state[base + 8] = 0;
    }
  }

  function clampPuckInside(base: number, bounce: number): void {
    scratchBody.x = state[base];
    scratchBody.y = state[base + 1];
    scratchBody.vx = state[base + 2];
    scratchBody.vy = state[base + 3];
    if (clampRadialBoundary(scratchBody, C.arenaRadius, C.puckRadius, bounce)) {
      state[base] = scratchBody.x;
      state[base + 1] = scratchBody.y;
      state[base + 2] = scratchBody.vx;
      state[base + 3] = scratchBody.vy;
    }
  }

  function clampAllAlive(): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      if ((state[base + 8] & BOMB_FLAG_ALIVE) === 0) continue;
      clampPuckInside(base, C.wallBounce);
    }
  }

  function reviveForBreak(): void {
    const rFlags = state[H.roundFlags] | 0;
    const matchSD = (rFlags & RF.matchSuddenDeath) !== 0 || isMatchSuddenDeathNow();
    const topScore = matchSD ? maxScore() : 0;

    let count = 0;
    for (let i = 0; i < joinedCount; i += 1) {
      const slot = spawnOrder[i];
      if (!matchSD || state[PLAYER + slot * STRIDE + 9] === topScore) count += 1;
    }
    let placed = 0;
    for (let i = 0; i < joinedCount; i += 1) {
      const slot = spawnOrder[i];
      const base = PLAYER + slot * STRIDE;
      if (matchSD && state[base + 9] !== topScore) {
        parkNonContender(slot);
        continue;
      }
      inputs[slot].edge = 0;
      const wasAlive = (state[base + 8] & BOMB_FLAG_ALIVE) !== 0;
      const theta = count > 0 ? (Math.PI * 2 * placed) / count : 0;
      if (!wasAlive) {
        state[base] = C.rSpawn * Math.cos(theta);
        state[base + 1] = C.rSpawn * Math.sin(theta);
        state[base + 2] = 0;
        state[base + 3] = 0;
        state[base + 4] = theta + Math.PI;
      }
      state[base + 6] = 0;
      state[base + 7] = 0;
      let flags = BOMB_FLAG_ALIVE;
      if ((connectedMask & (1 << slot)) === 0) flags |= BOMB_FLAG_DISCONNECTED;
      state[base + 8] = flags;
      clampPuckInside(base, 0);
      placed += 1;
    }
  }

  function beginPractice(opening: boolean): void {
    state[H.phase] = P.practice;
    state[H.phaseTimer] = opening ? C.practiceInitial : C.practiceBreak;
    state[H.arenaRadius] = C.arenaRadius;
    clearBomb();
    if (opening) {
      resetBodies();
      placeSpawn(false);
    } else {
      reviveForBreak();
    }
  }

  function beginCountdown(): void {
    const rFlags = state[H.roundFlags] | 0;
    const roundSD = (rFlags & RF.roundSuddenDeath) !== 0;
    state[H.phase] = P.countdown;
    state[H.phaseTimer] = C.countdown;
    state[H.arenaRadius] = C.arenaRadius;
    clearBomb();
    if (roundSD) {
      for (let i = 0; i < C.maxPlayers; i += 1) {
        if (sdContenders[i] === 1) eliminatedTick[i] = -1;
      }
    } else {
      eliminatedTick.fill(-1);
      sdContenders.fill(0);
      roundTick = 0;
    }
    resetBodies();
    placeSpawn(false);
  }

  function armBomb(): void {
    let count = 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const flags = state[PLAYER + i * STRIDE + 8] | 0;
      if ((flags & BOMB_FLAG_ALIVE) === 0) continue;
      pickPool[count] = i;
      count += 1;
    }
    if (count === 0) {
      clearBomb();
      return;
    }
    let idx = Math.floor(nextRandom() * count);
    if (idx < 0) idx = 0;
    if (idx >= count) idx = count - 1;
    const chosen = pickPool[idx];
    const roundSD = ((state[H.roundFlags] | 0) & RF.roundSuddenDeath) !== 0;
    state[H.bombHolder] = chosen;
    state[H.bombTimer] = roundSD ? C.suddenDeathFuse : C.fuseDuration;
    state[H.transferCooldown] = 0;
    syncBombFlags();
  }

  function tryDisconnectAutoPass(): void {
    const holder = state[H.bombHolder] | 0;
    if (holder < 0) return;
    const holderDisconnectedNow =
      (connectedMask & (1 << holder)) === 0 && (prevConnectedMask & (1 << holder)) !== 0;
    if (!holderDisconnectedNow) return;

    const baseH = PLAYER + holder * STRIDE;
    const hx = state[baseH];
    const hy = state[baseH + 1];

    let bestSlot = -1;
    let bestDistSq = Infinity;
    let foundConnected = false;

    for (let j = 0; j < C.maxPlayers; j += 1) {
      if (j === holder) continue;
      const baseJ = PLAYER + j * STRIDE;
      if ((state[baseJ + 8] & BOMB_FLAG_ALIVE) === 0) continue;
      const isConn = (connectedMask & (1 << j)) !== 0;
      if (foundConnected && !isConn) continue;

      const dx = state[baseJ] - hx;
      const dy = state[baseJ + 1] - hy;
      const distSq = dx * dx + dy * dy;

      if (isConn && !foundConnected) {
        foundConnected = true;
        bestSlot = j;
        bestDistSq = distSq;
      } else if (bestSlot < 0 || distSq < bestDistSq - DIST_TIE_EPS) {
        bestSlot = j;
        bestDistSq = distSq;
      }
    }

    if (bestSlot < 0) return;
    state[H.bombHolder] = bestSlot;
    state[H.transferCooldown] = C.transferCooldown;
    state[PLAYER + bestSlot * STRIDE + 7] = C.transferCooldown;
    if (state[H.bombTimer] < C.disconnectFuseFloor) {
      state[H.bombTimer] = C.disconnectFuseFloor;
    }
    syncBombFlags();
  }

  function scanTransferCandidate(): void {
    candSlot = -1;
    candDistSq = Infinity;
    candCloseSpeed = -Infinity;
    const holder = state[H.bombHolder] | 0;
    activeHolderAtPair = holder;
    if (holder < 0 || state[H.transferCooldown] > 0) return;

    const baseH = PLAYER + holder * STRIDE;
    if ((state[baseH + 8] & BOMB_FLAG_ALIVE) === 0) return;
    const hx = state[baseH];
    const hy = state[baseH + 1];
    const hvx = state[baseH + 2];
    const hvy = state[baseH + 3];

    for (let j = 0; j < C.maxPlayers; j += 1) {
      if (j === holder) continue;
      const baseJ = PLAYER + j * STRIDE;
      if ((state[baseJ + 8] & BOMB_FLAG_ALIVE) === 0) continue;
      const dx = state[baseJ] - hx;
      const dy = state[baseJ + 1] - hy;
      const distSq = dx * dx + dy * dy;
      if (distSq >= MIN_DIST_SQ) continue;

      let nx = 1;
      let ny = 0;
      if (distSq > 0) {
        const dist = Math.sqrt(distSq);
        nx = dx / dist;
        ny = dy / dist;
      } else {
        const minSlot = holder < j ? holder : j;
        nx = Math.cos(minSlot);
        ny = Math.sin(minSlot);
        if (j < holder) {
          nx = -nx;
          ny = -ny;
        }
      }
      const closeSpeed = -((state[baseJ + 2] - hvx) * nx + (state[baseJ + 3] - hvy) * ny);

      let take = false;
      if (candSlot < 0) {
        take = true;
      } else if (distSq < candDistSq - DIST_TIE_EPS) {
        take = true;
      } else if (Math.abs(distSq - candDistSq) <= DIST_TIE_EPS) {
        if (closeSpeed > candCloseSpeed + SPEED_TIE_EPS) {
          take = true;
        } else if (Math.abs(closeSpeed - candCloseSpeed) <= SPEED_TIE_EPS && j < candSlot) {
          take = true;
        }
      }

      if (take) {
        candSlot = j;
        candDistSq = distSq;
        candCloseSpeed = closeSpeed;
      }
    }
  }

  function commitTransfer(): void {
    if (candSlot < 0) return;
    state[H.bombHolder] = candSlot;
    state[H.transferCooldown] = C.transferCooldown;
    state[PLAYER + candSlot * STRIDE + 7] = C.transferCooldown;
    syncBombFlags();
  }

  function awardRoundPoints(): void {
    if (joinedCount < 2) return;
    const matchSD = ((state[H.roundFlags] | 0) & RF.matchSuddenDeath) !== 0 || isMatchSuddenDeathNow();
    if (matchSD) {
      const top = maxScore();
      for (let i = 0; i < C.maxPlayers; i += 1) {
        if (joined[i] === 0) continue;
        const baseI = PLAYER + i * STRIDE;
        if ((state[baseI + 8] & BOMB_FLAG_ALIVE) !== 0 && state[baseI + 9] === top) {
          state[baseI + 9] += 1;
        }
      }
      return;
    }

    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const baseI = PLAYER + i * STRIDE;
      let better = 0;
      if ((state[baseI + 8] & BOMB_FLAG_ALIVE) === 0) {
        const tickI = eliminatedTick[i];
        for (let j = 0; j < C.maxPlayers; j += 1) {
          if (joined[j] === 0 || j === i) continue;
          const aliveJ = (state[PLAYER + j * STRIDE + 8] & BOMB_FLAG_ALIVE) !== 0;
          if (aliveJ || eliminatedTick[j] > tickI) {
            better += 1;
          }
        }
      }
      const points = joinedCount - 1 - better;
      if (points > 0) {
        state[baseI + 9] += points;
      }
    }
  }

  function detonateBomb(): void {
    const holder = state[H.bombHolder] | 0;
    if (holder < 0) return;

    const baseH = PLAYER + holder * STRIDE;
    const bx = state[baseH];
    const by = state[baseH + 1];

    // Eliminate holder and any ALIVE puck inside point-blank blast radius
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      const flags = state[base + 8] | 0;
      if ((flags & BOMB_FLAG_ALIVE) === 0) continue;
      const dx = state[base] - bx;
      const dy = state[base + 1] - by;
      if (i !== holder && dx * dx + dy * dy > BLAST_RADIUS_SQ) continue;

      let nextFlags = (flags & ~(BOMB_FLAG_ALIVE | BOMB_FLAG_HOLDING)) | BOMB_FLAG_EXPLODED;
      state[base + 8] = nextFlags;
      state[base + 2] = 0;
      state[base + 3] = 0;
      state[base + 6] = 0;
      state[base + 7] = C.blastBreather;
      eliminatedTick[i] = roundTick;
    }

    clearBomb();

    let aliveCount = 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if ((state[PLAYER + i * STRIDE + 8] & BOMB_FLAG_ALIVE) !== 0) aliveCount += 1;
    }

    if (aliveCount >= 2) {
      state[H.phaseTimer] = C.blastBreather;
      return;
    }

    if (aliveCount === 1) {
      // Clear ROUND_SUDDEN_DEATH before scoring
      let rFlags = (state[H.roundFlags] | 0) & ~RF.roundSuddenDeath;
      state[H.roundFlags] = rFlags;
      sdContenders.fill(0);
      awardRoundPoints();
      if (isMatchSuddenDeathNow()) {
        rFlags |= RF.matchSuddenDeath;
      } else {
        rFlags &= ~RF.matchSuddenDeath;
      }
      state[H.roundFlags] = rFlags;
      state[H.phase] = P.roundEnd;
      state[H.phaseTimer] = (rFlags & RF.matchSuddenDeath) !== 0
        ? C.roundEndSuddenDeath
        : C.roundEnd;
      return;
    }

    // aliveCount === 0 -> simultaneous final-survivor wipe -> ROUND_SUDDEN_DEATH
    sdContenders.fill(0);
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      let flags = state[base + 8] | 0;
      if (eliminatedTick[i] === roundTick) {
        sdContenders[i] = 1;
        flags |= BOMB_FLAG_SD_CONTENDER;
      } else {
        flags &= ~BOMB_FLAG_SD_CONTENDER;
      }
      state[base + 8] = flags;
    }
    state[H.roundFlags] = (state[H.roundFlags] | 0) | RF.roundSuddenDeath;
    state[H.phase] = P.roundEnd;
    state[H.phaseTimer] = C.roundEndSuddenDeath;
  }

  function decrementPlayerTimers(dt: number): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      let cool = state[base + 5] - dt;
      if (cool < 0) cool = 0;
      else if (cool > C.dashCooldown) cool = C.dashCooldown;

      let active = state[base + 6] - dt;
      if (active < 0) active = 0;
      else if (active > C.dashActive) active = C.dashActive;

      let effect = state[base + 7] - dt;
      if (effect < 0) effect = 0;
      else if (effect > C.blastBreather) effect = C.blastBreather;

      state[base + 5] = cool;
      state[base + 6] = active;
      state[base + 7] = effect;
    }
  }

  function simulateMotion(dt: number, allowTransfer: boolean): void {
    const holder = state[H.bombHolder] | 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      const channel = inputs[i];
      if ((state[base + 8] & BOMB_FLAG_ALIVE) === 0) {
        channel.edge = 0;
        continue;
      }
      const isDisconnected = (connectedMask & (1 << i)) === 0;
      const axisX = isDisconnected ? 0 : channel.axisX;
      const axisY = isDisconnected ? 0 : channel.axisY;
      if (isDisconnected) channel.edge = 0;

      const steer = state[base + 6] > 0 ? C.steerDash : 1;
      scratchBody.x = state[base];
      scratchBody.y = state[base + 1];
      scratchBody.vx = state[base + 2] + C.aMove * steer * axisX * dt;
      scratchBody.vy = state[base + 3] + C.aMove * steer * axisY * dt;
      integrateMotion(scratchBody, dt, C.mu);
      state[base] = scratchBody.x;
      state[base + 1] = scratchBody.y;
      let vx = scratchBody.vx;
      let vy = scratchBody.vy;

      let angle = state[base + 4];
      if (axisX !== 0 || axisY !== 0) {
        const target = Math.atan2(axisY, axisX);
        let delta = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
        const maxTurn = C.angleBlend * dt;
        if (delta > maxTurn) delta = maxTurn;
        else if (delta < -maxTurn) delta = -maxTurn;
        angle += delta;
      }

      if (channel.edge === 1) {
        channel.edge = 0;
        if (state[base + 5] <= 0) {
          let dx = Math.cos(angle);
          let dy = Math.sin(angle);
          const mag = Math.hypot(axisX, axisY);
          if (mag > 0) {
            dx = axisX / mag;
            dy = axisY / mag;
          }
          const parallel = vx * dx + vy * dy;
          vx = vx - parallel * dx + C.dashSpeed * dx;
          vy = vy - parallel * dy + C.dashSpeed * dy;
          state[base + 6] = C.dashActive;
          state[base + 5] = C.dashCooldown;
        }
      }

      if (state[base + 6] <= 0) {
        const maxSpeed = i === holder ? C.vMaxHolder : C.vMax;
        const speed = Math.hypot(vx, vy);
        if (speed > maxSpeed) {
          const scale = maxSpeed / speed;
          vx *= scale;
          vy *= scale;
        }
      }

      state[base + 2] = vx;
      state[base + 3] = vy;
      state[base + 4] = angle;
    }

    if (allowTransfer) {
      scanTransferCandidate();
    } else {
      candSlot = -1;
      activeHolderAtPair = -1;
    }

    resolveCircleBufferPairs(
      state,
      C.maxPlayers,
      STRIDE,
      PLAYER,
      PLAYER + 2,
      C.puckRadius,
      C.restitution,
      pairHooks,
    );

    if (allowTransfer) {
      commitTransfer();
    }

    clampAllAlive();
  }

  function startMatch(slots: number[], seed?: number): void {
    joinedCount = 0;
    joined.fill(0);
    spawnOrder.fill(-1);
    eliminatedTick.fill(-1);
    sdContenders.fill(0);
    roundTick = 0;
    rngState = ((seed ?? C.defaultSeed) >>> 0);
    let initialConnected = 0;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      if (slot !== (slot | 0) || slot < 0 || slot >= C.maxPlayers || joined[slot] === 1) continue;
      joined[slot] = 1;
      spawnOrder[joinedCount] = slot;
      joinedCount += 1;
      initialConnected |= 1 << slot;
    }
    connectedMask = initialConnected;
    matchTarget = targetScoreForJoined(joinedCount);
    for (let i = 0; i < C.maxPlayers; i += 1) {
      inputs[i].axisX = 0;
      inputs[i].axisY = 0;
      inputs[i].buttons = 0;
      inputs[i].edge = 0;
    }
    state.fill(0);
    state[H.arenaRadius] = C.arenaRadius;
    state[H.bombHolder] = -1;
    beginPractice(true);
  }

  function setConnectedMask(mask: number): void {
    connectedMask = mask & 0xff;
    syncDisconnectedFlags();
  }

  function applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void {
    if (playerIndex !== (playerIndex | 0) || playerIndex < 0 || playerIndex >= C.maxPlayers) {
      return;
    }
    if (joined[playerIndex] === 0) return;

    const phase = state[H.phase];
    if (phase === P.roundEnd || phase === P.matchOver) return;

    const base = PLAYER + playerIndex * STRIDE;
    if ((state[base + 8] & BOMB_FLAG_ALIVE) === 0) return;

    let x = axisX / 127;
    let y = axisY / 127;
    if (Math.hypot(x, y) < C.deadzone) {
      x = 0;
      y = 0;
    }
    const channel = inputs[playerIndex];

    if (phase === P.countdown) {
      channel.axisX = x;
      channel.axisY = y;
      channel.buttons = buttons;
      channel.edge = 0;
      if (x !== 0 || y !== 0) {
        state[base + 4] = Math.atan2(y, x);
      }
      return;
    }

    if (phase !== P.active && phase !== P.practice) return;

    if ((buttons & 1) !== 0 && (channel.buttons & 1) === 0) {
      channel.edge = 1;
    }
    channel.buttons = buttons;
    channel.axisX = x;
    channel.axisY = y;
  }

  function step(dt: number): void {
    state[H.tick] += 1;
    state[H.arenaRadius] = C.arenaRadius;
    syncDisconnectedFlags();

    const phase = state[H.phase];
    if (phase === P.countdown) {
      placeSpawn(true);
      state[H.phaseTimer] -= dt;
      if (state[H.phaseTimer] <= 0) {
        state[H.phase] = P.active;
        state[H.phaseTimer] = 0;
        armBomb();
      }
      return;
    }

    if (phase === P.roundEnd) {
      decrementPlayerTimers(dt);
      state[H.phaseTimer] -= dt;
      if (state[H.phaseTimer] <= 0) {
        const roundSD = ((state[H.roundFlags] | 0) & RF.roundSuddenDeath) !== 0;
        if (roundSD) {
          beginCountdown();
        } else if (hasUniqueWinnerNow()) {
          state[H.phase] = P.matchOver;
          state[H.phaseTimer] = 0;
          clearBomb();
        } else {
          beginPractice(false);
        }
      }
      return;
    }

    if (phase === P.practice) {
      decrementPlayerTimers(dt);
      simulateMotion(dt, false);
      state[H.phaseTimer] -= dt;
      if (state[H.phaseTimer] <= 0) {
        beginCountdown();
      }
      return;
    }

    if (phase !== P.active) return;

    roundTick += 1;
    decrementPlayerTimers(dt);

    // Decrement transfer cooldown
    let tc = state[H.transferCooldown] - dt;
    if (tc < 0) tc = 0;
    else if (tc > C.transferCooldown) tc = C.transferCooldown;
    state[H.transferCooldown] = tc;

    // Update fuse or blast breather timer
    if ((state[H.bombHolder] | 0) >= 0) {
      state[H.phaseTimer] += dt;
      let bt = state[H.bombTimer] - dt;
      if (bt < 0) bt = 0;
      else if (bt > C.fuseDuration) bt = C.fuseDuration;
      state[H.bombTimer] = bt;
    } else {
      let breather = state[H.phaseTimer] - dt;
      if (breather < 0) breather = 0;
      state[H.phaseTimer] = breather;
    }

    // Disconnect auto-pass (FR-5 #3) before motion & detonation
    tryDisconnectAutoPass();
    prevConnectedMask = connectedMask;

    // Physics, dash, elastic collisions, transfer candidate & boundary containment
    simulateMotion(dt, true);

    // Explosion or post-breather re-arm
    const holderAfter = state[H.bombHolder] | 0;
    if (holderAfter >= 0 && state[H.bombTimer] <= 0) {
      detonateBomb();
    } else if (holderAfter < 0 && state[H.phaseTimer] <= 0) {
      armBomb();
    }
  }

  return { state, applyInput, step, startMatch, setConnectedMask };
}
