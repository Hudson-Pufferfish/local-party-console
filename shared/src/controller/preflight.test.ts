import { expect, test } from 'vitest';
import { classifyPower } from './preflight';

test('classifyPower returns low-power when any frame delta is at least 31ms', () => {
  expect(classifyPower([16, 16, 32])).toBe('low-power');
  expect(classifyPower([16, 16, 16])).toBe('ok');
});
