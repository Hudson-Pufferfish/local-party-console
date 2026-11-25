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
  let bestAlive = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    const base = PLAYER + index * STRIDE;
    const score = state[base + 9] ?? 0;
    if (score < target) continue;
    const alive = (state[base + 8] ?? 0) & 1;
    if (score > bestScore || (score === bestScore && alive > bestAlive)) {
      bestSlot = index;
      bestScore = score;
      bestAlive = alive;
    }
  }
  if (bestSlot < 0) return undefined;
  return shortTag(names[bestSlot] ?? '', bestSlot);
}

export function bannerCopy(phase: number, timer: number, winner?: string): string {
  if (phase === 3) {
    return winner !== undefined && winner !== '' ? `${winner.toUpperCase()} WINS` : 'MATCH OVER';
  }
  if (phase === 2) {
    if (winner !== undefined && winner !== '') return `${winner.toUpperCase()} WINS`;
    return 'POINT';
  }
  if (phase === 4 && timer > 0) return `BREAK ${Math.ceil(timer)}`;
  if (phase === 0 && timer > 0) return String(Math.ceil(timer));
  return '';
}
