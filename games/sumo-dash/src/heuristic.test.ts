import { expect, test } from 'vitest';
import { assignBotLevels, levelsForMask, writeHeuristic } from './heuristic';

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

  expect(axisX[0]).toBe(-127);
  expect(axisY[0]).toBe(0);
  expect(buttons[0] & 1).toBe(0);
});

test('bot levels are unique, inside 1..7, and never 8..10', () => {
  expect(assignBotLevels(2)).toEqual([2, 5]);
  expect(assignBotLevels(3)).toEqual([1, 3, 5]);
  for (let count = 1; count <= 8; count += 1) {
    const levels = assignBotLevels(count);
    expect(levels.length).toBe(count > 7 ? 7 : count);
    const seen = new Set(levels);
    expect(seen.size).toBe(levels.length);
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(7);
    }
  }
  const mask = new Uint8Array([0, 0, 1, 1, 0, 0, 0, 0]);
  expect(Array.from(levelsForMask(mask))).toEqual([0, 0, 2, 5, 0, 0, 0, 0]);
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
  expect(axisX[0]).toBeGreaterThan(80);
  expect(Math.abs(axisY[0] ?? 0)).toBeLessThan(Math.abs(axisX[0] ?? 0));
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
