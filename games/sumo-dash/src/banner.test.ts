import { expect, test } from 'vitest';
import { bannerCopy, matchWinnerTag } from './banner';

test('practice shows BREAK and the seconds, countdown stays a digit', () => {
  expect(bannerCopy(4, 10)).toBe('BREAK 10');
  expect(bannerCopy(4, 7.2)).toBe('BREAK 8');
  expect(bannerCopy(4, 0.2)).toBe('BREAK 1');
  expect(bannerCopy(0, 2.1)).toBe('3');
  expect(bannerCopy(2, 0.5)).toBe('POINT');
  expect(bannerCopy(1, 12)).toBe('');
});

test('match-winning round suppresses POINT and shows the winner through MATCH_OVER', () => {
  const state = new Float32Array(88);
  state[17] = 2; // slot 0 score = 2/3
  expect(matchWinnerTag(state, ['Hudson', ''], 3)).toBeUndefined();
  expect(bannerCopy(2, 0.5, matchWinnerTag(state, ['Hudson', ''], 3))).toBe('POINT');

  state[17] = 3; // slot 0 hits 3/3
  const humanWinner = matchWinnerTag(state, ['Hudson', ''], 3);
  expect(humanWinner).toBe('hu');
  expect(bannerCopy(2, 0.5, humanWinner)).toBe('HU WINS');
  expect(bannerCopy(3, 0, humanWinner)).toBe('HU WINS');

  state[17] = 0;
  state[27] = 3; // unnamed / bot slot 1 hits 3/3
  const botWinner = matchWinnerTag(state, ['Hudson', ''], 3);
  expect(botWinner).toBe('p2');
  expect(bannerCopy(2, 0.5, botWinner)).toBe('P2 WINS');
  expect(bannerCopy(3, 0, botWinner)).toBe('P2 WINS');
  expect(bannerCopy(3, 0)).toBe('MATCH OVER');
});
