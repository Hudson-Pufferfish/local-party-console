import {
  PHASE_COUNTDOWN,
  PHASE_FINAL_REVEAL,
  PHASE_MATCH_OVER,
  PHASE_OVERTIME,
} from './constants.ts';
import { shortTag } from './scoreboard.ts';

const PLAYER = 8;
const STRIDE = 10;
const WINNER = 7;

export function bannerCopy(state: Float32Array, names: readonly string[]): string {
  const phase = state[1] ?? PHASE_COUNTDOWN;
  const timer = state[2] ?? 0;
  const winnerSlot = Math.trunc(state[WINNER] ?? -1);

  if (phase === PHASE_COUNTDOWN && timer > 0) {
    return String(Math.ceil(timer));
  }
  if (phase === PHASE_OVERTIME) {
    return 'OVERTIME — CLAIM GOLDEN TILE';
  }
  if (phase === PHASE_FINAL_REVEAL) {
    if (winnerSlot >= 0 && winnerSlot < 8) {
      const tag = shortTag(names[winnerSlot] ?? '', winnerSlot);
      const pct = state[PLAYER + winnerSlot * STRIDE + 7] ?? 0;
      return `${tag} WINS · ${pct.toFixed(1)}%`;
    }
    return 'TIME UP';
  }
  if (phase === PHASE_MATCH_OVER) {
    if (winnerSlot >= 0 && winnerSlot < 8) {
      const tag = shortTag(names[winnerSlot] ?? '', winnerSlot);
      return `${tag} WINS`;
    }
    return 'MATCH OVER';
  }
  return '';
}
