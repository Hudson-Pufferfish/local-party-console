import { expect, test } from 'vitest';
import { quantizeAxis } from './quantize';

test('quantizeAxis maps a unit axis onto an int8 and clamps', () => {
  expect(quantizeAxis(1)).toBe(127);
  expect(quantizeAxis(-1)).toBe(-127);
  expect(quantizeAxis(0)).toBe(0);
  expect(quantizeAxis(2)).toBe(127);
});
