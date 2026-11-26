import { describe, expect, test } from 'vitest';
import {
  LAMP_FLAG,
  LIGHT_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PLAYER_OFFSET as OFF,
} from './constants.ts';
import {
  activePlayerCount,
  hasUniqueWinner,
  isSuddenDeath,
  scoreboardHeader,
  scoreboardRows,
  scoreRules,
  shortTag,
  targetScoreForCount,
} from './scoreboard.ts';
import { playerBase } from './state.ts';

function makeState(slots: number[], scores: number[], lampFlags = 0, winnerSlot = -1): Float32Array {
  const state = new Float32Array(88);
  state[H.lampFlags] = lampFlags;
  state[H.winnerSlot] = winnerSlot;
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i]!;
    const base = playerBase(slot);
    state[base + OFF.flags] = LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender;
    state[base + OFF.score] = scores[i] ?? 0;
  }
  return state;
}

describe('Last Light scoreboard and rules', () => {
  test('computes target scores, payout tables, guide copy, and keeps lobby size invariant when parked in sudden death', () => {
    expect(targetScoreForCount(2)).toBe(3);
    expect(targetScoreForCount(3)).toBe(6);
    expect(targetScoreForCount(4)).toBe(9);
    expect(targetScoreForCount(8)).toBe(21);

    // 4-player payout table: +3, +2, +1, +0
    const state4 = makeState([0, 1, 2, 3], [0, 0, 0, 0]);
    expect(activePlayerCount(state4)).toBe(4);
    expect(scoreboardHeader(state4)).toBe('THRESHOLD: 9');
    const rules4 = scoreRules(state4);
    expect(rules4?.guide).toEqual([
      'TAP TO LOCK IN',
      'LATEST TAP BEFORE THE BLOWOUT WINS',
      'NEVER TAPPED? YOU ARE OUT',
    ]);
    expect(rules4?.rows).toEqual([
      { label: '1ST', value: '+3 PTS' },
      { label: '2ND', value: '+2 PTS' },
      { label: '3RD', value: '+1 PTS' },
      { label: '4TH', value: '+0 PTS' },
    ]);

    // Sudden death: slot 2 is parked (ACTIVE & CONTENDER cleared, JOINED kept) -> N stays 3, payout collapses to +1
    const sd = makeState([0, 1, 2], [6, 6, 3], LAMP_FLAG.suddenDeath);
    sd[playerBase(2) + OFF.flags] = LIGHT_FLAG.joined;
    expect(activePlayerCount(sd)).toBe(3);
    expect(isSuddenDeath(sd)).toBe(true);
    expect(hasUniqueWinner(sd)).toBe(false);
    expect(scoreboardHeader(sd)).toBe('SUDDEN DEATH');
    expect(scoreRules(sd)?.rows).toEqual([{ label: '1ST', value: '+1 PTS' }]);
  });

  test('renders scoreboard rows with LIVE/AWAY status and shortTag normalization', () => {
    expect(shortTag('ada-01!', 0)).toBe('ADA01');
    expect(shortTag('!!!', 2)).toBe('P3');

    const state = makeState([0, 1], [2, 3], 0, 1);
    expect(hasUniqueWinner(state)).toBe(true);
    const rows = scoreboardRows(state, ['Ada', 'Beau'], [
      { index: 0, connected: true },
      { index: 1, connected: false },
    ]);
    expect(rows).toEqual([
      { slot: 0, color: '#FF4D00', name: 'ADA', score: 2, status: 'LIVE' },
      { slot: 1, color: '#00C853', name: 'BEAU', score: 3, status: 'AWAY' },
    ]);
  });
});
