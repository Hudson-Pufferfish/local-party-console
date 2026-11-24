import { SUMO_CONSTANTS } from './constants';

const PREDICT = 0.15;
const DASH_LIMIT = 0.85;
const CONTACT = SUMO_CONSTANTS.puckRadius * 2 + 40;
const TRAVEL = SUMO_CONSTANTS.dashSpeed * SUMO_CONSTANTS.dashActive;
const ARENA = 3;
const PLAYER = 8;
const STRIDE = 10;
const FLAGS = 8;
const ALIVE = 1;
const SLOTS = 8;

const LEVEL_TABLE: readonly (readonly number[])[] = [
  [],
  [3],
  [2, 5],
  [1, 3, 5],
  [1, 3, 5, 7],
  [1, 2, 4, 5, 7],
  [1, 2, 3, 5, 6, 7],
  [1, 2, 3, 4, 5, 6, 7],
];

export function assignBotLevels(count: number): readonly number[] {
  let n = Math.trunc(count);
  if (!Number.isFinite(count) || n < 0) n = 0;
  if (n > 7) n = 7;
  return LEVEL_TABLE[n] ?? [];
}

export function levelsForMask(mask: Uint8Array): Uint8Array {
  let count = 0;
  const limit = mask.length < SLOTS ? mask.length : SLOTS;
  for (let index = 0; index < limit; index += 1) {
    if (mask[index] === 1) count += 1;
  }
  const levels = assignBotLevels(count);
  const out = new Uint8Array(SLOTS);
  let placed = 0;
  for (let index = 0; index < limit; index += 1) {
    if (mask[index] !== 1 || placed >= levels.length) continue;
    out[index] = levels[placed] ?? 1;
    placed += 1;
  }
  return out;
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 4;
  let value = Math.trunc(level);
  if (value < 1) value = 1;
  if (value > 7) value = 7;
  return value;
}

export function writeHeuristic(
  state: Float32Array,
  botIndex: number,
  axisX: Int8Array,
  axisY: Int8Array,
  buttons: Uint8Array,
  level = 7,
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
  const home = 0.48 + skill * 0.04;
  const x = state[base];
  const y = state[base + 1];
  const arena = state[ARENA];
  let found = 0;
  let bestDist = 0;
  let aimX = 0;
  let aimY = 0;
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
    aimX = state[other] + PREDICT * state[other + 2];
    aimY = state[other + 1] + PREDICT * state[other + 3];
  }

  const outside = Math.hypot(x, y) > home * arena;
  if (!outside && found === 1) {
    const aimDx = aimX - x;
    const aimDy = aimY - y;
    const aimDist = Math.hypot(aimDx, aimDy);
    if (aimDist > 0) {
      const side = botIndex % 2 === 0 ? 1 : -1;
      const slip = (8 - skill) * 22;
      aimX += side * (-aimDy / aimDist) * slip;
      aimY += side * (aimDx / aimDist) * slip;
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
  if (!outside) {
    targetX = aimX;
    targetY = aimY;
  }
  const steerX = targetX - x;
  const steerY = targetY - y;
  const steerLen = Math.hypot(steerX, steerY);
  let unitX = 0;
  let unitY = 0;
  if (steerLen === 0 && found === 0) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
  } else if (found === 1 && bestDist < CONTACT) {
    const side = botIndex % 2 === 0 ? 1 : -1;
    unitX = side;
    unitY = skill >= 5 ? 0 : side;
    const unit = Math.hypot(unitX, unitY);
    unitX /= unit;
    unitY /= unit;
    axisX[botIndex] = Math.round(unitX * 127);
    axisY[botIndex] = Math.round(unitY * 127);
  } else if (steerLen === 0) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
  } else {
    unitX = steerX / steerLen;
    unitY = steerY / steerLen;
    let axisOutX = Math.round(unitX * 127);
    let axisOutY = Math.round(unitY * 127);
    if (axisOutX > 127) axisOutX = 127;
    if (axisOutX < -127) axisOutX = -127;
    if (axisOutY > 127) axisOutY = 127;
    if (axisOutY < -127) axisOutY = -127;
    axisX[botIndex] = axisOutX;
    axisY[botIndex] = axisOutY;
  }

  let dash = 0;
  if (found === 1 && (unitX !== 0 || unitY !== 0)) {
    const aimDx = aimX - x;
    const aimDy = aimY - y;
    const aimDist = Math.hypot(aimDx, aimDy);
    let align = 0;
    if (aimDist !== 0) {
      align = unitX * (aimDx / aimDist) + unitY * (aimDy / aimDist);
    }
    const land = Math.hypot(x + unitX * TRAVEL, y + unitY * TRAVEL);
    const dashRange = 70 + skill * 20;
    const alignNeed = 0.97 - skill * 0.014;
    if (aimDist < dashRange && align > alignNeed && land <= DASH_LIMIT * arena) {
      dash = 1;
    }
  }
  buttons[botIndex] = dash;
}
