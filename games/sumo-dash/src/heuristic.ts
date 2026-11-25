import {
  DEFAULT_BOT_DIFFICULTY,
  assignBotScores,
  type BotDifficulty,
} from '../../../shared/src/bot-difficulty.ts';
import { SUMO_CONSTANTS } from './constants';

const PREDICT = 0.15;
const DASH_LIMIT = 0.85;
export const LEVEL_SCALE = 100;
const DEFAULT_LEVEL = 40;
const CONTACT = SUMO_CONSTANTS.puckRadius * 2 + 40;
const TRAVEL = SUMO_CONSTANTS.dashSpeed * SUMO_CONSTANTS.dashActive;
const ARENA = 3;
const PLAYER = 8;
const STRIDE = 10;
const FLAGS = 8;
const ALIVE = 1;
const SLOTS = 8;

export type LevelRng = () => number;

export function nerf(base: number, mult: number, share: number): number {
  return base + share * mult;
}

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

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_LEVEL;
  let value = Math.trunc(level);
  if (value < 1) value = 1;
  if (value > LEVEL_SCALE) value = LEVEL_SCALE;
  return value;
}

export function writeHeuristic(
  state: Float32Array,
  botIndex: number,
  axisX: Int8Array,
  axisY: Int8Array,
  buttons: Uint8Array,
  level = DEFAULT_LEVEL,
): void {
  if (botIndex !== (botIndex | 0) || botIndex < 0 || botIndex > 7) {
    return;
  }
  const base = PLAYER + botIndex * STRIDE;
  if ((state[base + FLAGS] & ALIVE) === 0) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
    buttons[botIndex] = 0;
    return;
  }

  const skill = clampLevel(level);
  const share = skill / LEVEL_SCALE;
  const pace = nerf(0.32, 0.58, share);
  const safe = nerf(0.74, 0.09, share);
  const x = state[base];
  const y = state[base + 1];
  const arena = state[ARENA];
  let found = 0;
  let bestDist = 0;
  let aimX = 0;
  let aimY = 0;
  let rawAimX = 0;
  let rawAimY = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    if (index === botIndex) continue;
    const other = PLAYER + index * STRIDE;
    if ((state[other + FLAGS] & ALIVE) === 0) continue;
    const dx = state[other] - x;
    const dy = state[other + 1] - y;
    const dist = Math.hypot(dx, dy);
    if (found === 1 && dist >= bestDist) continue;
    found = 1;
    bestDist = dist;
    rawAimX = state[other] + PREDICT * state[other + 2];
    rawAimY = state[other + 1] + PREDICT * state[other + 3];
    aimX = rawAimX;
    aimY = rawAimY;
  }

  const safeR = safe * arena;
  const outside = Math.hypot(x, y) > safeR;
  const chase = !outside && found === 1;
  const side = botIndex % 2 === 0 ? 1 : -1;
  if (chase) {
    const aimDx = rawAimX - x;
    const aimDy = rawAimY - y;
    const aimDist = Math.hypot(aimDx, aimDy);
    if (aimDist > 0) {
      const turn = nerf(0.24, -0.22, share) * side;
      const turnCos = Math.cos(turn);
      const turnSin = Math.sin(turn);
      aimX = x + aimDx * turnCos - aimDy * turnSin;
      aimY = y + aimDx * turnSin + aimDy * turnCos;
    }
    const aimR = Math.hypot(aimX, aimY);
    if (aimR > safeR && aimR > 0) {
      aimX *= safeR / aimR;
      aimY *= safeR / aimR;
    }
  }
  if (!outside && found === 0) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
    buttons[botIndex] = 0;
    return;
  }

  let targetX = 0;
  let targetY = 0;
  if (chase) {
    targetX = aimX;
    targetY = aimY;
  }
  const steerX = targetX - x;
  const steerY = targetY - y;
  const steerLen = Math.hypot(steerX, steerY);
  let unitX = 0;
  let unitY = 0;
  let contactYield = false;
  if (steerLen === 0 && found === 0) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
  } else if (chase && bestDist < CONTACT) {
    const meR = Math.hypot(x, y);
    const foeOut = Math.hypot(rawAimX, rawAimY);
    if (foeOut + 16 < meR && meR > 0) {
      contactYield = true;
      unitX = -x / meR;
      unitY = -y / meR;
    } else {
      let pushX = rawAimX;
      let pushY = rawAimY;
      let push = foeOut;
      if (push === 0) {
        pushX = side;
        pushY = share >= 0.5 ? 0 : side;
        push = Math.hypot(pushX, pushY);
      }
      pushX /= push;
      pushY /= push;
      const commit = nerf(0.35, 0.6, share);
      const slide = 1 - commit;
      unitX = pushX * commit - pushY * side * slide;
      unitY = pushY * commit + pushX * side * slide;
      const unit = Math.hypot(unitX, unitY);
      unitX /= unit;
      unitY /= unit;
    }
    axisX[botIndex] = Math.round(unitX * 127 * pace);
    axisY[botIndex] = Math.round(unitY * 127 * pace);
  } else if (steerLen === 0) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
  } else {
    unitX = steerX / steerLen;
    unitY = steerY / steerLen;
    let axisOutX = Math.round(unitX * 127 * pace);
    let axisOutY = Math.round(unitY * 127 * pace);
    if (axisOutX > 127) axisOutX = 127;
    if (axisOutX < -127) axisOutX = -127;
    if (axisOutY > 127) axisOutY = 127;
    if (axisOutY < -127) axisOutY = -127;
    axisX[botIndex] = axisOutX;
    axisY[botIndex] = axisOutY;
  }

  let dash = 0;
  if (found === 1 && steerLen > 0) {
    const aimDx = rawAimX - x;
    const aimDy = rawAimY - y;
    const aimDist = Math.hypot(aimDx, aimDy);
    const dashRange = nerf(60, 260, share);
    const alignNeed = nerf(0.96, -0.1, share);
    let align = 0;
    if (aimDist !== 0 && (unitX !== 0 || unitY !== 0)) {
      align = unitX * (aimDx / aimDist) + unitY * (aimDy / aimDist);
    }
    const landStick = Math.hypot(x + unitX * TRAVEL, y + unitY * TRAVEL);
    const stickDash = aimDist < dashRange && align > alignNeed && landStick <= DASH_LIMIT * arena;
    if (stickDash) {
      dash = 1;
    } else if (!contactYield && aimDist > 0 && aimDist < dashRange) {
      const faceX = steerX / steerLen;
      const faceY = steerY / steerLen;
      const faceAlign = faceX * (aimDx / aimDist) + faceY * (aimDy / aimDist);
      const land = Math.hypot(x + faceX * TRAVEL, y + faceY * TRAVEL);
      if (faceAlign > alignNeed && land <= DASH_LIMIT * arena) {
        dash = 1;
        let faceAxisX = Math.round(faceX * 127 * pace);
        let faceAxisY = Math.round(faceY * 127 * pace);
        if (faceAxisX > 127) faceAxisX = 127;
        if (faceAxisX < -127) faceAxisX = -127;
        if (faceAxisY > 127) faceAxisY = 127;
        if (faceAxisY < -127) faceAxisY = -127;
        axisX[botIndex] = faceAxisX;
        axisY[botIndex] = faceAxisY;
      }
    }
  }
  buttons[botIndex] = dash;
}
