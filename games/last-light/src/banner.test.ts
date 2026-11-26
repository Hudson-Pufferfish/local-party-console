import { describe, expect, test } from 'vitest';
import { bannerCopy } from './banner.ts';
import {
  LAMP_FLAG,
  LIGHT_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
  LIGHT_PLAYER_OFFSET as OFF,
} from './constants.ts';
import { playerBase } from './state.ts';

function stateWith(phase: number, timer: number, lampFlags = 0, winnerSlot = -1): Float32Array {
  const state = new Float32Array(88);
  state[H.phase] = phase;
  state[H.phaseTimer] = timer;
  state[H.lampFlags] = lampFlags;
  state[H.winnerSlot] = winnerSlot;
  for (let i = 0; i < 2; i += 1) {
    state[playerBase(i) + OFF.flags] = LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender;
  }
  return state;
}

describe('Last Light banner copy', () => {
  test('never displays any clock during ROUND_ACTIVE and formats practice, countdown, void, point, sudden death, and winner copy', () => {
    const names = ['Ada', 'Beau'];
    expect(bannerCopy(stateWith(P.practice, 19.2), names)).toBe('BREAK 20');
    expect(bannerCopy(stateWith(P.countdown, 2.4), names)).toBe('3');
    expect(bannerCopy(stateWith(P.countdown, 2.4, LAMP_FLAG.suddenDeath), names)).toBe('SUDDEN DEATH 3');
    // FR-1: Zero clock or text during ROUND_ACTIVE.
    const active = stateWith(P.active, 0, LAMP_FLAG.lit);
    active[H.lampElapsed] = 5.5;
    expect(bannerCopy(active, names)).toBe('');

    expect(bannerCopy(stateWith(P.roundEnd, 0.5, LAMP_FLAG.blown | LAMP_FLAG.voidRound), names)).toBe('NO LOCK');
    expect(bannerCopy(stateWith(P.roundEnd, 0.5, LAMP_FLAG.blown), names)).toBe('POINT');
    expect(bannerCopy(stateWith(P.roundEnd, 0.5, LAMP_FLAG.blown | LAMP_FLAG.suddenDeath), names)).toBe('SUDDEN DEATH');
    expect(bannerCopy(stateWith(P.roundEnd, 0.5, LAMP_FLAG.blown, 1), names)).toBe('BEAU WINS');
    expect(bannerCopy(stateWith(P.matchOver, 0, LAMP_FLAG.blown, 0), names)).toBe('ADA WINS');
    expect(bannerCopy(stateWith(P.matchOver, 0, LAMP_FLAG.blown, -1), names)).toBe('MATCH OVER');
  });
});
