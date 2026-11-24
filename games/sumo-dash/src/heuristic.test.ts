import { expect, test } from 'vitest';
import { assignBotLevels, levelsForMask, writeHeuristic, type LevelRng } from './heuristic';

function mulberry32(seed: number): LevelRng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

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

test('bot levels are a seeded shuffle of 1..7', () => {
  expect(assignBotLevels(0, mulberry32(1))).toEqual([]);
  const first = assignBotLevels(3, mulberry32(11));
  const again = assignBotLevels(3, mulberry32(11));
  expect(again).toEqual(first);
  expect(assignBotLevels(3, mulberry32(99))).not.toEqual(first);
  for (let count = 1; count <= 8; count += 1) {
    const levels = assignBotLevels(count, mulberry32(count + 3));
    expect(levels.length).toBe(count > 7 ? 7 : count);
    const seen = new Set(levels);
    expect(seen.size).toBe(levels.length);
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(7);
    }
  }
  expect(assignBotLevels(7, mulberry32(4)).slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  const mask = new Uint8Array([0, 0, 1, 1, 0, 0, 0, 0]);
  const placed = levelsForMask(mask, mulberry32(11));
  const placedAgain = levelsForMask(mask, mulberry32(11));
  expect(Array.from(placedAgain)).toEqual(Array.from(placed));
  expect(placed[0]).toBe(0);
  expect(placed[1]).toBe(0);
  expect(placed[2]).toBe(first[0]);
  expect(placed[3]).toBe(first[1]);
  expect(placed[2]).not.toBe(placed[3]);
});

test('a close bot still rams the opponent', () => {
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
  writeHeuristic(state, 0, axisX, axisY, buttons, 5);
  expect(axisX[0]).toBeGreaterThan(Math.abs(axisY[0] ?? 0));
  writeHeuristic(state, 0, axisX, axisY, buttons, 7);
  expect(axisX[0]).toBeGreaterThan(Math.abs(axisY[0] ?? 0));
  expect(Math.abs(axisY[0] ?? 0)).toBeGreaterThan(8);
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
  writeHeuristic(state, 0, axisX, axisY, buttons, 1);
  expect(axisX[0]).toBeLessThan(0);
});

test('level 1 can dash, and level 7 dashes from farther out', () => {
  const state = new Float32Array(88);
  state[3] = 400;
  state[16] = 1;
  state[18] = 90;
  state[26] = 1;
  const axisX = new Int8Array(8);
  const axisY = new Int8Array(8);
  const buttons = new Uint8Array(8);
  writeHeuristic(state, 0, axisX, axisY, buttons, 1);
  expect(buttons[0] & 1).toBe(1);
  state[18] = 140;
  writeHeuristic(state, 0, axisX, axisY, buttons, 1);
  expect(buttons[0] & 1).toBe(0);
  writeHeuristic(state, 0, axisX, axisY, buttons, 7);
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
  writeHeuristic(state, 0, axisX, axisY, buttons, 2);
  const weakX = axisX[0];
  const weakY = axisY[0];
  writeHeuristic(state, 1, axisX, axisY, buttons, 5);
  expect(weakX !== 0 || weakY !== 0).toBe(true);
  expect(axisX[1] !== 0 || axisY[1] !== 0).toBe(true);
  expect(weakX === axisX[1] && weakY === axisY[1]).toBe(false);
});
