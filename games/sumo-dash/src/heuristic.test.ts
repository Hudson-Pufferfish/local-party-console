import { expect, test } from 'vitest';
import { BOT_DIFFICULTY_RANGES, type BotDifficulty } from '../../../shared/src/bot-difficulty.ts';
import {
  LEVEL_SCALE,
  assignBotLevels,
  levelsForMask,
  nerf,
  writeHeuristic,
  type LevelRng,
} from './heuristic';

function mulberry32(seed: number): LevelRng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

test('LEVEL_SCALE is 100 and nerf computes base + share * mult', () => {
  expect(LEVEL_SCALE).toBe(100);
  expect(nerf(0.32, 0.58, 0)).toBeCloseTo(0.32);
  expect(nerf(0.32, 0.58, 0.5)).toBeCloseTo(0.61);
  expect(nerf(0.24, -0.22, 0.5)).toBeCloseTo(0.13);
});

test('bot at 0.85R steers toward the center and does not dash', () => {
  const state = new Float32Array(88);
  state[3] = 400;
  state[8] = 340;
  state[9] = 0;
  state[16] = 1;
  const axisX = new Int8Array(8);
  const axisY = new Int8Array(8);
  const buttons = new Uint8Array(8);

  writeHeuristic(state, 0, axisX, axisY, buttons);

  expect(axisX[0]).toBeLessThan(-60);
  expect(axisX[0]).toBeGreaterThan(-90);
  expect(axisY[0]).toBe(0);
  expect(buttons[0] & 1).toBe(0);
});

test('levelsForMask assigns strictly distinct /100 scores per difficulty and defaults to medium', () => {
  expect(assignBotLevels(0, 'easy', mulberry32(1))).toEqual([]);
  const first = assignBotLevels(3, 'medium', mulberry32(11));
  const again = assignBotLevels(3, 'medium', mulberry32(11));
  expect(again).toEqual(first);
  expect(assignBotLevels(3, 'medium', mulberry32(99))).not.toEqual(first);

  const difficulties: readonly BotDifficulty[] = ['easy', 'medium', 'hard'];
  for (const difficulty of difficulties) {
    const [min, max] = BOT_DIFFICULTY_RANGES[difficulty];
    const mask = new Uint8Array([0, 1, 1, 1, 1, 1, 1, 1]);
    const placed = levelsForMask(mask, difficulty, mulberry32(17));
    expect(placed[0]).toBe(0);
    const assigned = Array.from(placed.slice(1));
    expect(new Set(assigned).size).toBe(7);
    for (const score of assigned) {
      expect(score).toBeGreaterThanOrEqual(min);
      expect(score).toBeLessThanOrEqual(max);
    }
  }

  const twoMask = new Uint8Array([0, 0, 1, 1, 0, 0, 0, 0]);
  const defaulted = levelsForMask(twoMask);
  expect(defaulted[0]).toBe(0);
  expect(defaulted[1]).toBe(0);
  expect(defaulted[2]).toBeGreaterThanOrEqual(30);
  expect(defaulted[2]).toBeLessThanOrEqual(50);
  expect(defaulted[3]).toBeGreaterThanOrEqual(30);
  expect(defaulted[3]).toBeLessThanOrEqual(50);
  expect(defaulted[2]).not.toBe(defaulted[3]);
});

test('a close bot still rams the opponent and higher skill commits harder outward', () => {
  const state = new Float32Array(88);
  state[3] = 400;
  state[8] = 0;
  state[9] = 0;
  state[16] = 1;
  state[18] = 60;
  state[19] = 0;
  state[26] = 1;
  const axisX = new Int8Array(8);
  const axisY = new Int8Array(8);
  const buttons = new Uint8Array(8);

  writeHeuristic(state, 0, axisX, axisY, buttons, 25);
  const easyX = axisX[0] ?? 0;
  writeHeuristic(state, 0, axisX, axisY, buttons, 40);
  const medX = axisX[0] ?? 0;
  const medY = Math.abs(axisY[0] ?? 0);
  writeHeuristic(state, 0, axisX, axisY, buttons, 65);
  const hardX = axisX[0] ?? 0;
  const hardY = Math.abs(axisY[0] ?? 0);

  expect(medX).toBeGreaterThan(medY);
  expect(hardX).toBeGreaterThan(hardY);
  expect(hardY).toBeGreaterThan(8);
  expect(easyX).toBeLessThan(medX);
  expect(medX).toBeLessThan(hardX);
});

test('a bot near the rim steers inward instead of chasing off the ring', () => {
  const state = new Float32Array(88);
  state[3] = 400;
  state[8] = 360;
  state[9] = 0;
  state[16] = 1;
  state[18] = 370;
  state[19] = 0;
  state[26] = 1;
  const axisX = new Int8Array(8);
  const axisY = new Int8Array(8);
  const buttons = new Uint8Array(8);

  for (const level of [20, 40, 70]) {
    writeHeuristic(state, 0, axisX, axisY, buttons, level);
    expect(axisX[0]).toBeLessThan(0);
    expect(buttons[0] & 1).toBe(0);
  }
});

test('easy, medium, and hard bots separate monotonically in pace, turn tightness, and dash range', () => {
  const state = new Float32Array(88);
  state[3] = 400;
  state[8] = -100;
  state[9] = 0;
  state[16] = 1;
  state[18] = 160;
  state[19] = 0;
  state[26] = 1;
  const axisX = new Int8Array(8);
  const axisY = new Int8Array(8);
  const buttons = new Uint8Array(8);

  // Farther than dashRange: compare pace (stick magnitude) and turn offset (|atan2(y, x)|).
  writeHeuristic(state, 0, axisX, axisY, buttons, 25);
  const easyMag = Math.hypot(axisX[0] ?? 0, axisY[0] ?? 0);
  const easyTurn = Math.abs(Math.atan2(axisY[0] ?? 0, axisX[0] ?? 0));

  writeHeuristic(state, 0, axisX, axisY, buttons, 40);
  const medMag = Math.hypot(axisX[0] ?? 0, axisY[0] ?? 0);
  const medTurn = Math.abs(Math.atan2(axisY[0] ?? 0, axisX[0] ?? 0));

  writeHeuristic(state, 0, axisX, axisY, buttons, 65);
  const hardMag = Math.hypot(axisX[0] ?? 0, axisY[0] ?? 0);
  const hardTurn = Math.abs(Math.atan2(axisY[0] ?? 0, axisX[0] ?? 0));

  expect(easyMag).toBeLessThan(medMag);
  expect(medMag).toBeLessThan(hardMag);
  expect(easyTurn).toBeGreaterThan(medTurn);
  expect(medTurn).toBeGreaterThan(hardTurn);

  // Dash range progression: easy dashes at 90, not 150; medium dashes at 150, not 210; hard dashes at 210.
  state[8] = 0;
  state[18] = 90;
  writeHeuristic(state, 0, axisX, axisY, buttons, 25);
  expect(buttons[0] & 1).toBe(1);

  state[18] = 150;
  writeHeuristic(state, 0, axisX, axisY, buttons, 25);
  expect(buttons[0] & 1).toBe(0);
  writeHeuristic(state, 0, axisX, axisY, buttons, 40);
  expect(buttons[0] & 1).toBe(1);

  state[18] = 210;
  writeHeuristic(state, 0, axisX, axisY, buttons, 40);
  expect(buttons[0] & 1).toBe(0);
  writeHeuristic(state, 0, axisX, axisY, buttons, 65);
  expect(buttons[0] & 1).toBe(1);
});

test('two stacked bots of different levels do not share a zero steer', () => {
  const state = new Float32Array(88);
  state[3] = 400;
  state[8] = 40;
  state[9] = 40;
  state[16] = 1;
  state[18] = 40;
  state[19] = 40;
  state[26] = 1;
  const axisX = new Int8Array(8);
  const axisY = new Int8Array(8);
  const buttons = new Uint8Array(8);
  writeHeuristic(state, 0, axisX, axisY, buttons, 25);
  const weakX = axisX[0];
  const weakY = axisY[0];
  writeHeuristic(state, 1, axisX, axisY, buttons, 65);
  expect(weakX !== 0 || weakY !== 0).toBe(true);
  expect(axisX[1] !== 0 || axisY[1] !== 0).toBe(true);
  expect(weakX === axisX[1] && weakY === axisY[1]).toBe(false);
});
