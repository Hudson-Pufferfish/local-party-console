import { describe, expect, test } from 'vitest';
import {
  LAMP_FLAG,
  LAST_LIGHT_CONSTANTS as C,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
} from './constants.ts';
import { buildLightStateEnvelope, createLastLightEventsDiff } from './events.ts';
import { createLastLightSimulation } from './simulation.ts';

const DT = 1 / C.stepHz;

describe('Last Light control-plane events and INV-8 audit', () => {
  test('emits full light:* lifecycle events, rehydration snapshot, and leaks zero timestamps or blowout ticks', () => {
    const sim = createLastLightSimulation();
    const diff = createLastLightEventsDiff();
    sim.startMatch([0, 1], 707);

    const emitted: Array<{ type: string; payload: unknown }> = [];
    const prev = new Float32Array(sim.state);

    const stepAndCollect = (ticks: number, action?: (i: number) => void): void => {
      for (let i = 0; i < ticks; i += 1) {
        action?.(i);
        sim.step(DT);
        const events = diff(prev, sim.state, sim.getMatchTarget());
        for (const ev of events) emitted.push({ type: ev.type, payload: ev.payload });
        prev.set(sim.state);
      }
    };

    // First tick emits light:practice_start (30000ms, breakNumber 1)
    stepAndCollect(1);
    expect(emitted.some((e) => e.type === 'light:practice_start')).toBe(true);
    expect(emitted.find((e) => e.type === 'light:practice_start')?.payload).toEqual({
      durationMs: 30000,
      breakNumber: 1,
    });

    // Advance until a practice blowout occurs and then into COUNTDOWN
    let sawPracticeBlowout = false;
    while (sim.state[H.phase] === P.practice) {
      stepAndCollect(1);
      if (emitted.some((e) => e.type === 'light:blowout' && (e.payload as { practice?: boolean }).practice === true)) {
        sawPracticeBlowout = true;
      }
    }
    expect(sawPracticeBlowout).toBe(true);
    expect(sim.state[H.phase]).toBe(P.countdown);
    expect(emitted.some((e) => e.type === 'light:round_start')).toBe(true);

    // Advance to ROUND_ACTIVE, lock slot 0, verify light:lock and buildLightStateEnvelope
    while (sim.state[H.phase] === P.countdown) stepAndCollect(1);
    expect(sim.state[H.phase]).toBe(P.active);

    stepAndCollect(1, () => sim.applyInput(0, 1, 0, 0));
    expect(emitted.some((e) => e.type === 'light:lock' && (e.payload as { lockedMask: number }).lockedMask === 1)).toBe(true);

    const rehydrate = buildLightStateEnvelope(sim.state);
    expect(rehydrate.type).toBe('light:state');
    expect(rehydrate.payload).toEqual({
      phase: P.active,
      lockedMask: 1,
      contenderMask: 0b11,
      scores: [0, 0, 0, 0, 0, 0, 0, 0],
    });

    // Run until scored blowout -> ROUND_END
    while (sim.state[H.phase] === P.active) stepAndCollect(1);
    expect(sim.state[H.phase]).toBe(P.roundEnd);
    expect(emitted.some((e) => e.type === 'light:blowout' && (e.payload as { practice?: boolean }).practice === false)).toBe(true);
    const roundEnd = emitted.find((e) => e.type === 'light:round_end');
    expect(roundEnd?.payload).toEqual({
      winnerIndex: 0,
      scores: [1, 0, 0, 0, 0, 0, 0, 0],
      matchOver: false,
      suddenDeath: false,
      void: false,
    });

    // INV-8 audit: serialize every emitted event + rehydrate snapshot and verify zero timing leaks
    const serialized = JSON.stringify([...emitted, rehydrate]);
    expect(serialized).not.toContain('lockTick');
    expect(serialized).not.toContain('blowoutTick');
    expect(serialized).not.toContain('lampElapsed');
  });

  test('emits light:match_end when transitioning to MATCH_OVER and handles second practice break duration', () => {
    const diff = createLastLightEventsDiff();
    const prev = new Float32Array(88);
    const next = new Float32Array(88);

    prev[H.tick] = 500;
    prev[H.phase] = P.roundEnd;
    prev[H.winnerSlot] = 1;
    next[H.tick] = 501;
    next[H.phase] = P.matchOver;
    next[H.winnerSlot] = 1;
    next[H.lampFlags] = LAMP_FLAG.blown;
    next[8 + 10 + 2] = 3; // slot 1 score = 3

    const events = diff(prev, next, 3);
    expect(events).toEqual([
      {
        type: 'light:match_end',
        roomId: '',
        payload: {
          winnerIndex: 1,
          scores: [0, 3, 0, 0, 0, 0, 0, 0],
        },
      },
    ]);
  });
});
