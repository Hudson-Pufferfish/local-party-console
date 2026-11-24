import { expect, test } from 'vitest';
import { bannerCopy } from './banner';

test('practice shows BREAK and the seconds, countdown stays a digit', () => {
  expect(bannerCopy(4, 10)).toBe('BREAK 10');
  expect(bannerCopy(4, 7.2)).toBe('BREAK 8');
  expect(bannerCopy(4, 0.2)).toBe('BREAK 1');
  expect(bannerCopy(0, 2.1)).toBe('3');
  expect(bannerCopy(2, 0.5)).toBe('POINT');
  expect(bannerCopy(1, 12)).toBe('');
});
