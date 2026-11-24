import { expect, test } from 'vitest';
import { writeHeuristic } from './heuristic';

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
