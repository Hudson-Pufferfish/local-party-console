import { expect, test } from 'vitest';
import {
  BOT_DIFFICULTY_RANGES,
  DEFAULT_BOT_DIFFICULTY,
  assignBotScores,
  type BotDifficulty,
} from './bot-difficulty.ts';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'medium', 'hard'];

test('exports default difficulty and inclusive /100 ranges', () => {
  expect(DEFAULT_BOT_DIFFICULTY).toBe('medium');
  expect(BOT_DIFFICULTY_RANGES).toEqual({
    easy: [20, 30],
    medium: [30, 50],
    hard: [50, 70],
  });
});

test('assignBotScores returns strictly distinct in-range integers for 1..7 bots across all difficulties', () => {
  for (const difficulty of DIFFICULTIES) {
    const [min, max] = BOT_DIFFICULTY_RANGES[difficulty];
    for (let count = 1; count <= 7; count += 1) {
      for (let seed = 1; seed <= 5; seed += 1) {
        const scores = assignBotScores(count, difficulty, mulberry32(seed * 31 + count));
        expect(scores).toHaveLength(count);
        expect(new Set(scores).size).toBe(count);
        for (const score of scores) {
          expect(Number.isInteger(score)).toBe(true);
          expect(score).toBeGreaterThanOrEqual(min);
          expect(score).toBeLessThanOrEqual(max);
        }
      }
    }
  }
});

test('assignBotScores is deterministic with a seeded rng and handles edge counts cleanly', () => {
  const first = assignBotScores(5, 'easy', mulberry32(42));
  const again = assignBotScores(5, 'easy', mulberry32(42));
  expect(again).toEqual(first);
  expect(assignBotScores(5, 'easy', mulberry32(99))).not.toEqual(first);

  expect(assignBotScores(0, 'medium', mulberry32(1))).toEqual([]);
  expect(assignBotScores(-4, 'hard', mulberry32(1))).toEqual([]);
  expect(assignBotScores(Number.NaN, 'easy', mulberry32(1))).toEqual([]);

  // Asking for more than the pool size caps cleanly at all distinct pool values.
  const fullEasy = assignBotScores(25, 'easy', mulberry32(7));
  expect(fullEasy).toHaveLength(11);
  expect(fullEasy.slice().sort((a, b) => a - b)).toEqual([
    20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
  ]);

  // Out-of-bounds rng outputs stay safe, in-range, and strictly distinct.
  for (const edgeRng of [() => -1, () => 1, () => Number.NaN]) {
    const edge = assignBotScores(3, 'easy', edgeRng);
    expect(edge).toHaveLength(3);
    expect(new Set(edge).size).toBe(3);
    for (const score of edge) {
      expect(score).toBeGreaterThanOrEqual(20);
      expect(score).toBeLessThanOrEqual(30);
    }
  }
});
