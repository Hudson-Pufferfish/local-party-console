import { expect, test } from 'vitest';
import { bannerCopy, matchWinnerTag } from './banner';

test('practice shows BREAK and the seconds, countdown stays a digit', () => {
  expect(bannerCopy(4, 20)).toBe('BREAK 20');
  expect(bannerCopy(4, 15)).toBe('BREAK 15');
  expect(bannerCopy(4, 10)).toBe('BREAK 10');
  expect(bannerCopy(4, 7.2)).toBe('BREAK 8');
  expect(bannerCopy(4, 0.2)).toBe('BREAK 1');
  expect(bannerCopy(0, 2.1)).toBe('3');
  expect(bannerCopy(2, 0.5)).toBe('POINT');
  expect(bannerCopy(1, 12)).toBe('');
});

test('match-winning round suppresses POINT, picks the top scorer, and holds through MATCH_OVER', () => {
  const state = new Float32Array(88);
  state[8] = 240;
  state[16] = 1;
  state[17] = 2; // slot 0 score = 2/3
  state[18] = -240;
  state[26] = 0;
  state[27] = 0;
  expect(matchWinnerTag(state, ['Hudson', 'Ada'], 3)).toBeUndefined();
  expect(bannerCopy(2, 0.5, matchWinnerTag(state, ['Hudson', 'Ada'], 3))).toBe('POINT');

  state[17] = 3; // slot 0 hits 3/3
  const humanWinner = matchWinnerTag(state, ['Hudson', 'Ada'], 3);
  expect(humanWinner).toBe('HUDSON');
  expect(bannerCopy(2, 0.5, humanWinner)).toBe('HUDSON WINS');
  expect(bannerCopy(3, 0, humanWinner)).toBe('HUDSON WINS');

  state[17] = 9; // slot 0 crosses 9
  state[16] = 0;
  state[27] = 11; // slot 1 crosses higher (11 >= 9)
  state[26] = 1;
  const topScorer = matchWinnerTag(state, ['Hudson', ''], 9);
  expect(topScorer).toBe('P2');
  expect(bannerCopy(2, 0.5, topScorer)).toBe('P2 WINS');
  expect(bannerCopy(3, 0, topScorer)).toBe('P2 WINS');
  expect(bannerCopy(3, 0)).toBe('MATCH OVER');

  // Tied leaders at or above target have no winner yet and display SUDDEN DEATH
  state[17] = 6;
  state[16] = 1;
  state[27] = 6;
  state[26] = 0;
  expect(matchWinnerTag(state, ['Hudson', 'Ada'], 6)).toBeUndefined();
  expect(bannerCopy(2, 0.5, undefined, true)).toBe('SUDDEN DEATH');
  expect(bannerCopy(4, 19.2, undefined, true)).toBe('SUDDEN DEATH 20');
  expect(bannerCopy(0, 2.2, undefined, true)).toBe('SUDDEN DEATH 3');
  expect(bannerCopy(1, 5, undefined, true)).toBe('');
});
