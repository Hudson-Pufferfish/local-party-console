import {
  LAMP_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
} from './constants.ts';
import { isSuddenDeath, shortTag } from './scoreboard.ts';

export function bannerCopy(state: Float32Array, names: readonly string[]): string {
  const phase = state[H.phase] ?? P.countdown;
  const timer = state[H.phaseTimer] ?? 0;
  const lampFlags = (state[H.lampFlags] ?? 0) | 0;
  const winnerSlot = Math.round(state[H.winnerSlot] ?? -1);
  const sudden = isSuddenDeath(state);

  if (phase === P.matchOver) {
    if (winnerSlot >= 0 && winnerSlot < 8) {
      return `${shortTag(names[winnerSlot] ?? '', winnerSlot)} WINS`;
    }
    return 'MATCH OVER';
  }

  if (phase === P.roundEnd) {
    if ((lampFlags & LAMP_FLAG.voidRound) !== 0) return 'NO LOCK';
    if (winnerSlot >= 0 && winnerSlot < 8) {
      return `${shortTag(names[winnerSlot] ?? '', winnerSlot)} WINS`;
    }
    if (sudden) return 'SUDDEN DEATH';
    return 'POINT';
  }

  if (phase === P.practice && timer > 0) {
    return `BREAK ${Math.ceil(timer)}`;
  }

  if (phase === P.countdown && timer > 0) {
    return sudden ? `SUDDEN DEATH ${Math.ceil(timer)}` : String(Math.ceil(timer));
  }

  // FR-1: Strictly no clock or banner text during ROUND_ACTIVE.
  return '';
}
