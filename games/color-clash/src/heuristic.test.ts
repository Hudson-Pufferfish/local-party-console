import { describe, expect, test } from 'vitest';
import { FLAG_ACTIVE, FLAG_CONTENDER, PHASE_OVERTIME, PHASE_ROUND_ACTIVE } from './constants';
import { levelsForMask, writeHeuristic } from './heuristic';

const PLAYER = 8;
const STRIDE = 10;

describe('color-clash heuristic bot', () => {
  test('steers toward unpainted clusters and triggers BOOST only when facing dense non-owned tiles', () => {
    const state = new Float32Array(88);
    const aux = new Uint8Array(1600);
    const axisX = new Int8Array(8);
    const axisY = new Int8Array(8);
    const buttons = new Uint8Array(8);

    // Paint entire grid as bot 0 (owner = 1) EXCEPT right-hand quadrant (cols 25..39, rows 15..24)
    aux.fill(1);
    for (let row = 15; row < 25; row += 1) {
      for (let col = 25; col < 40; col += 1) {
        aux[row * 40 + col] = 0;
      }
    }

    state[1] = PHASE_ROUND_ACTIVE;
    const base = PLAYER + 0 * STRIDE;
    state[base] = 80; // near unpainted quadrant to the right
    state[base + 1] = 0;
    state[base + 4] = 0; // facing +X directly toward unpainted cluster
    state[base + 5] = 0; // boost ready
    state[base + 8] = FLAG_ACTIVE;

    writeHeuristic(state, 0, axisX, axisY, buttons, 70, aux);
    expect(axisX[0]).toBeGreaterThan(40);
    expect(buttons[0] & 1).toBe(1);

    // When grid is 100% owned by bot 0, it does NOT fire BOOST
    aux.fill(1);
    writeHeuristic(state, 0, axisX, axisY, buttons, 70, aux);
    expect(buttons[0] & 1).toBe(0);

    // Missing auxState safely writes zeros without throwing
    writeHeuristic(state, 0, axisX, axisY, buttons, 70, undefined);
    expect(axisX[0]).toBe(0);
    expect(axisY[0]).toBe(0);
    expect(buttons[0]).toBe(0);
  });

  test('contender bot sprints directly to Golden Tile during OVERTIME while parked slot outputs zeros', () => {
    const state = new Float32Array(88);
    const aux = new Uint8Array(1600);
    const axisX = new Int8Array(8);
    const axisY = new Int8Array(8);
    const buttons = new Uint8Array(8);

    state[1] = PHASE_OVERTIME;
    // Golden cell at col=30, row=20 -> world (210, 10)
    state[4] = 20 * 40 + 30;

    // Slot 0: contender at (-100, 10) facing +X
    const b0 = PLAYER;
    state[b0] = -100;
    state[b0 + 1] = 10;
    state[b0 + 4] = 0;
    state[b0 + 5] = 0;
    state[b0 + 8] = FLAG_ACTIVE | FLAG_CONTENDER;

    // Slot 1: parked non-contender
    const b1 = PLAYER + STRIDE;
    state[b1] = 10000;
    state[b1 + 1] = 10000;
    state[b1 + 8] = 0;

    writeHeuristic(state, 0, axisX, axisY, buttons, 50, aux);
    expect(axisX[0]).toBeGreaterThan(60);
    expect(Math.abs(axisY[0])).toBeLessThan(15);
    expect(buttons[0] & 1).toBe(1);

    axisX[1] = 99;
    axisY[1] = 99;
    buttons[1] = 1;
    writeHeuristic(state, 1, axisX, axisY, buttons, 50, aux);
    expect(axisX[1]).toBe(0);
    expect(axisY[1]).toBe(0);
    expect(buttons[1]).toBe(0);
  });

  test('levelsForMask assigns strictly distinct scores inside difficulty band', () => {
    let seed = 42;
    const rng = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const mask = new Uint8Array([0, 1, 1, 1, 0, 1, 0, 0]);
    const levels = levelsForMask(mask, 'hard', rng);
    const picked = [levels[1], levels[2], levels[3], levels[5]];
    expect(new Set(picked).size).toBe(4);
    for (const score of picked) {
      expect(score).toBeGreaterThanOrEqual(50);
      expect(score).toBeLessThanOrEqual(70);
    }
    expect(levels[0]).toBe(0);
  });
});
