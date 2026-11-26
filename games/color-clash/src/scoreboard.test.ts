import { expect, test } from 'vitest';
import { bannerCopy } from './banner';
import { PHASE_COUNTDOWN, PHASE_MATCH_OVER, PHASE_OVERTIME, PHASE_PRACTICE, PHASE_ROUND_ACTIVE, PHASE_ROUND_END } from './constants';
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
  state[PLAYER + 0 * STRIDE + 9] = 1; // 1 match point

  // Slot 1: 547 cells (34.1875% -> 34.2%)
  state[PLAYER + 1 * STRIDE + 0] = -10;
  state[PLAYER + 1 * STRIDE + 7] = (547 * 100) / 1600;
  state[PLAYER + 1 * STRIDE + 8] = 1;
  state[PLAYER + 1 * STRIDE + 9] = 2; // 2 match points

  expect(scoreboardHeader(state)).toBe('THRESHOLD: 3');
  const rows = scoreboardRows(
    state,
    ['Hudson', 'AlphaBot', '', '', '', '', '', ''],
    [
      { index: 0, connected: true },
    ],
  );
  expect(rows).toHaveLength(2);
  // Rows are emitted in slot index order (matching Sumo Dash and Bomb Pass)
  expect(rows[0]).toMatchObject({
    slot: 0,
    name: 'HUDSON',
    score: 1,
    status: 'LIVE',
  });
  expect(rows[1]).toMatchObject({
    slot: 1,
    name: 'ALPHAB',
    score: 2,
  });
  expect(rows[1]?.status).toBeUndefined();

  const rules = scoreRules(state);
  expect(rules?.guide).toBeDefined();
  expect(rules?.guide).toHaveLength(4);
  expect(rules?.rows).toEqual([
    { label: '1ST', value: '+1 PTS' },
    { label: '2ND', value: '+0 PTS' },
  ]);

  state[1] = PHASE_PRACTICE;
  state[2] = 29.5;
  expect(bannerCopy(state, ['Hudson', 'Alpha'])).toBe('BREAK 30');

  state[1] = PHASE_COUNTDOWN;
  state[2] = 2.4;
  expect(bannerCopy(state, ['Hudson', 'Alpha'])).toBe('3');

  state[1] = PHASE_OVERTIME;
  state[2] = 29.2;
  expect(scoreboardHeader(state)).toBe('OVERTIME 00:30');
  expect(bannerCopy(state, ['Hudson', 'Alpha'])).toBe('OVERTIME — CLAIM GOLDEN TILE');

  state[1] = PHASE_ROUND_END;
  state[7] = 1;
  expect(bannerCopy(state, ['Hudson', 'Alpha'])).toBe('POINT');

  state[1] = PHASE_MATCH_OVER;
  state[7] = 1;
  state[PLAYER + 1 * STRIDE + 9] = 3; // Reached threshold (3)
  expect(bannerCopy(state, ['Hudson', 'Alpha'])).toBe('ALPHA WINS');
});
