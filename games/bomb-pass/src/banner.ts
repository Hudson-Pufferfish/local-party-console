import {
  BOMB_CONSTANTS as C,
  BOMB_HEADER as H,
  BOMB_PHASE as P,
  BOMB_PLAYER_BASE as PLAYER,
  BOMB_PLAYER_STRIDE as STRIDE,
} from './constants.ts';
import { isRoundSuddenDeath, isSuddenDeath, shortTag, targetScoreForState } from './scoreboard.ts';

export function matchWinnerTag(
  state: Float32Array,
  names: readonly string[],
  win?: number,
): string | undefined {
  if (isRoundSuddenDeath(state)) return undefined;
  const target = win ?? targetScoreForState(state);
  let bestSlot = -1;
  let bestScore = -1;
  let bestCount = 0;
  for (let index = 0; index < C.maxPlayers; index += 1) {
    const score = state[PLAYER + index * STRIDE + 9] ?? 0;
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

export function formatFuseSeconds(seconds: number): string {
  const clamped = seconds > 0 && Number.isFinite(seconds) ? seconds : 0;
  return clamped.toFixed(1).padStart(4, '0');
}

export function bannerCopy(state: Float32Array, names: readonly string[]): string {
  const phase = state[H.phase] ?? 0;
  const timer = state[H.phaseTimer] ?? 0;
  const sudden = isSuddenDeath(state);
  const winner = matchWinnerTag(state, names);

  if (phase === P.matchOver) {
    return winner !== undefined && winner !== '' ? `${winner.toUpperCase()} WINS` : 'MATCH OVER';
  }
  if (phase === P.roundEnd) {
    if (isRoundSuddenDeath(state)) return 'SUDDEN DEATH';
    if (winner !== undefined && winner !== '') return `${winner.toUpperCase()} WINS`;
    if (sudden) return 'SUDDEN DEATH';
    return 'POINT';
  }
  if (phase === P.practice && timer > 0) {
    return sudden ? `SUDDEN DEATH ${Math.ceil(timer)}` : `BREAK ${Math.ceil(timer)}`;
  }
  if (phase === P.countdown && timer > 0) {
    return sudden ? `SUDDEN DEATH ${Math.ceil(timer)}` : String(Math.ceil(timer));
  }
  if (phase === P.active) {
    const holder = Math.round(state[H.bombHolder] ?? -1);
    if (holder < 0) return 'BOOM!';
    return `BOMB ${formatFuseSeconds(state[H.bombTimer] ?? 0)}`;
  }
  return '';
}
