import { expect, test } from 'vitest';
import {
  BOMB_CONSTANTS as C,
  BOMB_FLAG_ALIVE,
  BOMB_FLAG_HOLDING,
  BOMB_HEADER as H,
  BOMB_PLAYER_BASE as PLAYER,
  BOMB_PLAYER_STRIDE as STRIDE,
} from './constants.ts';
import { levelsForMask, writeHeuristic } from './heuristic.ts';

function makeState(): Float32Array {
  const s = new Float32Array(C.stateFloats);
  s[H.arenaRadius] = C.arenaRadius;
  s[H.bombHolder] = -1;
  return s;
}

function setPuck(
  state: Float32Array,
  slot: number,
  x: number,
  y: number,
  alive = true,
  holding = false,
): void {
  const base = PLAYER + slot * STRIDE;
  state[base] = x;
  state[base + 1] = y;
  state[base + 8] = (alive ? BOMB_FLAG_ALIVE : 0) | (holding ? BOMB_FLAG_HOLDING : 0);
}

test('holder bot chases nearest alive opponent and dashes when aligned in range with cooldown clear', () => {
  const state = makeState();
  state[H.bombHolder] = 0;
  state[H.bombTimer] = 8.0;
  state[H.transferCooldown] = 0;
  setPuck(state, 0, 0, 0, true, true);
  setPuck(state, 1, 120, 0, true, false);
  setPuck(state, 2, -260, 0, true, false);

  const ax = new Int8Array(8);
  const ay = new Int8Array(8);
  const btn = new Uint8Array(8);
  writeHeuristic(state, 0, ax, ay, btn, 70);

  expect(ax[0]).toBeGreaterThan(50);
  expect(Math.abs(ay[0])).toBeLessThan(Math.abs(ax[0]));
  expect(btn[0]).toBe(1);

  // Blocked from dashing while transferCooldown > 0
  state[H.transferCooldown] = 0.3;
  writeHeuristic(state, 0, ax, ay, btn, 70);
  expect(btn[0]).toBe(0);
});

test('non-holder bot flees away in center and wall-slides tangentially/inward near rim', () => {
  const state = makeState();
  state[H.bombHolder] = 1;
  state[H.bombTimer] = 6.0;
  setPuck(state, 0, 0, 0, true, false);
  setPuck(state, 1, 100, 0, true, true);

  const ax = new Int8Array(8);
  const ay = new Int8Array(8);
  const btn = new Uint8Array(8);
  writeHeuristic(state, 0, ax, ay, btn, 60);
  // In center, flees straight away (-X)
  expect(ax[0]).toBeLessThan(-40);

  // Near rim at (340, 0) = 0.85 * R with holder at (200, 0) approaching radially outward
  setPuck(state, 0, 340, 0, true, false);
  setPuck(state, 1, 200, 0, true, true);
  writeHeuristic(state, 0, ax, ay, btn, 60);
  // Should not steer radially outward into the wall; must slide tangentially / inward
  expect(ax[0]).toBeLessThanOrEqual(20);
  expect(Math.abs(ay[0])).toBeGreaterThan(30);
});

test('levelsForMask draws distinct skill scores inside requested difficulty band', () => {
  let step = 0;
  const rng = (): number => {
    step += 1;
    return ((step * 37) % 100) / 100;
  };
  const mask = new Uint8Array([0, 1, 1, 1, 0, 0, 0, 0]);
  const easy = levelsForMask(mask, 'easy', rng);
  expect(easy[0]).toBe(0);
  expect(easy[1]).toBeGreaterThanOrEqual(11);
  expect(easy[1]).toBeLessThanOrEqual(20);
  expect(new Set([easy[1], easy[2], easy[3]]).size).toBe(3);

  const hard = levelsForMask(mask, 'hard', rng);
  expect(hard[1]).toBeGreaterThanOrEqual(50);
  expect(hard[1]).toBeLessThanOrEqual(70);
});
