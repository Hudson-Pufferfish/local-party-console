import { shortTag } from './scoreboard';

const PLAYER = 8;
const STRIDE = 10;
const SLOTS = 8;

export function matchWinnerTag(
  state: Float32Array,
  names: readonly string[],
  win: number,
): string | undefined {
  for (let index = 0; index < SLOTS; index += 1) {
    const score = state[PLAYER + index * STRIDE + 9] ?? 0;
    if (score >= win) return shortTag(names[index] ?? '', index);
  }
  return undefined;
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
