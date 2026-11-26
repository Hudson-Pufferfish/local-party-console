import {
  clampBoxBoundary,
  integrateMotion,
  resolveCircleBufferPairs,
  type CircleBufferPairHooks,
  type CirclePairModifier,
  type PhysicsBody2D,
} from '../../../shared/src/physics-2d';
import {
  COLOR_CLASH_CONSTANTS as C,
  FLAG_ACTIVE,
  FLAG_BOOSTING,
  FLAG_CONTENDER,
  PHASE_COUNTDOWN,
  PHASE_MATCH_OVER,
  PHASE_OVERTIME,
  PHASE_PRACTICE,
  PHASE_ROUND_ACTIVE,
  PHASE_ROUND_END,
} from './constants';
import { hasUniqueWinner, isSuddenDeath, maxScoreForState, targetScoreForCount } from './scoreboard';

const TICK = 0;
const PHASE = 1;
const TIMER = 2;
const ARENA = 3;
const GOLDEN = 4;
const MASK = 5;
const HIT = 6;
const WINNER = 7;
const PLAYER = 8;
const STRIDE = 10;
const OFFSCREEN = 10000;

interface Channel {
  axisX: number;
  axisY: number;
  buttons: number;
  edge: number;
}

export interface ColorClashSimulation {
  readonly state: Float32Array;
  readonly auxState: Uint8Array;
  applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void;
  step(dt: number): void;
  startMatch(slots: number[]): void;
}

function createChannel(): Channel {
  return { axisX: 0, axisY: 0, buttons: 0, edge: 0 };
}

export function createColorClashSimulation(): ColorClashSimulation {
  const state = new Float32Array(C.stateFloats);
  const auxState = new Uint8Array(C.gridCells);
  const joined = new Uint8Array(C.maxPlayers);
  const spawnOrder = new Int8Array(C.maxPlayers);
  const cellCounts = new Uint16Array(C.maxPlayers);
  const prevCounts = new Uint16Array(C.maxPlayers);
  const lastReachedTick = new Int32Array(C.maxPlayers);
  const cellStampTick = new Int32Array(C.gridCells);
  const cellStampDistSq = new Float32Array(C.gridCells);
  const cellStampBoost = new Uint8Array(C.gridCells);
  const cellStampSlot = new Uint8Array(C.gridCells);
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

  const pairHooks: CircleBufferPairHooks = {
    isActive: (slot: number): boolean => (state[PLAYER + slot * STRIDE + 8] & FLAG_ACTIVE) !== 0,
    onImpact: (i: number, j: number, modifier: CirclePairModifier): void => {
      const baseI = PLAYER + i * STRIDE;
      const baseJ = PLAYER + j * STRIDE;
      const iBoost = state[baseI + 6] > 0;
      const jBoost = state[baseJ + 6] > 0;
      if (iBoost && jBoost) {
        modifier.scaleI = C.mutualBoost;
        modifier.scaleJ = C.mutualBoost;
        state[HIT] = C.hitStopFrames;
      } else if (iBoost) {
        modifier.scaleJ = C.boostShove;
        state[HIT] = C.hitStopFrames;
      } else if (jBoost) {
        modifier.scaleI = C.boostShove;
        state[HIT] = C.hitStopFrames;
      }
    },
  };

  let joinedCount = 0;
  let matchTarget = 0;
  cellStampTick.fill(-1);

  function writeActiveMask(): void {
    let mask = 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if ((state[PLAYER + i * STRIDE + 8] & FLAG_ACTIVE) !== 0) {
        mask |= 1 << i;
      }
    }
    state[MASK] = mask;
  }

  function clampBodyAt(base: number): void {
    scratchBody.x = state[base];
    scratchBody.y = state[base + 1];
    scratchBody.vx = state[base + 2];
    scratchBody.vy = state[base + 3];
    if (clampBoxBoundary(scratchBody, C.arenaSize, C.arenaSize, C.puckRadius, C.wallBounce)) {
      state[base] = scratchBody.x;
      state[base + 1] = scratchBody.y;
      state[base + 2] = scratchBody.vx;
      state[base + 3] = scratchBody.vy;
    }
  }

  function placeSpawn(): void {
    if (joinedCount === 0) return;
    for (let spawn = 0; spawn < joinedCount; spawn += 1) {
      const slot = spawnOrder[spawn];
      const base = PLAYER + slot * STRIDE;
      const theta = (Math.PI * 2 * spawn) / joinedCount;
      state[base] = C.rSpawn * Math.cos(theta);
      state[base + 1] = C.rSpawn * Math.sin(theta);
      state[base + 2] = 0;
      state[base + 3] = 0;
      state[base + 4] = theta + Math.PI;
      state[base + 5] = 0;
      state[base + 6] = 0;
      state[base + 7] = 0;
      state[base + 8] = FLAG_ACTIVE;
      // Note: state[base + 9] is overall match points, preserved across rounds
    }
  }

  function resetRoundGridAndCounters(): void {
    auxState.fill(0);
    cellCounts.fill(0);
    prevCounts.fill(0);
    lastReachedTick.fill(0);
    cellStampTick.fill(-1);
    cellStampDistSq.fill(0);
    cellStampBoost.fill(0);
    cellStampSlot.fill(0);
  }

  function beginPractice(lineup: boolean): void {
    state[PHASE] = PHASE_PRACTICE;
    state[TIMER] = lineup ? C.practiceInitial : C.practiceBreak;
    state[ARENA] = C.arenaSize;
    state[GOLDEN] = -1;
    resetRoundGridAndCounters();
    placeSpawn();
    writeActiveMask();
  }

  function beginCountdown(): void {
    state[PHASE] = PHASE_COUNTDOWN;
    state[TIMER] = C.countdown;
    state[GOLDEN] = -1;
    resetRoundGridAndCounters();
    placeSpawn();
    writeActiveMask();
  }

  function startMatch(slots: number[]): void {
    joinedCount = 0;
    joined.fill(0);
    spawnOrder.fill(-1);
    resetRoundGridAndCounters();

    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (slot !== (slot | 0) || slot < 0 || slot > 7 || joined[slot] === 1) continue;
      joined[slot] = 1;
      spawnOrder[joinedCount] = slot;
      joinedCount += 1;
    }

    matchTarget = targetScoreForCount(joinedCount);

    for (let i = 0; i < C.maxPlayers; i += 1) {
      inputs[i].axisX = 0;
      inputs[i].axisY = 0;
      inputs[i].buttons = 0;
      inputs[i].edge = 0;
    }

    state.fill(0);
    state[WINNER] = -1;
    beginPractice(true);
  }

  function applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void {
    if (playerIndex !== (playerIndex | 0) || playerIndex < 0 || playerIndex > 7) return;
    if (joined[playerIndex] === 0) return;

    const phase = state[PHASE];
    if (
      phase !== PHASE_PRACTICE
      && phase !== PHASE_COUNTDOWN
      && phase !== PHASE_ROUND_ACTIVE
      && phase !== PHASE_OVERTIME
    ) {
      return;
    }

    const base = PLAYER + playerIndex * STRIDE;
    if ((state[base + 8] & FLAG_ACTIVE) === 0) return;

    let x = axisX / 127;
    let y = axisY / 127;
    if (x > 1) x = 1;
    else if (x < -1) x = -1;
    if (y > 1) y = 1;
    else if (y < -1) y = -1;
    if (Math.hypot(x, y) < C.deadzone) {
      x = 0;
      y = 0;
    }

    const channel = inputs[playerIndex];
    // Countdown records the held bits without an edge, so a BOOST held through
    // the countdown is not a fresh press on the first ROUND_ACTIVE frame.
    if (phase === PHASE_COUNTDOWN) {
      channel.edge = 0;
    } else if ((buttons & 1) !== 0 && (channel.buttons & 1) === 0) {
      channel.edge = 1;
    }
    channel.buttons = buttons;
    channel.axisX = x;
    channel.axisY = y;
  }

  function simulateMotion(dt: number): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      const flags = state[base + 8];
      if ((flags & FLAG_ACTIVE) === 0) {
        inputs[i].edge = 0;
        continue;
      }

      let cooldown = state[base + 5] - dt;
      if (cooldown < 0) cooldown = 0;
      else if (cooldown > C.boostCooldown) cooldown = C.boostCooldown;

      let activeTimer = state[base + 6] - dt;
      if (activeTimer < 0) activeTimer = 0;
      else if (activeTimer > C.boostActive) activeTimer = C.boostActive;

      if (activeTimer > 0 && cooldown < activeTimer) {
        cooldown = activeTimer;
      }

      const channel = inputs[i];
      const axisX = channel.axisX;
      const axisY = channel.axisY;
      let angle = state[base + 4];
      const isBoostingBefore = activeTimer > 0;
      const turnRate = isBoostingBefore ? C.angleBlend * C.boostSteer : C.angleBlend;
      if (axisX !== 0 || axisY !== 0) {
        const target = Math.atan2(axisY, axisX);
        let delta = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
        const maxTurn = turnRate * dt;
        if (delta > maxTurn) delta = maxTurn;
        else if (delta < -maxTurn) delta = -maxTurn;
        angle += delta;
      }

      let vx = state[base + 2];
      let vy = state[base + 3];

      if (channel.edge === 1) {
        channel.edge = 0;
        if (cooldown <= 0 && activeTimer <= 0) {
          let dx = Math.cos(angle);
          let dy = Math.sin(angle);
          const mag = Math.hypot(axisX, axisY);
          if (mag > 0) {
            dx = axisX / mag;
            dy = axisY / mag;
          }
          const parallel = vx * dx + vy * dy;
          if (parallel < C.boostSpeed) {
            vx += (C.boostSpeed - parallel) * dx;
            vy += (C.boostSpeed - parallel) * dy;
          }
          activeTimer = C.boostActive;
          cooldown = C.boostCooldown;
        }
      }

      const boosting = activeTimer > 0;
      const accel = boosting ? C.boostAccel : C.aMove;
      const vCap = boosting ? C.boostSpeed : C.vMax;

      scratchBody.x = state[base];
      scratchBody.y = state[base + 1];
      scratchBody.vx = vx + accel * axisX * dt;
      scratchBody.vy = vy + accel * axisY * dt;
      integrateMotion(scratchBody, dt, C.mu);

      const speed = Math.hypot(scratchBody.vx, scratchBody.vy);
      if (speed > vCap) {
        const scale = vCap / speed;
        scratchBody.vx *= scale;
        scratchBody.vy *= scale;
      }

      clampBoxBoundary(scratchBody, C.arenaSize, C.arenaSize, C.puckRadius, C.wallBounce);

      state[base] = scratchBody.x;
      state[base + 1] = scratchBody.y;
      state[base + 2] = scratchBody.vx;
      state[base + 3] = scratchBody.vy;
      state[base + 4] = angle;
      state[base + 5] = cooldown;
      state[base + 6] = activeTimer;
      const preserved = flags & ~(FLAG_BOOSTING);
      state[base + 8] = boosting ? preserved | FLAG_BOOSTING : preserved;
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

    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      if ((state[base + 8] & FLAG_ACTIVE) === 0) continue;
      clampBodyAt(base);
    }
  }

  function stampGrid(tick: number): void {
    const gridMax = C.gridSize - 1;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      if ((state[base + 8] & FLAG_ACTIVE) === 0) continue;

      const boosting = state[base + 6] > 0 ? 1 : 0;
      const r = boosting === 1 ? C.boostPaintRadius : C.paintRadius;
      const rSq = r * r;
      const px = state[base];
      const py = state[base + 1];

      let colMin = Math.floor((px - r + C.halfArena) / C.cellSize);
      let colMax = Math.floor((px + r + C.halfArena) / C.cellSize);
      let rowMin = Math.floor((py - r + C.halfArena) / C.cellSize);
      let rowMax = Math.floor((py + r + C.halfArena) / C.cellSize);
      if (colMin < 0) colMin = 0;
      if (colMax > gridMax) colMax = gridMax;
      if (rowMin < 0) rowMin = 0;
      if (rowMax > gridMax) rowMax = gridMax;

      const newOwner = i + 1;
      for (let row = rowMin; row <= rowMax; row += 1) {
        const cy = -C.halfArena + (row + 0.5) * C.cellSize;
        const dy = cy - py;
        const dySq = dy * dy;
        const rowOffset = row * C.gridSize;
        for (let col = colMin; col <= colMax; col += 1) {
          const cx = -C.halfArena + (col + 0.5) * C.cellSize;
          const dx = cx - px;
          const distSq = dx * dx + dySq;
          if (distSq > rSq) continue;

          const c = rowOffset + col;
          if (cellStampTick[c] === tick) {
            const prevBoost = cellStampBoost[c];
            if (boosting !== prevBoost) {
              if (boosting < prevBoost) continue;
            } else {
              const prevDist = cellStampDistSq[c];
              if (distSq > prevDist) continue;
              if (distSq === prevDist && i >= cellStampSlot[c]) continue;
            }
          }

          cellStampTick[c] = tick;
          cellStampBoost[c] = boosting;
          cellStampDistSq[c] = distSq;
          cellStampSlot[c] = i;

          const oldOwner = auxState[c];
          if (oldOwner !== newOwner) {
            if (oldOwner > 0) cellCounts[oldOwner - 1] -= 1;
            cellCounts[i] += 1;
            auxState[c] = newOwner;
          }
        }
      }
    }

    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      const count = cellCounts[i];
      state[base + 7] = (count * 100) / C.gridCells;
      if (count !== prevCounts[i]) {
        prevCounts[i] = count;
        lastReachedTick[i] = tick;
      }
    }
  }

  function pickGoldenCell(tick: number): number {
    const minIdx = C.goldenMargin;
    const maxIdx = C.gridSize - 1 - C.goldenMargin;
    let bestCell = minIdx * C.gridSize + minIdx;
    let bestMinDistSq = -1;
    let bestTie = -1;

    for (let row = minIdx; row <= maxIdx; row += 1) {
      const cy = -C.halfArena + (row + 0.5) * C.cellSize;
      const rowOffset = row * C.gridSize;
      for (let col = minIdx; col <= maxIdx; col += 1) {
        const cx = -C.halfArena + (col + 0.5) * C.cellSize;
        let minDistSq = Infinity;
        for (let i = 0; i < C.maxPlayers; i += 1) {
          const base = PLAYER + i * STRIDE;
          if ((state[base + 8] & FLAG_CONTENDER) === 0) continue;
          const dx = cx - state[base];
          const dy = cy - state[base + 1];
          const dSq = dx * dx + dy * dy;
          if (dSq < minDistSq) minDistSq = dSq;
        }
        const cell = rowOffset + col;
        const tie = (tick + cell) % C.gridCells;
        if (minDistSq > bestMinDistSq || (minDistSq === bestMinDistSq && tie > bestTie)) {
          bestMinDistSq = minDistSq;
          bestTie = tie;
          bestCell = cell;
        }
      }
    }
    return bestCell;
  }

  function enterOvertime(maxCells: number, tick: number): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const base = PLAYER + i * STRIDE;
      // Keep inputs[i].buttons: a BOOST held into overtime is not a fresh press.
      inputs[i].edge = 0;
      inputs[i].axisX = 0;
      inputs[i].axisY = 0;
      if (cellCounts[i] === maxCells) {
        state[base + 5] = 0;
        state[base + 6] = 0;
        state[base + 8] = FLAG_ACTIVE | FLAG_CONTENDER;
      } else {
        state[base] = OFFSCREEN;
        state[base + 1] = OFFSCREEN;
        state[base + 2] = 0;
        state[base + 3] = 0;
        state[base + 5] = 0;
        state[base + 6] = 0;
        state[base + 8] = 0;
      }
    }
    state[PHASE] = PHASE_OVERTIME;
    state[TIMER] = C.overtimeDuration;
    state[GOLDEN] = pickGoldenCell(tick);
  }

  function awardRoundPoints(): void {
    const count = joinedCount;
    if (count < 2) return;
    if (isSuddenDeath(state, matchTarget)) {
      const topScore = maxScoreForState(state);
      for (let i = 0; i < C.maxPlayers; i += 1) {
        if (joined[i] === 0) continue;
        const baseI = PLAYER + i * STRIDE;
        if (state[baseI + 9] === topScore) {
          state[baseI + 9] += 1;
        }
      }
      return;
    }

    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const baseI = PLAYER + i * STRIDE;
      const cellsI = cellCounts[i];
      let better = 0;
      for (let j = 0; j < C.maxPlayers; j += 1) {
        if (joined[j] === 0 || j === i) continue;
        const cellsJ = cellCounts[j];
        if (cellsJ > cellsI) {
          better += 1;
        }
      }
      const points = count - 1 - better;
      if (points > 0) {
        state[baseI + 9] += points;
      }
    }
  }

  function enterRoundEnd(winnerSlot: number): void {
    state[WINNER] = winnerSlot;
    state[GOLDEN] = -1;
    awardRoundPoints();
    state[PHASE] = PHASE_ROUND_END;
    state[TIMER] = C.roundEnd;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      state[base + 2] = 0;
      state[base + 3] = 0;
      inputs[i].edge = 0;
    }
  }

  function resolveOvertimeTimeout(): number {
    let bestSlot = -1;
    let bestCells = -1;
    let bestTick = 0x7fffffff;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      if ((state[base + 8] & FLAG_CONTENDER) === 0) continue;
      const cells = cellCounts[i];
      const reached = lastReachedTick[i];
      if (
        bestSlot < 0
        || cells > bestCells
        || (cells === bestCells && reached < bestTick)
      ) {
        bestSlot = i;
        bestCells = cells;
        bestTick = reached;
      }
    }
    return bestSlot;
  }

  function step(dt: number): void {
    state[TICK] += 1;
    const tick = state[TICK] | 0;
    if (state[HIT] > 0) {
      state[HIT] -= 1;
    }

    const phase = state[PHASE];
    if (phase === PHASE_PRACTICE) {
      simulateMotion(dt);
      state[TIMER] -= dt;
      if (state[TIMER] <= 0) {
        beginCountdown();
      }
      writeActiveMask();
      return;
    }

    if (phase === PHASE_COUNTDOWN) {
      state[TIMER] -= dt;
      if (state[TIMER] <= 0) {
        state[PHASE] = PHASE_ROUND_ACTIVE;
        state[TIMER] = C.roundDuration;
      }
      writeActiveMask();
      return;
    }

    if (phase === PHASE_ROUND_END) {
      state[TIMER] -= dt;
      if (state[TIMER] <= 0) {
        if (hasUniqueWinner(state, matchTarget)) {
          state[PHASE] = PHASE_MATCH_OVER;
          state[TIMER] = 0;
        } else {
          beginPractice(false);
        }
      }
      writeActiveMask();
      return;
    }

    if (phase === PHASE_MATCH_OVER) {
      writeActiveMask();
      return;
    }

    if (phase === PHASE_ROUND_ACTIVE) {
      simulateMotion(dt);
      stampGrid(tick);
      state[TIMER] -= dt;
      if (state[TIMER] <= 0) {
        state[TIMER] = 0;
        let maxCells = -1;
        let leaderSlot = -1;
        let leaderCount = 0;
        for (let i = 0; i < C.maxPlayers; i += 1) {
          if (joined[i] === 0) continue;
          const cells = cellCounts[i];
          if (cells > maxCells) {
            maxCells = cells;
            leaderSlot = i;
            leaderCount = 1;
          } else if (cells === maxCells) {
            leaderCount += 1;
          }
        }
        if (leaderCount === 1 && leaderSlot >= 0) {
          enterRoundEnd(leaderSlot);
        } else {
          enterOvertime(maxCells < 0 ? 0 : maxCells, tick);
        }
      }
      writeActiveMask();
      return;
    }

    if (phase === PHASE_OVERTIME) {
      simulateMotion(dt);
      stampGrid(tick);
      const golden = state[GOLDEN] | 0;
      if (golden >= 0 && golden < C.gridCells && cellStampTick[golden] === tick) {
        const winner = cellStampSlot[golden];
        state[HIT] = C.hitStopFrames;
        enterRoundEnd(winner);
        writeActiveMask();
        return;
      }
      state[TIMER] -= dt;
      if (state[TIMER] <= 0) {
        state[TIMER] = 0;
        enterRoundEnd(resolveOvertimeTimeout());
      }
      writeActiveMask();
    }
  }

  return { state, auxState, applyInput, step, startMatch };
}
