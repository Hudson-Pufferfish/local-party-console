import { shortTag, targetScoreForState } from './scoreboard';

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

export function bannerCopy(
  phase: number,
  timer: number,
  winner?: string,
  suddenDeath = false,
): string {
  if (phase === 3) {
    return winner !== undefined && winner !== '' ? `${winner.toUpperCase()} WINS` : 'MATCH OVER';
  }
  if (phase === 2) {
    if (winner !== undefined && winner !== '') return `${winner.toUpperCase()} WINS`;
    if (suddenDeath) return 'SUDDEN DEATH';
    return 'POINT';
  }
  if (phase === 4 && timer > 0) {
    return suddenDeath ? `SUDDEN DEATH ${Math.ceil(timer)}` : `BREAK ${Math.ceil(timer)}`;
  }
  if (phase === 0 && timer > 0) {
    return suddenDeath ? `SUDDEN DEATH ${Math.ceil(timer)}` : String(Math.ceil(timer));
  }
  return '';
}
