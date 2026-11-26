import { describe, expect, test } from 'vitest';
import {
  LAMP_FLAG,
  LAST_LIGHT_CONSTANTS as C,
  LIGHT_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
  LIGHT_PLAYER_OFFSET as OFF,
} from './constants.ts';
import { assignBotLevels, levelsForMask, writeHeuristic } from './heuristic.ts';
import { createLastLightSimulation } from './simulation.ts';
import { playerBase } from './state.ts';

function makeActiveState(blowoutCount: number, elapsedSec: number, botFlags: number): Float32Array {
  const state = new Float32Array(88);
  state[H.phase] = P.active;
  state[H.lampFlags] = LAMP_FLAG.lit;
  state[H.lampElapsed] = elapsedSec;
  state[H.blowoutCount] = blowoutCount;
  state[playerBase(0) + OFF.flags] = LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender;
  state[playerBase(1) + OFF.flags] = botFlags;
  return state;
}

describe('Last Light information-barrier heuristic bot', () => {
  test('information barrier: identical public state produces identical tap timing regardless of private blowoutTick', () => {
    // Two simulations with different seeds have different private blowoutTicks,
    // yet until the earlier blowout occurs, the bot sees identical public headers and taps identically.
    const simA = createLastLightSimulation();
    const simB = createLastLightSimulation();
    simA.startMatch([0, 1], 1111);
    simB.startMatch([0, 1], 9999);

    const dt = 1 / C.stepHz;
    while (simA.state[H.phase] !== P.active) simA.step(dt);
    while (simB.state[H.phase] !== P.active) simB.step(dt);

    // Align public blowoutCount to isolate the private blowoutTick difference.
    simA.state[H.blowoutCount] = 10;
    simB.state[H.blowoutCount] = 10;

    const axA = new Int8Array(8);
    const ayA = new Int8Array(8);
    const btnA = new Uint8Array(8);
    const axB = new Int8Array(8);
    const ayB = new Int8Array(8);
    const btnB = new Uint8Array(8);

    let tapTickA = -1;
    let tapTickB = -1;
    for (let t = 0; t < 350; t += 1) {
      if (t % 2 === 0) {
        writeHeuristic(simA.state, 1, axA, ayA, btnA, 18);
        writeHeuristic(simB.state, 1, axB, ayB, btnB, 18);
      }
      if (btnA[1] === 1 && tapTickA < 0) tapTickA = t;
      if (btnB[1] === 1 && tapTickB < 0) tapTickB = t;
      expect(btnA[1]).toBe(btnB[1]);
      expect(axA[1]).toBe(0);
      expect(ayA[1]).toBe(0);
      simA.applyInput(1, btnA[1]!, 0, 0);
      simB.applyInput(1, btnB[1]!, 0, 0);
      simA.step(dt);
      simB.step(dt);
    }
    expect(tapTickA).toBe(tapTickB);
  });

  test('difficulty curve: Easy locks earliest (~20% no-tap), Medium mid (~8%), Hard latest & tightest (~3%) and resets bit 0 cleanly', () => {
    const easyLevels = assignBotLevels(3, 'easy', () => 0.5);
    expect(easyLevels.every((l) => l >= 11 && l <= 20)).toBe(true);

    const mask = new Uint8Array([0, 1, 0, 1, 0, 0, 0, 0]);
    const assigned = levelsForMask(mask, 'hard', () => 0.5);
    expect(assigned[1]).toBeGreaterThanOrEqual(50);
    expect(assigned[1]).toBeLessThanOrEqual(70);
    expect(assigned[0]).toBe(0);

    const measureTier = (level: number) => {
      const ax = new Int8Array(8);
      const ay = new Int8Array(8);
      const btn = new Uint8Array(8);
      const flags = LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender;
      let noTaps = 0;
      const tapTimes: number[] = [];

      for (let b = 0; b < 200; b += 1) {
        let tappedAt = -1;
        for (let step = 0; step <= 120; step += 1) {
          const sec = step * 0.1;
          const state = makeActiveState(b + 100, sec, flags);
          writeHeuristic(state, 1, ax, ay, btn, level);
          if (btn[1] === 1) {
            tappedAt = sec;
            break;
          }
        }
        if (tappedAt < 0) noTaps += 1;
        else tapTimes.push(tappedAt);
      }

      const mean = tapTimes.reduce((sum, v) => sum + v, 0) / tapTimes.length;
      const variance = tapTimes.reduce((sum, v) => sum + (v - mean) ** 2, 0) / tapTimes.length;
      return { mean, std: Math.sqrt(variance), noTapRate: noTaps / 200 };
    };

    const easy = measureTier(15);
    const med = measureTier(40);
    const hard = measureTier(62);

    expect(easy.mean).toBeLessThan(med.mean);
    expect(med.mean).toBeLessThan(hard.mean);
    expect(hard.std).toBeLessThan(easy.std);
    expect(easy.noTapRate).toBeGreaterThan(0.10);
    expect(easy.noTapRate).toBeLessThan(0.32);
    expect(med.noTapRate).toBeGreaterThan(0.02);
    expect(med.noTapRate).toBeLessThan(0.18);
    expect(hard.noTapRate).toBeLessThan(0.10);

    // Edge reset & parked safety: bit 0 clears when LOCKED, BLOWN, COUNTDOWN, or parked non-contender.
    const ax = new Int8Array(8);
    const ay = new Int8Array(8);
    const btn = new Uint8Array(8);
    btn[1] = 1;

    const lockedState = makeActiveState(500, 11.0, LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender | LIGHT_FLAG.locked);
    writeHeuristic(lockedState, 1, ax, ay, btn, 60);
    expect(btn[1]).toBe(0);

    btn[1] = 1;
    const blownState = makeActiveState(500, 11.0, LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender);
    blownState[H.lampFlags] = LAMP_FLAG.blown;
    writeHeuristic(blownState, 1, ax, ay, btn, 60);
    expect(btn[1]).toBe(0);

    btn[1] = 1;
    const parkedState = makeActiveState(500, 11.0, LIGHT_FLAG.joined);
    writeHeuristic(parkedState, 1, ax, ay, btn, 60);
    expect(btn[1]).toBe(0);

    btn[1] = 1;
    const countdownState = makeActiveState(500, 0, LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender);
    countdownState[H.phase] = P.countdown;
    writeHeuristic(countdownState, 1, ax, ay, btn, 60);
    expect(btn[1]).toBe(0);
  });
});
