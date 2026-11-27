import {
  DEFAULT_BOT_DIFFICULTY,
  assignBotScores,
  type BotDifficulty,
} from '../../../shared/src/bot-difficulty.ts';
import {
  LAMP_FLAG,
  LAST_LIGHT_CONSTANTS as C,
  LIGHT_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
} from './constants.ts';
import { readPlayerFlags } from './state.ts';

export const LEVEL_SCALE = 100;
const DEFAULT_LEVEL = 40;
const SLOTS = C.maxPlayers;
const NEVER_TAP = 9999;

export type LevelRng = () => number;

// Pre-allocated module-level typed arrays for zero-allocation hot path (INV-9).
const plannedKey = new Int32Array(SLOTS);
const plannedTargetSec = new Float32Array(SLOTS);
plannedKey.fill(-1);

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

function hashToUnit(seed: number): number {
  let z = (seed + 0x6d2b79f5) >>> 0;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
}

function blunderRateForLevel(skill: number): number {
  if (skill <= 20) return 0.20;
  if (skill <= 40) return 0.20 - ((skill - 20) / 20) * 0.12;
  if (skill <= 60) return 0.08 - ((skill - 40) / 20) * 0.05;
  return 0.03;
}

function computePlanSec(
  blowoutCount: number,
  botIndex: number,
  skill: number,
  practice: boolean,
): number {
  const baseSeed =
    (Math.imul((blowoutCount | 0) + 1, 0x9e3779b1)
      ^ Math.imul(botIndex + 1, 0x85ebca6b)
      ^ Math.imul(skill, 0xc2b2ae35)
      ^ (practice ? 0x27d4eb2f : 0x165667b1)) >>> 0;

  const uBlunder = hashToUnit(baseSeed);
  if (uBlunder < blunderRateForLevel(skill)) {
    return NEVER_TAP;
  }

  const u1 = Math.max(1e-6, hashToUnit((baseSeed + 0x517cc1b7) >>> 0));
  const u2 = hashToUnit((baseSeed + 0xa5a3564e) >>> 0);
  let gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
  if (gauss < -2.2) gauss = -2.2;
  if (gauss > 2.2) gauss = 2.2;

  const share = skill / LEVEL_SCALE;
  // Greed nerve curve: Easy (~0.15) locks early with wide spread; Hard (~0.62) pushes late with tight spread.
  const meanFrac = 0.16 + share * 0.74;
  const stdFrac = Math.max(0.05, 0.19 - share * 0.20);
  let frac = meanFrac + gauss * stdFrac;
  if (frac < 0.04) frac = 0.04;
  if (frac > 0.94) frac = 0.94;

  const minSec = practice ? C.practiceMinSec : C.scoredMinSec;
  const maxSec = practice ? C.practiceMaxSec : C.scoredMaxSec;
  return minSec + (maxSec - minSec) * frac;
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

  axisX[botIndex] = 0;
  axisY[botIndex] = 0;

  const phase = state[H.phase] ?? P.countdown;
  const lampFlags = (state[H.lampFlags] ?? 0) | 0;
  const practice = phase === P.practice && (lampFlags & LAMP_FLAG.practiceBlowout) !== 0;
  const liveBlowout = (lampFlags & LAMP_FLAG.lit) !== 0 && (phase === P.active || practice);

  if (!liveBlowout) {
    buttons[botIndex] = 0;
    return;
  }

  const flags = readPlayerFlags(state, botIndex);
  if (
    (flags & LIGHT_FLAG.active) === 0
    || (flags & LIGHT_FLAG.contender) === 0
    || (flags & LIGHT_FLAG.locked) !== 0
  ) {
    buttons[botIndex] = 0;
    return;
  }

  const skill = clampLevel(level);
  const blowoutCount = (state[H.blowoutCount] ?? 0) | 0;
  const key = ((blowoutCount << 11) ^ (skill << 4) ^ (practice ? 8 : 0) ^ (phase & 7)) | 0;

  if (plannedKey[botIndex] !== key) {
    plannedKey[botIndex] = key;
    plannedTargetSec[botIndex] = computePlanSec(blowoutCount, botIndex, skill, practice);
  }

  const elapsed = state[H.lampElapsed] ?? 0;
  buttons[botIndex] = elapsed >= (plannedTargetSec[botIndex] ?? NEVER_TAP) ? 1 : 0;
}
