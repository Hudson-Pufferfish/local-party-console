import { SUMO_CONSTANTS as C } from './constants';
import { hasUniqueWinner, targetScoreForCount } from './scoreboard';

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

  function placeSpawn(keepAngle: boolean): void {
    const count = joinedCount;
    for (let spawn = 0; spawn < count; spawn += 1) {
      const slot = spawnOrder[spawn];
      const theta = (Math.PI * 2 * spawn) / count;
      const base = PLAYER + slot * STRIDE;
      state[base] = C.rSpawn * Math.cos(theta);
      state[base + 1] = C.rSpawn * Math.sin(theta);
      state[base + 2] = 0;
      state[base + 3] = 0;
      if (!keepAngle) {
        state[base + 4] = theta + Math.PI;
      }
      state[base + 8] = ALIVE;
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

  function clampPuckInside(base: number, maxR: number, maxRSq: number, restitution: number): void {
    const x = state[base];
    const y = state[base + 1];
    const radiusSq = x * x + y * y;
    if (radiusSq <= maxRSq || maxR <= 0) return;
    const radius = Math.sqrt(radiusSq);
    const nx = x / radius;
    const ny = y / radius;
    state[base] = nx * maxR;
    state[base + 1] = ny * maxR;
    if (state[base] * state[base] + state[base + 1] * state[base + 1] > maxRSq) {
      const safe = maxR * (1 - 1e-6);
      state[base] = nx * safe;
      state[base + 1] = ny * safe;
    }
    const vx = state[base + 2];
    const vy = state[base + 3];
    const outward = vx * nx + vy * ny;
    if (outward > 0) {
      const impulse = (1 + restitution) * outward;
      state[base + 2] = vx - impulse * nx;
      state[base + 3] = vy - impulse * ny;
    }
  }

  function reviveForBreak(): void {
    const keep = C.r0 - C.puckRadius;
    const keepSq = keep * keep;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      inputs[i].edge = 0;
      const base = PLAYER + i * STRIDE;
      state[base + 6] = 0;
      state[base + 7] = 0;
      state[base + 8] = ALIVE;
      clampPuckInside(base, keep, keepSq, 0);
    }
  }

  function beginPractice(lineup: boolean): void {
    state[PHASE] = PRACTICE;
    state[TIMER] = C.practice;
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
    const minDist = C.puckRadius * 2;
    const minDistSq = minDist * minDist;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const baseI = PLAYER + i * STRIDE;
      if ((state[baseI + 8] & ALIVE) === 0) {
        continue;
      }
      for (let j = i + 1; j < C.maxPlayers; j += 1) {
        const baseJ = PLAYER + j * STRIDE;
        if ((state[baseJ + 8] & ALIVE) === 0) {
          continue;
        }
        let xi = state[baseI];
        let yi = state[baseI + 1];
        let xj = state[baseJ];
        let yj = state[baseJ + 1];
        const dx = xj - xi;
        const dy = yj - yi;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDistSq) {
          continue;
        }
        let nx = Math.cos(i);
        let ny = Math.sin(i);
        let dist = 0;
        if (distSq !== 0) {
          dist = Math.sqrt(distSq);
          nx = dx / dist;
          ny = dy / dist;
        }
        const half = (minDist - dist) * 0.5;
        xi -= nx * half;
        yi -= ny * half;
        xj += nx * half;
        yj += ny * half;
        state[baseI] = xi;
        state[baseI + 1] = yi;
        state[baseJ] = xj;
        state[baseJ + 1] = yj;

        let vxi = state[baseI + 2];
        let vyi = state[baseI + 3];
        let vxj = state[baseJ + 2];
        let vyj = state[baseJ + 3];
        const vr = (vxj - vxi) * nx + (vyj - vyi) * ny;
        if (vr >= 0) {
          continue;
        }
        const impulse = -(1 + C.restitution) * vr / (1 / C.mass + 1 / C.mass);
        const iDash = state[baseI + 6] > 0;
        const jDash = state[baseJ + 6] > 0;
        let scaleI = 1;
        let scaleJ = 1;
        if (iDash && jDash) {
          scaleI = C.mutualDash;
          scaleJ = C.mutualDash;
          state[HIT] = C.hitStopFrames;
        } else if (iDash) {
          scaleJ = C.ramMultiplier;
          state[baseJ + 7] = C.stunTime;
          state[HIT] = C.hitStopFrames;
        } else if (jDash) {
          scaleI = C.ramMultiplier;
          state[baseI + 7] = C.stunTime;
          state[HIT] = C.hitStopFrames;
        }
        state[baseI + 2] = vxi - impulse * nx * scaleI;
        state[baseI + 3] = vyi - impulse * ny * scaleI;
        state[baseJ + 2] = vxj + impulse * nx * scaleJ;
        state[baseJ + 3] = vyj + impulse * ny * scaleJ;
        if (state[baseI + 7] > 0) {
          state[baseI + 8] = ALIVE + 2;
        }
        if (state[baseJ + 7] > 0) {
          state[baseJ + 8] = ALIVE + 2;
        }
      }
    }
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
    const maxR = C.r0 - C.puckRadius;
    const maxRSq = maxR * maxR;
    if (maxR <= 0) return;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      if ((state[base + 8] & ALIVE) === 0) continue;
      clampPuckInside(base, maxR, maxRSq, C.restitution);
    }
  }

  function pullInside(arena: number): void {
    const keep = arena * 0.98;
    if (keep <= 0) return;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = PLAYER + i * STRIDE;
      if ((state[base + 8] & ALIVE) === 0) continue;
      const x = state[base];
      const y = state[base + 1];
      const radius = Math.hypot(x, y);
      if (radius <= keep || radius === 0) continue;
      const scale = keep / radius;
      state[base] = x * scale;
      state[base + 1] = y * scale;
      const nx = state[base] / keep;
      const ny = state[base + 1] / keep;
      const vx = state[base + 2];
      const vy = state[base + 3];
      const outward = vx * nx + vy * ny;
      if (outward > 0) {
        state[base + 2] = vx - outward * nx;
        state[base + 3] = vy - outward * ny;
      }
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

    const damp = Math.exp(-C.mu * dt);
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
      let vx = state[base + 2] + C.aMove * steer * channel.axisX * dt;
      let vy = state[base + 3] + C.aMove * steer * channel.axisY * dt;
      vx *= damp;
      vy *= damp;
      state[base] = state[base] + vx * dt;
      state[base + 1] = state[base + 1] + vy * dt;
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
