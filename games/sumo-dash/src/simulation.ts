import {
  clampRadialBoundary,
  integrateMotion,
  resolveCircleBufferPairs,
  type CircleBufferPairHooks,
  type CirclePairModifier,
  type PhysicsBody2D,
} from '../../../shared/src/physics-2d';
import { SUMO_CONSTANTS as C } from './constants';
import { hasUniqueWinner, isSuddenDeath, maxScoreForState, targetScoreForCount } from './scoreboard';

const TICK = 0;
const PHASE = 1;
const TIMER = 2;
const ARENA = 3;
const TARGET = 4;
const MASK = 5;
const HIT = 6;
const PLAYER = 8;
const STRIDE = 10;
const COUNTDOWN = 0;
const ACTIVE = 1;
const ROUND_END = 2;
const MATCH_OVER = 3;
const PRACTICE = 4;
const ALIVE = 1;
const OFFSCREEN = 10000;

interface Channel {
  axisX: number;
  axisY: number;
  buttons: number;
  edge: number;
}

export interface SumoSimulation {
  readonly state: Float32Array;
  applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void;
  step(dt: number): void;
  startMatch(slots: number[]): void;
}

function radiusAt(t: number): number {
  if (t <= C.shrinkHold) return C.r0;
  const shrunk = C.r0 - C.shrinkRate * (t - C.shrinkHold);
  if (shrunk > C.rMin) return shrunk;
  const atMin = C.shrinkHold + (C.r0 - C.rMin) / C.shrinkRate;
  const holdEnd = atMin + C.rMinHold;
  if (t <= holdEnd) return C.rMin;
  let radius = C.rMin - C.suddenRate * (t - holdEnd);
  if (radius < C.rFloor) radius = C.rFloor;
  return radius;
}

function createChannel(): Channel {
  return { axisX: 0, axisY: 0, buttons: 0, edge: 0 };
}

export function createSumoSimulation(): SumoSimulation {
  const state = new Float32Array(C.stateFloats);
  const joined = new Uint8Array(C.maxPlayers);
  const spawnOrder = new Int8Array(C.maxPlayers);
  const eliminatedTick = new Int32Array(C.maxPlayers);
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
    isActive: (slot: number): boolean => (state[PLAYER + slot * STRIDE + 8] & ALIVE) !== 0,
    onImpact: (i: number, j: number, modifier: CirclePairModifier): void => {
      const baseI = PLAYER + i * STRIDE;
      const baseJ = PLAYER + j * STRIDE;
      const iDash = state[baseI + 6] > 0;
      const jDash = state[baseJ + 6] > 0;
      if (iDash && jDash) {
        modifier.scaleI = C.mutualDash;
        modifier.scaleJ = C.mutualDash;
        state[HIT] = C.hitStopFrames;
      } else if (iDash) {
        modifier.scaleJ = C.ramMultiplier;
        state[baseJ + 7] = C.stunTime;
        state[HIT] = C.hitStopFrames;
      } else if (jDash) {
        modifier.scaleI = C.ramMultiplier;
        state[baseI + 7] = C.stunTime;
        state[HIT] = C.hitStopFrames;
      }
      if (state[baseI + 7] > 0) {
        state[baseI + 8] = ALIVE + 2;
      }
      if (state[baseJ + 7] > 0) {
        state[baseJ + 8] = ALIVE + 2;
      }
    },
  };
  let joinedCount = 0;
  let matchTarget: number = C.minTargetScore;
  let roundTick = 0;
  eliminatedTick.fill(-1);

  function writeAliveMask(): void {
    let mask = 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if ((state[PLAYER + i * STRIDE + 8] & ALIVE) !== 0) {
        mask |= 1 << i;
      }
    }
    state[MASK] = mask;
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
    state[base + 8] = 0;
  }

  function placeSpawn(keepAngle: boolean): void {
    const sudden = isSuddenDeath(state, matchTarget);
    const topScore = sudden ? maxScoreForState(state) : 0;
    let count = joinedCount;
    if (sudden) {
      count = 0;
      for (let i = 0; i < joinedCount; i += 1) {
        const slot = spawnOrder[i];
        if (state[PLAYER + slot * STRIDE + 9] === topScore) {
          count += 1;
        }
      }
    }
    if (count === 0) return;
    let placed = 0;
    for (let spawn = 0; spawn < joinedCount; spawn += 1) {
      const slot = spawnOrder[spawn];
      const base = PLAYER + slot * STRIDE;
      if (sudden && state[base + 9] !== topScore) {
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
      state[base + 8] = ALIVE;
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

  function beginCountdown(): void {
    state[PHASE] = COUNTDOWN;
    state[TIMER] = C.countdown;
    state[ARENA] = C.r0;
    state[TARGET] = C.r0;
    eliminatedTick.fill(-1);
    roundTick = 0;
    resetBodies();
    placeSpawn(false);
    writeAliveMask();
  }

  function clampPuckInside(
    base: number,
    arenaRadius: number,
    bodyRadius: number,
    restitution: number,
  ): void {
    scratchBody.x = state[base];
    scratchBody.y = state[base + 1];
    scratchBody.vx = state[base + 2];
    scratchBody.vy = state[base + 3];
    if (clampRadialBoundary(scratchBody, arenaRadius, bodyRadius, restitution)) {
      state[base] = scratchBody.x;
      state[base + 1] = scratchBody.y;
      state[base + 2] = scratchBody.vx;
      state[base + 3] = scratchBody.vy;
    }
  }

  function reviveForBreak(): void {
    const sudden = isSuddenDeath(state, matchTarget);
    const topScore = sudden ? maxScoreForState(state) : 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const base = PLAYER + i * STRIDE;
      if (sudden && state[base + 9] !== topScore) {
        parkNonContender(i);
        continue;
      }
      inputs[i].edge = 0;
      state[base + 6] = 0;
      state[base + 7] = 0;
      state[base + 8] = ALIVE;
      clampPuckInside(base, C.r0, C.puckRadius, 0);
    }
  }

  function beginPractice(lineup: boolean): void {
    state[PHASE] = PRACTICE;
    state[TIMER] = lineup ? C.practiceInitial : C.practiceBreak;
    state[ARENA] = C.r0;
    state[TARGET] = C.r0;
    if (lineup) {
      resetBodies();
      placeSpawn(false);
    } else {
      reviveForBreak();
    }
    writeAliveMask();
  }

  function startMatch(slots: number[]): void {
    joinedCount = 0;
    joined.fill(0);
    spawnOrder.fill(-1);
    eliminatedTick.fill(-1);
    roundTick = 0;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (slot !== (slot | 0) || slot < 0 || slot > 7 || joined[slot] === 1) {
        continue;
      }
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
    beginPractice(true);
  }

  function resolvePairs(): void {
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
  }

  function applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void {
    if (playerIndex !== (playerIndex | 0) || playerIndex < 0 || playerIndex > 7) {
      return;
    }
    if (joined[playerIndex] === 0) {
      return;
    }
    const phase = state[PHASE];
    if (phase === ROUND_END || phase === MATCH_OVER) {
      return;
    }
    let x = axisX / 127;
    let y = axisY / 127;
    if (Math.hypot(x, y) < C.deadzone) {
      x = 0;
      y = 0;
    }
    const channel = inputs[playerIndex];
    if (phase === COUNTDOWN) {
      if ((state[PLAYER + playerIndex * STRIDE + 8] & ALIVE) === 0) {
        return;
      }
      channel.axisX = x;
      channel.axisY = y;
      channel.buttons = buttons;
      channel.edge = 0;
      if (x !== 0 || y !== 0) {
        state[PLAYER + playerIndex * STRIDE + 4] = Math.atan2(y, x);
      }
      return;
    }
    if (phase !== ACTIVE && phase !== PRACTICE) {
      return;
    }
    const base = PLAYER + playerIndex * STRIDE;
    if ((state[base + 8] & ALIVE) === 0) {
      return;
    }
    if ((buttons & 1) !== 0 && (channel.buttons & 1) === 0) {
      channel.edge = 1;
    }
    channel.buttons = buttons;
    channel.axisX = x;
    channel.axisY = y;
  }

  function step(dt: number): void {
    state[TICK] += 1;
    if (state[HIT] > 0) {
      state[HIT] -= 1;
    }
    const phase = state[PHASE];
    if (phase === COUNTDOWN) {
      placeSpawn(true);
      state[TIMER] -= dt;
      if (state[TIMER] <= 0) {
        state[PHASE] = ACTIVE;
        state[TIMER] = 0;
      }
      writeAliveMask();
      return;
    }
    if (phase === ROUND_END) {
      state[TIMER] -= dt;
      if (state[TIMER] <= 0) {
        if (hasUniqueWinner(state, matchTarget)) {
          state[PHASE] = MATCH_OVER;
          state[TIMER] = 0;
        } else {
          beginPractice(false);
        }
      }
      writeAliveMask();
      return;
    }
    if (phase === PRACTICE) {
      state[ARENA] = C.r0;
      state[TARGET] = C.r0;
      simulateMotion(dt);
      clampPracticeArena();
      state[TIMER] -= dt;
      if (state[TIMER] <= 0) beginCountdown();
      writeAliveMask();
      return;
    }
    if (phase !== ACTIVE) {
      writeAliveMask();
      return;
    }

    roundTick += 1;
    state[TIMER] += dt;
    const elapsed = state[TIMER];
    state[ARENA] = radiusAt(elapsed);
    state[TARGET] = radiusAt(elapsed + C.previewLead);
    simulateMotion(dt);

    const limit = state[ARENA] * state[ARENA];
    let aliveBefore = 0;
    let outCount = 0;
    let farthestOut = -1;
    let farthestOutR = -1;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      if ((state[base + 8] & ALIVE) === 0) continue;
      aliveBefore += 1;
      const x = state[base];
      const y = state[base + 1];
      const radiusSq = x * x + y * y;
      if (radiusSq <= limit) continue;
      outCount += 1;
      if (farthestOut < 0 || radiusSq > farthestOutR) {
        farthestOut = i;
        farthestOutR = radiusSq;
      }
    }
    let eliminatedThisTick = 0;
    if (outCount > 0 && outCount === aliveBefore && state[ARENA] > C.rMin) {
      pullInside(state[ARENA]);
    } else if (outCount === aliveBefore && state[ARENA] <= C.rMin && farthestOut >= 0) {
      state[PLAYER + farthestOut * STRIDE + 8] = 0;
      eliminatedTick[farthestOut] = roundTick;
      eliminatedThisTick = 1;
    } else if (outCount > 0) {
      for (let i = 0; i < C.maxPlayers; i += 1) {
        const base = PLAYER + i * STRIDE;
        if ((state[base + 8] & ALIVE) === 0) continue;
        const x = state[base];
        const y = state[base + 1];
        if (x * x + y * y > limit) {
          state[base + 8] = 0;
          eliminatedTick[i] = roundTick;
          eliminatedThisTick += 1;
        }
      }
    }
    if (eliminatedThisTick === 0 && state[ARENA] <= C.rFloor + 1e-4) {
      let farthest = -1;
      let farthestR = -1;
      let alive = 0;
      for (let i = 0; i < C.maxPlayers; i += 1) {
        const base = PLAYER + i * STRIDE;
        if ((state[base + 8] & ALIVE) === 0) continue;
        alive += 1;
        const x = state[base];
        const y = state[base + 1];
        const radiusSq = x * x + y * y;
        if (farthest < 0 || radiusSq > farthestR) {
          farthest = i;
          farthestR = radiusSq;
        }
      }
      if (alive > 1 && farthest >= 0) {
        state[PLAYER + farthest * STRIDE + 8] = 0;
        eliminatedTick[farthest] = roundTick;
      }
    }
    let aliveCount = 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      if ((state[base + 8] & ALIVE) === 0) continue;
      aliveCount += 1;
    }
    if (aliveCount <= 1) {
      if (aliveCount === 1) {
        awardRoundPoints();
      }
      state[PHASE] = ROUND_END;
      state[TIMER] = C.roundEnd;
    }
    writeAliveMask();
  }

  function awardRoundPoints(): void {
    const count = joinedCount;
    if (count < 2) return;
    if (isSuddenDeath(state, matchTarget)) {
      const topScore = maxScoreForState(state);
      for (let i = 0; i < C.maxPlayers; i += 1) {
        if (joined[i] === 0) continue;
        const baseI = PLAYER + i * STRIDE;
        if ((state[baseI + 8] & ALIVE) !== 0 && state[baseI + 9] === topScore) {
          state[baseI + 9] += 1;
        }
      }
      return;
    }
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const baseI = PLAYER + i * STRIDE;
      let better = 0;
      if ((state[baseI + 8] & ALIVE) === 0) {
        const tickI = eliminatedTick[i];
        for (let j = 0; j < C.maxPlayers; j += 1) {
          if (joined[j] === 0 || j === i) continue;
          const aliveJ = (state[PLAYER + j * STRIDE + 8] & ALIVE) !== 0;
          if (aliveJ || eliminatedTick[j] > tickI) {
            better += 1;
          }
        }
      }
      const points = count - 1 - better;
      if (points > 0) {
        state[baseI + 9] += points;
      }
    }
  }

  function clampPracticeArena(): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      if ((state[base + 8] & ALIVE) === 0) continue;
      clampPuckInside(base, C.r0, C.puckRadius, C.restitution);
    }
  }

  function pullInside(arena: number): void {
    const keep = arena * 0.98;
    if (keep <= 0) return;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      if ((state[base + 8] & ALIVE) === 0) continue;
      clampPuckInside(base, keep, 0, 0);
    }
  }

  function simulateMotion(dt: number): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      let cooldown = state[base + 5] - dt;
      if (cooldown < 0) {
        cooldown = 0;
      } else if (cooldown > C.dashCooldown) {
        cooldown = C.dashCooldown;
      }
      let activeTimer = state[base + 6] - dt;
      if (activeTimer < 0) {
        activeTimer = 0;
      } else if (activeTimer > C.dashActive) {
        activeTimer = C.dashActive;
      }
      let stun = state[base + 7] - dt;
      if (stun < 0) {
        stun = 0;
      } else if (stun > C.stunTime) {
        stun = C.stunTime;
      }
      state[base + 5] = cooldown;
      state[base + 6] = activeTimer;
      state[base + 7] = stun;
    }

    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      const channel = inputs[i];
      if ((state[base + 8] & ALIVE) === 0) {
        channel.edge = 0;
        continue;
      }
      let steer = 1;
      if (state[base + 6] > 0) {
        steer *= C.steerDash;
      }
      if (state[base + 7] > 0) {
        steer *= C.steerStun;
      }
      scratchBody.x = state[base];
      scratchBody.y = state[base + 1];
      scratchBody.vx = state[base + 2] + C.aMove * steer * channel.axisX * dt;
      scratchBody.vy = state[base + 3] + C.aMove * steer * channel.axisY * dt;
      integrateMotion(scratchBody, dt, C.mu);
      state[base] = scratchBody.x;
      state[base + 1] = scratchBody.y;
      let vx = scratchBody.vx;
      let vy = scratchBody.vy;
      let angle = state[base + 4];
      const axisX = channel.axisX;
      const axisY = channel.axisY;
      if (axisX !== 0 || axisY !== 0) {
        const target = Math.atan2(axisY, axisX);
        let delta = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
        const maxTurn = C.angleBlend * dt;
        if (delta > maxTurn) {
          delta = maxTurn;
        } else if (delta < -maxTurn) {
          delta = -maxTurn;
        }
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
        const speed = Math.hypot(vx, vy);
        if (speed > C.vMax) {
          const scale = C.vMax / speed;
          vx *= scale;
          vy *= scale;
        }
      }
      state[base + 2] = vx;
      state[base + 3] = vy;
      state[base + 4] = angle;
      state[base + 8] = state[base + 7] > 0 ? ALIVE + 2 : ALIVE;
    }

    resolvePairs();
  }

  return { state, applyInput, step, startMatch };
}
