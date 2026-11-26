import {
  DEFAULT_BOT_DIFFICULTY,
  assignBotScores,
  type BotDifficulty,
} from '../../../shared/src/bot-difficulty.ts';
import {
  AUX_LAYOUT,
  BUTTON_BIT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PHASE,
  CYBER_PLAYER_OFFSET,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
} from './constants.ts';
import { decodeCoordU16, playerBase } from './state.ts';

export const LEVEL_SCALE = 100;
const DEFAULT_LEVEL = C.standbyBotLevel;
const SLOTS = C.maxPlayers;

const ROLE_GUARD = 0;
const ROLE_INTERCEPT = 1;
const ROLE_REVIVE = 2;
const ROLE_EMP = 3;

const URGENT_REVIVE_SEC = 5.0;
const REVIVE_RANGE_SQ = (C.reviveRange - 6) * (C.reviveRange - 6);
const EMP_RING_INNER_SQ = (C.empRingRadius - 25) * (C.empRingRadius - 25);

// Module-level pre-allocated state for zero-allocation 60 Hz bot planning (INV-9)
const roleBySlot = new Uint8Array(SLOTS);
const roleTargetSlot = new Int8Array(SLOTS).fill(-1);
const roleTargetEnemy = new Int16Array(SLOTS).fill(-1);
const lastEvalTick = new Float64Array(SLOTS).fill(-1000);
const lastButtonPulse = new Uint8Array(SLOTS);

export type LevelRng = () => number;

export function assignBotLevels(
  count: number,
  difficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY,
  rng: LevelRng = Math.random,
): readonly number[] {
  let n = Math.trunc(count);
  if (!Number.isFinite(count) || n < 0) n = 0;
  if (n > 7) n = 7;
  if (n === 0) return [];
  return assignBotScores(n, difficulty, rng);
}

export function levelsForMask(
  mask: Uint8Array,
  difficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY,
  rng: LevelRng = Math.random,
): Uint8Array {
  let count = 0;
  const limit = mask.length < SLOTS ? mask.length : SLOTS;
  for (let index = 0; index < limit; index += 1) {
    if (mask[index] === 1) count += 1;
  }
  const levels = assignBotLevels(count, difficulty, rng);
  const out = new Uint8Array(SLOTS);
  let placed = 0;
  for (let index = 0; index < limit; index += 1) {
    if (mask[index] !== 1 || placed >= levels.length) continue;
    out[index] = levels[placed] ?? DEFAULT_LEVEL;
    placed += 1;
  }
  return out;
}

export function standbyBotLevel(_state: Float32Array, _slot: number): number {
  // Real AWAY: disconnected humans are never taken over by heuristic bots
  return 0;
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_LEVEL;
  let value = Math.trunc(level);
  if (value < 1) value = 1;
  if (value > LEVEL_SCALE) value = LEVEL_SCALE;
  return value;
}

function clampAxis(value: number): number {
  const rounded = Math.round(value);
  if (rounded > 127) return 127;
  if (rounded < -127) return -127;
  return rounded;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function hasActiveHumanEmpJoined(state: Float32Array): boolean {
  for (let s = 0; s < SLOTS; s += 1) {
    const flags = state[playerBase(s) + CYBER_PLAYER_OFFSET.flags] ?? 0;
    if ((flags & CYBER_FLAG.JOINED) === 0 || (flags & CYBER_FLAG.ACTIVE) === 0) continue;
    if ((flags & (CYBER_FLAG.IS_BOT | CYBER_FLAG.STANDBY_BOT | CYBER_FLAG.DISCONNECTED)) !== 0) {
      continue;
    }
    if ((flags & CYBER_FLAG.EMP_JOINED) !== 0) return true;
  }
  return false;
}

function findBestDownedTarget(
  state: Float32Array,
  botIndex: number,
  bx: number,
  by: number,
  urgentOnly: boolean,
): number {
  let bestSlot = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let s = 0; s < SLOTS; s += 1) {
    if (s === botIndex) continue;
    const pb = playerBase(s);
    const flags = state[pb + CYBER_PLAYER_OFFSET.flags] ?? 0;
    if ((flags & CYBER_FLAG.JOINED) === 0 || (flags & CYBER_FLAG.DOWNED) === 0) continue;
    const isHuman = (flags & (CYBER_FLAG.IS_BOT | CYBER_FLAG.STANDBY_BOT)) === 0;
    const timer = state[pb + CYBER_PLAYER_OFFSET.downTimer] ?? 15;
    if (urgentOnly && (!isHuman || timer >= URGENT_REVIVE_SEC)) continue;

    const dx = (state[pb + CYBER_PLAYER_OFFSET.x] ?? 0) - bx;
    const dy = (state[pb + CYBER_PLAYER_OFFSET.y] ?? 0) - by;
    const dist = Math.hypot(dx, dy);
    // Prioritize humans heavily over bots, especially when <5.0s bleed-out
    const humanBias = isHuman ? (timer < URGENT_REVIVE_SEC ? -5000 : -1500) : 0;
    const score = dist + humanBias;
    if (score < bestScore) {
      bestScore = score;
      bestSlot = s;
    }
  }
  return bestSlot;
}

function findPriorityEnemies(
  auxState: Uint8Array,
  bx: number,
  by: number,
  outResult: Int32Array,
): void {
  // outResult[0] = threatening heavy (brute/boss) within defense range, outResult[1] = enemy closest to Core, outResult[2] = near count
  let bestHeavy = -1;
  let bestHeavyDistSq = Number.POSITIVE_INFINITY;
  let bestCore = -1;
  let bestCoreDistSq = Number.POSITIVE_INFINITY;
  let nearCluster = 0;

  if (auxState.byteLength < AUX_LAYOUT.AUX_CORE_BYTES) {
    outResult[0] = -1;
    outResult[1] = -1;
    outResult[2] = 0;
    return;
  }

  // Core danger threshold: 280 units (beyond this, heavy enemies are not an immediate Core breach threat)
  const HEAVY_INTERCEPT_MAX_CORE_SQ = 280 * 280;

  for (let i = 0; i < AUX_LAYOUT.MAX_ENEMIES; i += 1) {
    const off = AUX_LAYOUT.ENEMIES_OFFSET + i * AUX_LAYOUT.ENEMY_STRIDE;
    const hpPct = auxState[off + 4] ?? 0;
    if (hpPct === 0) continue;
    const type = auxState[off + 5] ?? 0;
    if (type === ENEMY_TYPE.EMPTY) continue;

    const ex = decodeCoordU16(readU16LE(auxState, off));
    const ey = decodeCoordU16(readU16LE(auxState, off + 2));
    const coreDistSq = ex * ex + ey * ey;
    if (coreDistSq < bestCoreDistSq) {
      bestCoreDistSq = coreDistSq;
      bestCore = i;
    }
    const dx = ex - bx;
    const dy = ey - by;
    const dSq = dx * dx + dy * dy;
    if (dSq < 140 * 140) nearCluster += 1;

    // Only intercept Brutes or Bosses if they are encroaching on the Core
    if (type === ENEMY_TYPE.BRUTE || type === ENEMY_TYPE.BOSS) {
      if (coreDistSq <= HEAVY_INTERCEPT_MAX_CORE_SQ && dSq < bestHeavyDistSq) {
        bestHeavyDistSq = dSq;
        bestHeavy = i;
      }
    }
  }

  outResult[0] = bestHeavy;
  outResult[1] = bestCore;
  outResult[2] = nearCluster;
}

const enemyScanScratch = new Int32Array(3);

export function writeHeuristic(
  state: Float32Array,
  botIndex: number,
  axisX: Int8Array,
  axisY: Int8Array,
  buttons: Uint8Array,
  level: number = DEFAULT_LEVEL,
  auxState?: Uint8Array,
): void {
  if (botIndex !== (botIndex | 0) || botIndex < 0 || botIndex >= SLOTS) return;

  const base = playerBase(botIndex);
  const flags = state[base + CYBER_PLAYER_OFFSET.flags] ?? 0;
  const phase = state[CYBER_HEADER.phaseEnum] ?? 0;

  if ((flags & CYBER_FLAG.ACTIVE) === 0 || phase === CYBER_PHASE.MATCH_OVER || phase === CYBER_PHASE.COUNTDOWN) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
    buttons[botIndex] = 0;
    lastButtonPulse[botIndex] = 0;
    return;
  }

  const skill = clampLevel(level);
  const share = skill / LEVEL_SCALE;
  const tick = state[CYBER_HEADER.tickId] ?? 0;
  const px = state[base + CYBER_PLAYER_OFFSET.x] ?? 0;
  const py = state[base + CYBER_PLAYER_OFFSET.y] ?? 0;
  const heading = state[base + CYBER_PLAYER_OFFSET.heading] ?? 0;
  const railCd = state[base + CYBER_PLAYER_OFFSET.railCooldown] ?? 0;
  const dashCd = state[base + CYBER_PLAYER_OFFSET.dashCooldown] ?? 0;
  const barricades = state[base + CYBER_PLAYER_OFFSET.barricades] ?? 0;

  // Higher difficulty evaluates roles more frequently (~1.3s Easy, ~1.0s Med, ~0.7s Hard)
  const evalIntervalTicks = Math.round(160 - share * 80);
  const urgentHuman = findBestDownedTarget(state, botIndex, px, py, true);

  if (
    urgentHuman >= 0 ||
    tick < lastEvalTick[botIndex]! ||
    tick - lastEvalTick[botIndex]! >= evalIntervalTicks
  ) {
    lastEvalTick[botIndex] = tick;
    const anyDowned = urgentHuman >= 0 ? urgentHuman : findBestDownedTarget(state, botIndex, px, py, false);
    const humanEmp = hasActiveHumanEmpJoined(state);

    if (urgentHuman >= 0) {
      roleBySlot[botIndex] = ROLE_REVIVE;
      roleTargetSlot[botIndex] = urgentHuman;
      roleTargetEnemy[botIndex] = -1;
    } else if (humanEmp) {
      roleBySlot[botIndex] = ROLE_EMP;
      roleTargetSlot[botIndex] = -1;
      roleTargetEnemy[botIndex] = -1;
    } else if (anyDowned >= 0) {
      roleBySlot[botIndex] = ROLE_REVIVE;
      roleTargetSlot[botIndex] = anyDowned;
      roleTargetEnemy[botIndex] = -1;
    } else if (auxState !== undefined) {
      findPriorityEnemies(auxState, px, py, enemyScanScratch);
      if (enemyScanScratch[0]! >= 0) {
        roleBySlot[botIndex] = ROLE_INTERCEPT;
        roleTargetEnemy[botIndex] = enemyScanScratch[0]!;
        roleTargetSlot[botIndex] = -1;
      } else {
        roleBySlot[botIndex] = ROLE_GUARD;
        roleTargetEnemy[botIndex] = enemyScanScratch[1]!;
        roleTargetSlot[botIndex] = -1;
      }
    } else {
      roleBySlot[botIndex] = ROLE_GUARD;
      roleTargetEnemy[botIndex] = -1;
      roleTargetSlot[botIndex] = -1;
    }
  }

  let steerX = 0;
  let steerY = 0;
  let wantButtons = 0;
  const pace = 0.72 + share * 0.28;
  const role = roleBySlot[botIndex]!;

  // Core Leash: Keep bots anchored around Core defense perimeter (~220 units) unless reviving
  const CORE_LEASH_RADIUS = 220;
  const CORE_LEASH_RADIUS_SQ = CORE_LEASH_RADIUS * CORE_LEASH_RADIUS;
  const CORE_PERIMETER_ORBIT = 165;
  const botDistSqFromCore = px * px + py * py;

  if (role === ROLE_REVIVE) {
    const tSlot = roleTargetSlot[botIndex]!;
    if (tSlot >= 0 && tSlot < SLOTS) {
      const tb = playerBase(tSlot);
      const tFlags = state[tb + CYBER_PLAYER_OFFSET.flags] ?? 0;
      if ((tFlags & CYBER_FLAG.DOWNED) !== 0) {
        const dx = (state[tb + CYBER_PLAYER_OFFSET.x] ?? 0) - px;
        const dy = (state[tb + CYBER_PLAYER_OFFSET.y] ?? 0) - py;
        const dSq = dx * dx + dy * dy;
        if (dSq <= REVIVE_RANGE_SQ) {
          wantButtons |= BUTTON_BIT.REVIVE_EMP;
        } else {
          const dist = Math.sqrt(dSq);
          steerX = dx / dist;
          steerY = dy / dist;
        }
      }
    }
  } else if (role === ROLE_EMP) {
    // Only participate if a human is still actively EMP_JOINED (FR-9.12)
    if (hasActiveHumanEmpJoined(state)) {
      const coreDistSq = px * px + py * py;
      if (coreDistSq <= EMP_RING_INNER_SQ) {
        if ((flags & CYBER_FLAG.EMP_JOINED) === 0) {
          wantButtons |= BUTTON_BIT.REVIVE_EMP;
        }
      } else {
        const dist = Math.sqrt(coreDistSq);
        steerX = -px / dist;
        steerY = -py / dist;
      }
    }
  } else if (botDistSqFromCore > CORE_LEASH_RADIUS_SQ) {
    // Core Anchor: Drifting past 220u tether -> immediately steer back toward Core perimeter
    const dist = Math.sqrt(botDistSqFromCore);
    steerX = -px / dist;
    steerY = -py / dist;
  } else if (auxState !== undefined && auxState.byteLength >= AUX_LAYOUT.AUX_CORE_BYTES) {
    findPriorityEnemies(auxState, px, py, enemyScanScratch);
    const preferred =
      role === ROLE_INTERCEPT && enemyScanScratch[0]! >= 0
        ? enemyScanScratch[0]!
        : enemyScanScratch[1]!;

    if (preferred >= 0) {
      const off = AUX_LAYOUT.ENEMIES_OFFSET + preferred * AUX_LAYOUT.ENEMY_STRIDE;
      const ex = decodeCoordU16(readU16LE(auxState, off));
      const ey = decodeCoordU16(readU16LE(auxState, off + 2));
      const eType = auxState[off + 5] ?? 0;
      const eFlags = (auxState[off + 6] ?? 0) & 0x3f;
      const dx = ex - px;
      const dy = ey - py;
      const dist = Math.hypot(dx, dy);

      if (dist > 1e-4) {
        const ux = dx / dist;
        const uy = dy / dist;
        const aimDot = Math.cos(heading) * ux + Math.sin(heading) * uy;

        // Keep optimal standoff (~140u) for auto-fire unless closing to DASH a shielded brute
        const isShieldedBrute =
          eType === ENEMY_TYPE.BRUTE && (eFlags & ENEMY_STATE_FLAG.SHIELD_UP) !== 0;

        if (isShieldedBrute && railCd <= 0 && aimDot > 0.92 && dist < 340) {
          wantButtons |= BUTTON_BIT.RAIL;
          steerX = ux * 0.4;
          steerY = uy * 0.4;
        } else if (isShieldedBrute && dashCd <= 0 && dist < 130 && aimDot > 0.85) {
          wantButtons |= BUTTON_BIT.DASH;
          steerX = ux;
          steerY = uy;
        } else if (eType === ENEMY_TYPE.BOSS && railCd <= 0 && aimDot > 0.92) {
          wantButtons |= BUTTON_BIT.RAIL;
          steerX = ux * 0.5;
          steerY = uy * 0.5;
        } else if (dist > 155) {
          // If moving forward would violate the 220u Core leash, clamp/steer around perimeter
          const nextX = px + ux * 40;
          const nextY = py + uy * 40;
          if (nextX * nextX + nextY * nextY > CORE_LEASH_RADIUS_SQ) {
            // Strafe along leash boundary rather than walking out
            const side = botIndex % 2 === 0 ? 1 : -1;
            steerX = -uy * side;
            steerY = ux * side;
          } else {
            steerX = ux;
            steerY = uy;
          }
        } else if (dist < 95) {
          // Backpedal slightly while keeping facing toward target
          steerX = -ux * 0.5;
          steerY = -uy * 0.5;
        } else {
          // Strafe slightly while facing enemy
          const side = botIndex % 2 === 0 ? 1 : -1;
          steerX = ux * 0.45 - uy * 0.45 * side;
          steerY = uy * 0.45 + ux * 0.45 * side;
        }

        // Deploy kinetic barricade (Button X / WALL) to protect Core choke points:
        // Placed outside Core ring when enemies are closing in and bot is facing the threat
        const placeDist = C.playerRadius + C.cellSize * 1.1;
        const targetCellX = px + Math.cos(heading) * placeDist;
        const targetCellY = py + Math.sin(heading) * placeDist;
        const targetCellDistSq = targetCellX * targetCellX + targetCellY * targetCellY;
        const empRingOuterSq = (C.empRingRadius + 4) * (C.empRingRadius + 4);

        if (
          barricades < C.barricadeMaxPerPlayer &&
          targetCellDistSq > empRingOuterSq &&
          dist < 260 &&
          dist > 50 &&
          aimDot > 0.65 &&
          (enemyScanScratch[2]! >= 1 || eType === ENEMY_TYPE.BRUTE || eType === ENEMY_TYPE.BOSS)
        ) {
          wantButtons |= BUTTON_BIT.SHIELD;
        }
      }
    } else {
      // Orbit perimeter of Core ring ready for incoming flanks
      const orbitAngle = (botIndex / SLOTS) * Math.PI * 2;
      const gx = Math.cos(orbitAngle) * CORE_PERIMETER_ORBIT;
      const gy = Math.sin(orbitAngle) * CORE_PERIMETER_ORBIT;
      const dx = gx - px;
      const dy = gy - py;
      const dist = Math.hypot(dx, dy);
      if (dist > 18) {
        steerX = dx / dist;
        steerY = dy / dist;
      }
    }
  }

  // Add slight aim/steer jitter for lower difficulties
  const jitter = (1 - share) * 0.14 * ((botIndex & 1) === 0 ? 1 : -1);
  if (steerX !== 0 || steerY !== 0) {
    const ang = Math.atan2(steerY, steerX) + jitter;
    axisX[botIndex] = clampAxis(Math.cos(ang) * 127 * pace);
    axisY[botIndex] = clampAxis(Math.sin(ang) * 127 * pace);
  } else {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
  }

  // Pulse button taps cleanly (clear any bit that was already set on the previous call so rising edge re-triggers)
  const pulsed = wantButtons & ~lastButtonPulse[botIndex]!;
  lastButtonPulse[botIndex] = pulsed;
  buttons[botIndex] = pulsed;
}
