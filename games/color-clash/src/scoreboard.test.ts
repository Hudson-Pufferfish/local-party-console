import { expect, test } from 'vitest';
import { bannerCopy } from './banner';
import { PHASE_COUNTDOWN, PHASE_FINAL_REVEAL, PHASE_MATCH_OVER, PHASE_OVERTIME, PHASE_ROUND_ACTIVE } from './constants';
import { scoreboardHeader, scoreboardRows, scoreRules, shortTag } from './scoreboard';

const PLAYER = 8;
const STRIDE = 10;

test('scoreboard formats 6-char tags, live percentages, coverage ratios, clock headers, rules, and banners', () => {
  expect(shortTag('Hudson Nguyen', 0)).toBe('HUDSON');
  expect(shortTag('  ', 2)).toBe('P3');

  const state = new Float32Array(88);
  state[1] = PHASE_ROUND_ACTIVE;
  state[2] = 44.1;
  state[7] = -1;

  // Slot 0: 320 cells (20.0%)
  state[PLAYER + 0 * STRIDE + 0] = 10;
  state[PLAYER + 0 * STRIDE + 7] = 20.0;
  state[PLAYER + 0 * STRIDE + 8] = 1;
  state[PLAYER + 0 * STRIDE + 9] = 320;

  // Slot 1: 547 cells (34.1875% -> 34.2%)
  state[PLAYER + 1 * STRIDE + 0] = -10;
  state[PLAYER + 1 * STRIDE + 7] = (547 * 100) / 1600;
  state[PLAYER + 1 * STRIDE + 8] = 1;
  state[PLAYER + 1 * STRIDE + 9] = 547;

  expect(scoreboardHeader(state)).toBe('TIME 00:45');
  const rows = scoreboardRows(
    state,
    ['Hudson', 'AlphaBot', '', '', '', '', '', ''],
    [
      { index: 0, connected: true },
    ],
  );
  expect(rows).toHaveLength(2);
  // Sorted by highest paintCells first
  expect(rows[0]).toMatchObject({
    slot: 1,
    name: 'ALPHAB',
    score: '34.2%',
    ratio: 547 / 1600,
  });
  expect(rows[0]?.status).toBeUndefined();
  expect(rows[1]).toMatchObject({
    slot: 0,
    name: 'HUDSON',
    score: '20.0%',
    ratio: 320 / 1600,
    status: 'LIVE',
  });

  expect(scoreRules(state)).toEqual({
    rows: [
      { label: 'MATCH', value: '45S' },
      { label: 'BOOST', value: '3S WIDE' },
      { label: 'TIE', value: '30S GOLDEN TILE' },
    ],
  });

  state[1] = PHASE_COUNTDOWN;
  state[2] = 2.4;
  expect(bannerCopy(state, ['Hudson', 'Alpha'])).toBe('3');

  state[1] = PHASE_OVERTIME;
  state[2] = 29.2;
  expect(scoreboardHeader(state)).toBe('OVERTIME 00:30');
  expect(bannerCopy(state, ['Hudson', 'Alpha'])).toBe('OVERTIME — CLAIM GOLDEN TILE');

  state[1] = PHASE_FINAL_REVEAL;
  state[7] = 1;
  expect(scoreboardHeader(state)).toBe('FINAL SCORES');
  expect(bannerCopy(state, ['Hudson', 'Alpha'])).toBe('ALPHA WINS · 34.2%');

  state[1] = PHASE_MATCH_OVER;
  expect(bannerCopy(state, ['Hudson', 'Alpha'])).toBe('ALPHA WINS');
});
