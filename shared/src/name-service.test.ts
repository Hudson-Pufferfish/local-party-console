import { expect, test } from 'vitest';
import { generateBotName, normalizeName, validatePlayerName } from './name-service';

test('normalizeName trims, uppercases, and caps at 16 characters', () => {
  expect(normalizeName('  ada  ')).toBe('ADA');
  expect(normalizeName('   ')).toBe('');
  expect(normalizeName('  abcdefghijklmnopqr  ')).toBe('ABCDEFGHIJKLMNOP');
  expect(normalizeName('a')).toBe('A');
});

test('validatePlayerName rejects empty and case-insensitive duplicate names and accepts unique names', () => {
  const players = [{ name: 'Ada' }, { name: '  P1 ' }];

  expect(validatePlayerName('', players)).toEqual({ valid: false, reason: 'EMPTY' });
  expect(validatePlayerName('   \t\n  ', players)).toEqual({ valid: false, reason: 'EMPTY' });
  expect(validatePlayerName('ada', players)).toEqual({ valid: false, reason: 'DUPLICATE' });
  expect(validatePlayerName('  ADA  ', players)).toEqual({ valid: false, reason: 'DUPLICATE' });
  expect(validatePlayerName('p1', players)).toEqual({ valid: false, reason: 'DUPLICATE' });
  expect(validatePlayerName('Bea', players)).toEqual({ valid: true });
  expect(validatePlayerName('x', players)).toEqual({ valid: true });
});

test('generateBotName returns the smallest unused positive P{X} name', () => {
  expect(generateBotName([])).toBe('P1');
  expect(generateBotName(['ADA', 'BEA'])).toBe('P1');
  expect(generateBotName(['P1'])).toBe('P2');
  expect(generateBotName(['p1', 'P2'])).toBe('P3');
  expect(generateBotName(['P2', 'P3'])).toBe('P1');
  expect(generateBotName(['P1', 'P3'])).toBe('P2');
});
