import {
  PHASE_COUNTDOWN,
  PHASE_MATCH_OVER,
  PHASE_OVERTIME,
  PHASE_PRACTICE,
  PHASE_ROUND_END,
} from './constants.ts';
import { isSuddenDeath, shortTag, targetScoreForState } from './scoreboard.ts';

const PLAYER = 8;
const STRIDE = 10;
const SLOTS = 8;

export function matchWinnerTag(
  state: Float32Array,
  names: readonly string[],
  win?: number,
): string | undefined {
  const target = win ?? targetScoreForState(state);
  let bestSlot = -1;
  let bestScore = -1;
  let bestCount = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    const base = PLAYER + index * STRIDE;
    const score = state[base + 9] ?? 0;
    if (score < target) continue;
    if (score > bestScore) {
      bestSlot = index;
      bestScore = score;
      bestCount = 1;
    } else if (score === bestScore) {
      bestCount += 1;
    }
  }
  if (bestSlot < 0 || bestCount !== 1) return undefined;
  return shortTag(names[bestSlot] ?? '', bestSlot);
}

export function bannerCopy(state: Float32Array, names: readonly string[]): string {
  const phase = state[1] ?? PHASE_COUNTDOWN;
  const timer = state[2] ?? 0;
  const sudden = isSuddenDeath(state);
  const winner = matchWinnerTag(state, names);

  if (phase === PHASE_MATCH_OVER) {
    return winner !== undefined && winner !== '' ? `${winner.toUpperCase()} WINS` : 'MATCH OVER';
  }
  if (phase === PHASE_ROUND_END) {
    if (winner !== undefined && winner !== '') return `${winner.toUpperCase()} WINS`;
    if (sudden) return 'SUDDEN DEATH';
    return 'POINT';
  }
  if (phase === PHASE_PRACTICE && timer > 0) {
    return sudden ? `SUDDEN DEATH ${Math.ceil(timer)}` : `BREAK ${Math.ceil(timer)}`;
  }
  if (phase === PHASE_COUNTDOWN && timer > 0) {
    return sudden ? `SUDDEN DEATH ${Math.ceil(timer)}` : String(Math.ceil(timer));
  }
  if (phase === PHASE_OVERTIME) {
    return 'OVERTIME — CLAIM GOLDEN TILE';
  }
  return '';
}
