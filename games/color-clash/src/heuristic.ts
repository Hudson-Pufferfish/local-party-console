import {
  DEFAULT_BOT_DIFFICULTY,
  assignBotScores,
  type BotDifficulty,
} from '../../../shared/src/bot-difficulty.ts';
import {
  COLOR_CLASH_CONSTANTS as C,
  FLAG_ACTIVE,
  FLAG_CONTENDER,
  PHASE_OVERTIME,
} from './constants.ts';

export const LEVEL_SCALE = 100;
const DEFAULT_LEVEL = 40;
const PHASE = 1;
const GOLDEN = 4;
const PLAYER = 8;
const STRIDE = 10;
const SLOTS = 8;
const SECTORS = 8;
const SECTOR_CELLS = 5;
const WALL_MARGIN = 350;
const LOOKAHEAD = 80;

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

function clampAxis(value: number): number {
  const rounded = Math.round(value);
  if (rounded > 127) return 127;
  if (rounded < -127) return -127;
  return rounded;
}

export function writeHeuristic(
  state: Float32Array,
  botIndex: number,
  axisX: Int8Array,
  axisY: Int8Array,
  buttons: Uint8Array,
  level = DEFAULT_LEVEL,
  auxState?: Uint8Array,
): void {
  if (botIndex !== (botIndex | 0) || botIndex < 0 || botIndex > 7) {
    return;
  }

  const base = PLAYER + botIndex * STRIDE;
  const flags = state[base + 8] ?? 0;
  if ((flags & FLAG_ACTIVE) === 0 || auxState === undefined || auxState.length < C.gridCells) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
    buttons[botIndex] = 0;
    return;
  }

  const skill = clampLevel(level);
  const share = skill / LEVEL_SCALE;
  const x = state[base] ?? 0;
  const y = state[base + 1] ?? 0;
  const angle = state[base + 4] ?? 0;
  const boostCooldown = state[base + 5] ?? 0;
  const pace = nerf(0.55, 0.45, share);

  const phase = state[PHASE] ?? 0;
  const golden = Math.trunc(state[GOLDEN] ?? -1);

  // 1. Overtime Golden Tile priority
  if (phase === PHASE_OVERTIME && golden >= 0 && golden < C.gridCells && (flags & FLAG_CONTENDER) !== 0) {
    const gCol = golden % C.gridSize;
    const gRow = (golden - gCol) / C.gridSize;
    const gx = -C.halfArena + (gCol + 0.5) * C.cellSize;
    const gy = -C.halfArena + (gRow + 0.5) * C.cellSize;
    const dx = gx - x;
    const dy = gy - y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      const ux = dx / dist;
      const uy = dy / dist;
      axisX[botIndex] = clampAxis(ux * 127 * pace);
      axisY[botIndex] = clampAxis(uy * 127 * pace);
      const headingDot = Math.cos(angle) * ux + Math.sin(angle) * uy;
      buttons[botIndex] = boostCooldown <= 0 && dist > LOOKAHEAD && headingDot > 0.85 ? 1 : 0;
    } else {
      axisX[botIndex] = 0;
      axisY[botIndex] = 0;
      buttons[botIndex] = 0;
    }
    return;
  }

  // 2. Coarse 8x8 sector scan (5x5 cells each)
  const ownId = botIndex + 1;
  const wOpp = nerf(0.75, 0.70, share);
  let bestValue = -1;
  let bestTargetX = 0;
  let bestTargetY = 0;

  for (let sr = 0; sr < SECTORS; sr += 1) {
    const rowStart = sr * SECTOR_CELLS;
    const sy = -C.halfArena + (rowStart + 2.5) * C.cellSize;
    for (let sc = 0; sc < SECTORS; sc += 1) {
      const colStart = sc * SECTOR_CELLS;
      let unpainted = 0;
      let opponent = 0;
      for (let r = rowStart; r < rowStart + SECTOR_CELLS; r += 1) {
        const rowOff = r * C.gridSize;
        for (let c = colStart; c < colStart + SECTOR_CELLS; c += 1) {
          const owner = auxState[rowOff + c];
          if (owner === 0) unpainted += 1;
          else if (owner !== ownId) opponent += 1;
        }
      }
      const sx = -C.halfArena + (colStart + 2.5) * C.cellSize;
      const dist = Math.hypot(sx - x, sy - y);
      const value = (unpainted + opponent * wOpp) / (dist + 160);
      if (value > bestValue) {
        bestValue = value;
        bestTargetX = sx;
        bestTargetY = sy;
      }
    }
  }

  if (bestValue <= 0) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
    buttons[botIndex] = 0;
    return;
  }

  // 3. Steering & wall margin clamp + slot-sided wobble
  if (bestTargetX > WALL_MARGIN) bestTargetX = WALL_MARGIN;
  else if (bestTargetX < -WALL_MARGIN) bestTargetX = -WALL_MARGIN;
  if (bestTargetY > WALL_MARGIN) bestTargetY = WALL_MARGIN;
  else if (bestTargetY < -WALL_MARGIN) bestTargetY = -WALL_MARGIN;

  const dx = bestTargetX - x;
  const dy = bestTargetY - y;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    axisX[botIndex] = 0;
    axisY[botIndex] = 0;
    buttons[botIndex] = 0;
    return;
  }

  const side = botIndex % 2 === 0 ? 1 : -1;
  const wobble = nerf(0.26, -0.22, share) * side;
  const steerAngle = Math.atan2(dy, dx) + wobble;
  const ux = Math.cos(steerAngle);
  const uy = Math.sin(steerAngle);

  axisX[botIndex] = clampAxis(ux * 127 * pace);
  axisY[botIndex] = clampAxis(uy * 127 * pace);

  // 4. Dense-cluster BOOST trigger (5x5 cell window 80 units ahead)
  let boost = 0;
  if (boostCooldown <= 0) {
    const fx = x + ux * LOOKAHEAD;
    const fy = y + uy * LOOKAHEAD;
    let fCol = Math.floor((fx + C.halfArena) / C.cellSize);
    let fRow = Math.floor((fy + C.halfArena) / C.cellSize);
    if (fCol < 0) fCol = 0;
    else if (fCol > C.gridSize - 1) fCol = C.gridSize - 1;
    if (fRow < 0) fRow = 0;
    else if (fRow > C.gridSize - 1) fRow = C.gridSize - 1;

    let nonOwned = 0;
    for (let dr = -2; dr <= 2; dr += 1) {
      const r = fRow + dr;
      if (r < 0 || r >= C.gridSize) continue;
      const rowOff = r * C.gridSize;
      for (let dc = -2; dc <= 2; dc += 1) {
        const c = fCol + dc;
        if (c < 0 || c >= C.gridSize) continue;
        if (auxState[rowOff + c] !== ownId) nonOwned += 1;
      }
    }

    const needed = Math.round(nerf(18, -6, share));
    const alignNeed = nerf(0.92, -0.12, share);
    const headingDot = Math.cos(angle) * ux + Math.sin(angle) * uy;
    if (nonOwned >= needed && headingDot >= alignNeed) {
      boost = 1;
    }
  }
  buttons[botIndex] = boost;
}
