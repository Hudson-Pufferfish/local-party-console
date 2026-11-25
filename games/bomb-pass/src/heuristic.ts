import {
  DEFAULT_BOT_DIFFICULTY,
  assignBotScores,
  type BotDifficulty,
} from '../../../shared/src/bot-difficulty.ts';
import {
  BOMB_CONSTANTS as C,
  BOMB_FLAG_ALIVE,
  BOMB_HEADER as H,
  BOMB_PLAYER_BASE as PLAYER,
  BOMB_PLAYER_STRIDE as STRIDE,
} from './constants.ts';

export const LEVEL_SCALE = 100;
const DEFAULT_LEVEL = 40;
const SLOTS = C.maxPlayers;
const TRAVEL = C.dashSpeed * C.dashActive;

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

function clampAxis(raw: number): number {
  let v = Math.round(raw);
  if (v > 127) v = 127;
  if (v < -127) v = -127;
  return v;
}

export function writeHeuristic(
  state: Float32Array,
  botIndex: number,
  axisX: Int8Array,
  axisY: Int8Array,
  buttons: Uint8Array,
  level = DEFAULT_LEVEL,
): void {
  if (botIndex !== (botIndex | 0) || botIndex < 0 || botIndex >= SLOTS) return;

  const base = PLAYER + botIndex * STRIDE;
  if ((state[base + 8] & BOMB_FLAG_ALIVE) === 0) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
    buttons[botIndex] = 0;
    return;
  }

  const skill = clampLevel(level);
  const share = skill / LEVEL_SCALE;
  const side = botIndex % 2 === 0 ? 1 : -1;
  const x = state[base];
  const y = state[base + 1];
  const arenaRaw = state[H.arenaRadius];
  const arena = arenaRaw > 0 ? arenaRaw : C.arenaRadius;
  const holder = Math.round(state[H.bombHolder] ?? -1);

  // 1. Holding the bomb -> CHASE nearest alive opponent
  if (holder === botIndex) {
    let bestSlot = -1;
    let bestDist = Infinity;
    for (let j = 0; j < SLOTS; j += 1) {
      if (j === botIndex) continue;
      const other = PLAYER + j * STRIDE;
      if ((state[other + 8] & BOMB_FLAG_ALIVE) === 0) continue;
      const dist = Math.hypot(state[other] - x, state[other + 1] - y);
      if (dist < bestDist) {
        bestDist = dist;
        bestSlot = j;
      }
    }

    if (bestSlot < 0) {
      axisX[botIndex] = 0;
      axisY[botIndex] = 0;
      buttons[botIndex] = 0;
      return;
    }

    const other = PLAYER + bestSlot * STRIDE;
    const lead = nerf(0.06, 0.14, share);
    let aimX = state[other] + lead * state[other + 2];
    let aimY = state[other + 1] + lead * state[other + 3];
    const maxAimR = 0.92 * arena;
    const aimR = Math.hypot(aimX, aimY);
    if (aimR > maxAimR && aimR > 0) {
      aimX *= maxAimR / aimR;
      aimY *= maxAimR / aimR;
    }

    const rawDx = aimX - x;
    const rawDy = aimY - y;
    const rawDist = Math.hypot(rawDx, rawDy);
    if (rawDist === 0) {
      axisX[botIndex] = 0;
      axisY[botIndex] = 0;
      buttons[botIndex] = 0;
      return;
    }

    const turn = nerf(0.20, -0.18, share) * side;
    const tc = Math.cos(turn);
    const ts = Math.sin(turn);
    const rx = rawDx * tc - rawDy * ts;
    const ry = rawDx * ts + rawDy * tc;
    const rLen = Math.hypot(rx, ry);
    const ux = rLen > 0 ? rx / rLen : 0;
    const uy = rLen > 0 ? ry / rLen : 0;
    const pace = nerf(0.48, 0.52, share);

    axisX[botIndex] = clampAxis(ux * 127 * pace);
    axisY[botIndex] = clampAxis(uy * 127 * pace);

    let dash = 0;
    if (state[H.transferCooldown] <= 0 && bestDist < nerf(90, 170, share)) {
      const align = ux * (rawDx / rawDist) + uy * (rawDy / rawDist);
      if (align > nerf(0.94, -0.10, share)) {
        dash = 1;
      }
    }
    buttons[botIndex] = dash;
    return;
  }

  // 2. Not holding the bomb & bomb is active -> FLEE with wall-slide avoidance
  if (holder >= 0 && holder < SLOTS) {
    const hBase = PLAYER + holder * STRIDE;
    const hx = state[hBase];
    const hy = state[hBase + 1];
    const fx = x - hx;
    const fy = y - hy;
    const fDist = Math.hypot(fx, fy);

    let ux = fDist > 0 ? fx / fDist : side;
    let uy = fDist > 0 ? fy / fDist : 0;

    const meR = Math.hypot(x, y);
    if (meR > 0.72 * arena && meR > 0) {
      const rx = x / meR;
      const ry = y / meR;
      const lat = (hx - x) * -ry + (hy - y) * rx;
      let tSign = side;
      if (lat > 1e-3) tSign = -1;
      else if (lat < -1e-3) tSign = 1;
      const tx = -ry * tSign;
      const ty = rx * tSign;

      let w = (meR / arena - 0.72) / 0.2;
      if (w < 0) w = 0;
      if (w > 1) w = 1;

      const outDot = ux * rx + uy * ry;
      if (outDot > 0) {
        ux -= rx * outDot * (0.6 + 0.4 * w);
        uy -= ry * outDot * (0.6 + 0.4 * w);
      }

      const tangentWeight = 0.65 + 0.6 * w;
      ux += tx * tangentWeight;
      uy += ty * tangentWeight;

      if (meR > 0.85 * arena) {
        ux -= rx * 0.55;
        uy -= ry * 0.55;
      }

      const uLen = Math.hypot(ux, uy);
      if (uLen > 0) {
        ux /= uLen;
        uy /= uLen;
      }
    }

    const pace = nerf(0.42, 0.58, share);
    axisX[botIndex] = clampAxis(ux * 127 * pace);
    axisY[botIndex] = clampAxis(uy * 127 * pace);

    const panicDist = nerf(85, 95, share);
    const urgent = state[H.bombTimer] <= 3.0 && fDist < 190;
    let dash = 0;
    if (fDist < panicDist || urgent) {
      const landR = Math.hypot(x + ux * TRAVEL, y + uy * TRAVEL);
      if (landR <= 0.92 * arena) {
        dash = 1;
      }
    }
    buttons[botIndex] = dash;
    return;
  }

  // 3. No active bomb -> spread gently away from closest alive puck inside 0.65 * R
  let nearSlot = -1;
  let nearDist = Infinity;
  for (let j = 0; j < SLOTS; j += 1) {
    if (j === botIndex) continue;
    const other = PLAYER + j * STRIDE;
    if ((state[other + 8] & BOMB_FLAG_ALIVE) === 0) continue;
    const d = Math.hypot(state[other] - x, state[other + 1] - y);
    if (d < nearDist) {
      nearDist = d;
      nearSlot = j;
    }
  }

  let sx = 0;
  let sy = 0;
  const meR = Math.hypot(x, y);
  if (meR > 0.65 * arena && meR > 0) {
    sx = -x / meR;
    sy = -y / meR;
  } else if (nearSlot >= 0) {
    const other = PLAYER + nearSlot * STRIDE;
    const dx = x - state[other];
    const dy = y - state[other + 1];
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      sx = dx / len;
      sy = dy / len;
    }
  }
  axisX[botIndex] = clampAxis(sx * 127 * 0.5);
  axisY[botIndex] = clampAxis(sy * 127 * 0.5);
  buttons[botIndex] = 0;
}
