import { expect, test } from 'vitest';
import {
  COLOR_CLASH_CONSTANTS as C,
  PHASE_COUNTDOWN,
  PHASE_MATCH_OVER,
  PHASE_PRACTICE,
  PHASE_ROUND_ACTIVE,
  PHASE_ROUND_END,
} from './constants';
import { eventsFromHeaderDiff } from './events';

const TICK = 0;
const PHASE = 1;
const WINNER = 7;
const PLAYER = 8;
const STRIDE = 10;
const BOOST_ACTIVE = 6;
const PAINT_PCT = 7;
const SCORE = 9;

test('eventsFromHeaderDiff generates round_start, round_end, match_start, boost, scores, and match_end', () => {
  const prev = new Float32Array(88);
  const next = new Float32Array(88);

  // Transition from PRACTICE to COUNTDOWN
  prev[PHASE] = PHASE_PRACTICE;
  prev[TICK] = 100;
  next[PHASE] = PHASE_COUNTDOWN;
  next[TICK] = 101;
  next[PLAYER + 0 * STRIDE + SCORE] = 2;
  next[PLAYER + 1 * STRIDE + SCORE] = 1;

  let envelopes = eventsFromHeaderDiff(prev, next);
  expect(envelopes.some((e) => e.type === 'color:round_start')).toBe(true);
  expect(envelopes.some((e) => e.type === 'color:match_start')).toBe(true);
  const roundStart = envelopes.find((e) => e.type === 'color:round_start');
  expect(roundStart?.payload).toMatchObject({
    countdownMs: 3000,
    scores: [2, 1, 0, 0, 0, 0, 0, 0],
  });

  // Boost event on rising edge
  prev[PHASE] = PHASE_ROUND_ACTIVE;
  next[PHASE] = PHASE_ROUND_ACTIVE;
  prev[PLAYER + 0 * STRIDE + BOOST_ACTIVE] = 0;
  next[PLAYER + 0 * STRIDE + BOOST_ACTIVE] = 3.0;

  envelopes = eventsFromHeaderDiff(prev, next);
  expect(envelopes.some((e) => e.type === 'color:boost')).toBe(true);
  expect(envelopes.some((e) => e.type === 'color:haptic')).toBe(true);

  // Round end event
  prev[PHASE] = PHASE_ROUND_ACTIVE;
  next[PHASE] = PHASE_ROUND_END;
  next[WINNER] = 0;
  next[PLAYER + 0 * STRIDE + SCORE] = 3;

  envelopes = eventsFromHeaderDiff(prev, next);
  const roundEnd = envelopes.find((e) => e.type === 'color:round_end');
  expect(roundEnd).toBeDefined();
  expect(roundEnd?.payload).toMatchObject({
    winnerIndex: 0,
    scores: [3, 1, 0, 0, 0, 0, 0, 0],
    matchOver: true,
  });

  // Match end event
  prev[PHASE] = PHASE_ROUND_END;
  next[PHASE] = PHASE_MATCH_OVER;
  next[WINNER] = 0;

  envelopes = eventsFromHeaderDiff(prev, next);
  const matchEnd = envelopes.find((e) => e.type === 'color:match_end');
  expect(matchEnd).toBeDefined();
  expect(matchEnd?.payload).toMatchObject({
    winnerIndex: 0,
    scores: [3, 1, 0, 0, 0, 0, 0, 0],
  });
});
