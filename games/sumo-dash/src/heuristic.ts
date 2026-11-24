import { SUMO_CONSTANTS } from './constants';

const HOME_RADIUS = 0.72;
const PREDICT = 0.15;
const DASH_RANGE = 180;
const ALIGN = 0.88;
const DASH_LIMIT = 0.85;
const TRAVEL = SUMO_CONSTANTS.dashSpeed * SUMO_CONSTANTS.dashActive;
const ARENA = 3;
const PLAYER = 8;
const STRIDE = 10;
const FLAGS = 8;
const ALIVE = 1;
const SLOTS = 8;

export function writeHeuristic(
  state: Float32Array,
  botIndex: number,
  axisX: Int8Array,
  axisY: Int8Array,
  buttons: Uint8Array,
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

  const outside = Math.hypot(x, y) > HOME_RADIUS * arena;
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
  if (steerLen === 0) {
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
  if (found === 1 && steerLen !== 0) {
    const aimDx = aimX - x;
    const aimDy = aimY - y;
    const aimDist = Math.hypot(aimDx, aimDy);
    let align = 0;
    if (aimDist !== 0) {
      align = unitX * (aimDx / aimDist) + unitY * (aimDy / aimDist);
    }
    const land = Math.hypot(x + unitX * TRAVEL, y + unitY * TRAVEL);
    if (aimDist < DASH_RANGE && align > ALIGN && land <= DASH_LIMIT * arena) {
      dash = 1;
    }
  }
  buttons[botIndex] = dash;
}
