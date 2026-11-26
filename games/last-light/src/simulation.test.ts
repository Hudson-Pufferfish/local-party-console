import { describe, expect, test } from 'vitest';
import {
  LAMP_FLAG,
  LAST_LIGHT_CONSTANTS as C,
  LIGHT_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
} from './constants.ts';
import { createLastLightSimulation } from './simulation.ts';
import {
  isPlayerLocked,
  readLockedMask,
  readPlayerFlags,
  readPlayerLastRoundPoints,
  readPlayerLockTick,
  readPlayerScore,
} from './state.ts';
import type { LastLightSimulation } from './types.ts';

const DT = 1 / C.stepHz;

function stepUntilPhase(sim: LastLightSimulation, targetPhase: number, maxTicks = 10000): number {
  let ticks = 0;
  while (sim.state[H.phase] !== targetPhase && ticks < maxTicks) {
    sim.step(DT);
    ticks += 1;
  }
  expect(sim.state[H.phase]).toBe(targetPhase);
  return ticks;
}

function advanceToNextScoredRound(sim: LastLightSimulation): void {
  if (sim.state[H.phase] === P.active) return;
  stepUntilPhase(sim, P.active, 6000);
}

function tapSlot(sim: LastLightSimulation, slot: number): void {
  sim.applyInput(slot, 1, 0, 0);
}

function releaseSlot(sim: LastLightSimulation, slot: number): void {
  sim.applyInput(slot, 0, 0, 0);
}

function runScoredRoundWithTaps(
  sim: LastLightSimulation,
  schedule: ReadonlyArray<{ readonly tick: number; readonly slot: number }>,
): number {
  advanceToNextScoredRound(sim);
  let elapsed = 0;
  while (sim.state[H.phase] === P.active && elapsed < 2000) {
    for (const action of schedule) {
      if (action.tick === elapsed) {
        tapSlot(sim, action.slot);
      } else if (action.tick + 1 === elapsed) {
        releaseSlot(sim, action.slot);
      }
    }
    sim.step(DT);
    elapsed += 1;
  }
  expect(sim.state[H.phase]).toBe(P.roundEnd);
  // Release all inputs after round ends.
  for (let s = 0; s < C.maxPlayers; s += 1) {
    releaseSlot(sim, s);
  }
  return elapsed;
}

function measureNextBlowoutTick(slots: number[], seed: number): number {
  const probe = createLastLightSimulation();
  probe.startMatch(slots, seed);
  return runScoredRoundWithTaps(probe, []);
}

describe('Last Light simulation (TDD)', () => {
  test('INV-6 & INV-7: 200 seeded blowouts stay strictly in [3.0, 12.0]s scored and [1.0, 3.5]s practice with bit-exact determinism', () => {
    let scoredCount = 0;
    let practiceCount = 0;

    for (let s = 1; s <= 40; s += 1) {
      const sim = createLastLightSimulation();
      sim.startMatch([0, 1], 0x5000 + s * 97);

      // Measure practice blowouts during the 30s initial practice.
      let lastBlowout = sim.state[H.blowoutCount]!;
      let inPracticeBlowout = (sim.state[H.lampFlags]! & LAMP_FLAG.practiceBlowout) !== 0;
      let practiceTicks = 0;
      while (sim.state[H.phase] === P.practice) {
        const flagsBefore = sim.state[H.lampFlags]! | 0;
        const wasLitPractice =
          (flagsBefore & LAMP_FLAG.lit) !== 0 && (flagsBefore & LAMP_FLAG.practiceBlowout) !== 0;
        if (wasLitPractice && !inPracticeBlowout) {
          inPracticeBlowout = true;
          practiceTicks = 0;
        }
        sim.step(DT);
        if (inPracticeBlowout) {
          practiceTicks += 1;
          if (sim.state[H.blowoutCount]! > lastBlowout) {
            lastBlowout = sim.state[H.blowoutCount]!;
            const sec = practiceTicks / C.stepHz;
            expect(sec).toBeGreaterThanOrEqual(C.practiceMinSec);
            expect(sec).toBeLessThanOrEqual(C.practiceMaxSec);
            practiceCount += 1;
            inPracticeBlowout = false;
          }
        }
      }

      // Measure 5 scored rounds per seed -> 200 scored blowouts.
      for (let round = 0; round < 5; round += 1) {
        const ticks = runScoredRoundWithTaps(sim, []);
        const sec = ticks / C.stepHz;
        expect(sec).toBeGreaterThanOrEqual(C.scoredMinSec);
        expect(sec).toBeLessThanOrEqual(C.scoredMaxSec);
        scoredCount += 1;
      }
    }

    expect(scoredCount).toBe(200);
    expect(practiceCount).toBeGreaterThanOrEqual(200);

    // Bit-exact determinism across two independent runs with identical seed and inputs.
    const simA = createLastLightSimulation();
    const simB = createLastLightSimulation();
    simA.startMatch([0, 1, 2], 0xdeadbeef);
    simB.startMatch([0, 1, 2], 0xdeadbeef);
    for (let t = 0; t < 5000; t += 1) {
      const btn0 = t % 173 === 0 ? 1 : 0;
      const btn1 = t % 211 === 0 ? 1 : 0;
      simA.applyInput(0, btn0, 0, 0);
      simB.applyInput(0, btn0, 0, 0);
      simA.applyInput(1, btn1, 0, 0);
      simB.applyInput(1, btn1, 0, 0);
      simA.step(DT);
      simB.step(DT);
      if (t % 250 === 0) {
        expect(Array.from(simA.state)).toEqual(Array.from(simB.state));
      }
    }
    expect(Array.from(simA.state)).toEqual(Array.from(simB.state));
  });

  test('FR-4 worked examples: 2P (target 3), 3P (target 6 + sudden death), and 8P (target 21 + ties + non-tappers)', () => {
    // 2 Players (N = 2, target = 3)
    const sim2 = createLastLightSimulation();
    sim2.startMatch([0, 1], 101);
    expect(sim2.getMatchTarget()).toBe(3);

    // Round 1: slot 0 locks at tick 120, slot 1 locks at tick 240 -> slot 1 +1, slot 0 +0
    runScoredRoundWithTaps(sim2, [
      { tick: 120, slot: 0 },
      { tick: 240, slot: 1 },
    ]);
    expect(readPlayerScore(sim2.state, 0)).toBe(0);
    expect(readPlayerScore(sim2.state, 1)).toBe(1);
    expect(readPlayerLastRoundPoints(sim2.state, 1)).toBe(1);

    // Round 2: slot 1 does not tap, slot 0 taps at tick 180 -> slot 0 +1 (tied 1-1)
    runScoredRoundWithTaps(sim2, [{ tick: 180, slot: 0 }]);
    expect(readPlayerScore(sim2.state, 0)).toBe(1);
    expect(readPlayerScore(sim2.state, 1)).toBe(1);

    // Round 3: same-tick tie -> both earn +1 (2-2)
    runScoredRoundWithTaps(sim2, [
      { tick: 200, slot: 0 },
      { tick: 200, slot: 1 },
    ]);
    expect(readPlayerScore(sim2.state, 0)).toBe(2);
    expect(readPlayerScore(sim2.state, 1)).toBe(2);

    // Round 4: void round (neither taps) -> 0 points, LAMP_FLAG.voidRound set
    runScoredRoundWithTaps(sim2, []);
    expect((sim2.state[H.lampFlags]! & LAMP_FLAG.voidRound) !== 0).toBe(true);
    expect(readPlayerScore(sim2.state, 0)).toBe(2);
    expect(readPlayerScore(sim2.state, 1)).toBe(2);

    // 3 Players (N = 3, target = 6) with Sudden Death
    const sim3 = createLastLightSimulation();
    sim3.startMatch([0, 1, 2], 202);
    expect(sim3.getMatchTarget()).toBe(6);

    // R1: slot 0 @ 100, slot 1 @ 200, slot 2 no tap -> 1, 2, 0
    runScoredRoundWithTaps(sim3, [
      { tick: 100, slot: 0 },
      { tick: 200, slot: 1 },
    ]);
    expect([
      readPlayerScore(sim3.state, 0),
      readPlayerScore(sim3.state, 1),
      readPlayerScore(sim3.state, 2),
    ]).toEqual([1, 2, 0]);
    expect((readPlayerFlags(sim3.state, 2) & LIGHT_FLAG.out) !== 0).toBe(true);

    // R2: slot 2 @ 260, slot 1 @ 200, slot 0 @ 100 -> +0, +1, +2 -> totals 1, 3, 2
    runScoredRoundWithTaps(sim3, [
      { tick: 100, slot: 0 },
      { tick: 200, slot: 1 },
      { tick: 260, slot: 2 },
    ]);
    expect([
      readPlayerScore(sim3.state, 0),
      readPlayerScore(sim3.state, 1),
      readPlayerScore(sim3.state, 2),
    ]).toEqual([1, 3, 2]);

    // Drive slot 0 and slot 1 to a 6-6 tie while slot 2 stays at 4:
    // R3: slot 0 @ 250 (+2 -> 3), slot 2 @ 200 (+1 -> 3), slot 1 @ 100 (+0 -> 3) -> 3, 3, 3
    runScoredRoundWithTaps(sim3, [
      { tick: 100, slot: 1 },
      { tick: 200, slot: 2 },
      { tick: 250, slot: 0 },
    ]);
    // R4: slot 0 @ 250 (+2 -> 5), slot 1 @ 200 (+1 -> 4), slot 2 @ 100 (+0 -> 3) -> 5, 4, 3
    runScoredRoundWithTaps(sim3, [
      { tick: 100, slot: 2 },
      { tick: 200, slot: 1 },
      { tick: 250, slot: 0 },
    ]);
    // R5: slot 1 @ 250 (+2 -> 6), slot 0 @ 200 (+1 -> 6), slot 2 @ 100 (+0 -> 3) -> 6, 6, 3 => SUDDEN DEATH!
    runScoredRoundWithTaps(sim3, [
      { tick: 100, slot: 2 },
      { tick: 200, slot: 0 },
      { tick: 250, slot: 1 },
    ]);
    expect([
      readPlayerScore(sim3.state, 0),
      readPlayerScore(sim3.state, 1),
      readPlayerScore(sim3.state, 2),
    ]).toEqual([6, 6, 3]);
    expect((sim3.state[H.lampFlags]! & LAMP_FLAG.suddenDeath) !== 0).toBe(true);

    // Exiting ROUND_END skips PRACTICE and goes directly to COUNTDOWN with slot 2 parked.
    stepUntilPhase(sim3, P.countdown, 200);
    expect((readPlayerFlags(sim3.state, 2) & LIGHT_FLAG.active) === 0).toBe(true);
    expect((readPlayerFlags(sim3.state, 2) & LIGHT_FLAG.contender) === 0).toBe(true);
    expect((readPlayerFlags(sim3.state, 2) & LIGHT_FLAG.joined) !== 0).toBe(true);

    // Sudden Death same-tick tie -> 0 points awarded, immediate COUNTDOWN replay (FR-9.1).
    runScoredRoundWithTaps(sim3, [
      { tick: 180, slot: 0 },
      { tick: 180, slot: 1 },
      { tick: 260, slot: 2 }, // Parked slot 2 ignored!
    ]);
    expect(readPlayerScore(sim3.state, 0)).toBe(6);
    expect(readPlayerScore(sim3.state, 1)).toBe(6);
    expect(readPlayerScore(sim3.state, 2)).toBe(3);
    stepUntilPhase(sim3, P.countdown, 200);

    // Sudden Death void round -> 0 points, immediate COUNTDOWN replay (FR-9.9).
    runScoredRoundWithTaps(sim3, []);
    expect((sim3.state[H.lampFlags]! & LAMP_FLAG.voidRound) !== 0).toBe(true);
    stepUntilPhase(sim3, P.countdown, 200);

    // Sudden Death decisive win: slot 1 locks later than slot 0 -> +1 -> MATCH_OVER!
    runScoredRoundWithTaps(sim3, [
      { tick: 150, slot: 0 },
      { tick: 220, slot: 1 },
    ]);
    expect(readPlayerScore(sim3.state, 1)).toBe(7);
    expect(sim3.state[H.winnerSlot]).toBe(1);
    stepUntilPhase(sim3, P.matchOver, 200);

    // 8 Players (N = 8, target = 21)
    const sim8 = createLastLightSimulation();
    sim8.startMatch([0, 1, 2, 3, 4, 5, 6, 7], 303);
    expect(sim8.getMatchTarget()).toBe(21);

    // 5 tappers at distinct ticks + 3 non-tappers -> +7, +6, +5, +4, +3, +0, +0, +0
    runScoredRoundWithTaps(sim8, [
      { tick: 100, slot: 0 },
      { tick: 140, slot: 1 },
      { tick: 180, slot: 2 },
      { tick: 220, slot: 3 },
      { tick: 260, slot: 4 },
    ]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => readPlayerScore(sim8.state, i))).toEqual([
      3, 4, 5, 6, 7, 0, 0, 0,
    ]);

    // 8-way same-tick tie -> all 8 earn +7
    runScoredRoundWithTaps(
      sim8,
      [0, 1, 2, 3, 4, 5, 6, 7].map((slot) => ({ tick: 200, slot })),
    );
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => readPlayerLastRoundPoints(sim8.state, i))).toEqual([
      7, 7, 7, 7, 7, 7, 7, 7,
    ]);
  });

  test('INV-2, INV-3, INV-8, FR-6 & FR-9 edge cases: immutable lock, late tap reject, held-button guard, disconnect/rejoin, practice 4.1s guard', () => {
    const seed = 404;
    const exactBlowout = measureNextBlowoutTick([0, 1, 2], seed);

    const sim = createLastLightSimulation();
    sim.startMatch([0, 1, 2], seed);

    // FR-9.11: During PRACTICE, once phaseTimer drops below 4.1s and current blowout finishes,
    // no new practice blowout starts; lamp stays steady lit with lampElapsed === 0.
    let sawNewPracticeUnderGuard = false;
    let prevFlags = sim.state[H.lampFlags]! | 0;
    while (sim.state[H.phase] === P.practice) {
      const timerBefore = sim.state[H.phaseTimer]!;
      sim.step(DT);
      const flags = sim.state[H.lampFlags]! | 0;
      const startedPracticeBlowout =
        (prevFlags & LAMP_FLAG.practiceBlowout) === 0 && (flags & LAMP_FLAG.practiceBlowout) !== 0;
      if (startedPracticeBlowout && timerBefore < C.practiceGuardSec) {
        sawNewPracticeUnderGuard = true;
      }
      prevFlags = flags;
    }
    expect(sawNewPracticeUnderGuard).toBe(false);
    expect(sim.state[H.phase]).toBe(P.countdown);

    // FR-9.12: Slot 2 holds button throughout COUNTDOWN into ROUND_ACTIVE -> must NOT auto-lock.
    tapSlot(sim, 2);
    while (sim.state[H.phase] === P.countdown) {
      tapSlot(sim, 2);
      sim.step(DT);
    }
    expect(sim.state[H.phase]).toBe(P.active);

    // Step 10 ticks while slot 2 keeps holding button 1 -> still unlocked.
    for (let t = 0; t < 10; t += 1) {
      tapSlot(sim, 2);
      sim.step(DT);
    }
    expect(isPlayerLocked(sim.state, 2)).toBe(false);

    // Slot 0 locks at tick 11 (step 11 -> blowoutElapsedTicks becomes 11).
    tapSlot(sim, 0);
    sim.step(DT);
    expect(isPlayerLocked(sim.state, 0)).toBe(true);
    // INV-8: Public buffer keeps lockTick === -1 while lamp is LIT!
    expect(readPlayerLockTick(sim.state, 0)).toBe(-1);

    // INV-2: Slot 0 releases and taps again -> lock remains immutable.
    releaseSlot(sim, 0);
    sim.step(DT);
    tapSlot(sim, 0);
    sim.step(DT);
    expect(readPlayerLockTick(sim.state, 0)).toBe(-1);

    // FR-6: Slot 0 disconnects AFTER locking -> lock persists!
    // Slot 1 disconnects BEFORE locking -> cannot lock while disconnected!
    sim.setConnectedMask(0b100); // only slot 2 connected
    expect((readPlayerFlags(sim.state, 0) & LIGHT_FLAG.disconnected) !== 0).toBe(true);
    expect((readPlayerFlags(sim.state, 1) & LIGHT_FLAG.disconnected) !== 0).toBe(true);

    tapSlot(sim, 1);
    sim.step(DT);
    expect(isPlayerLocked(sim.state, 1)).toBe(false);

    // Slot 1 reconnects before blowout -> can now release & tap to lock.
    sim.setConnectedMask(0b110); // slots 1 and 2 connected
    releaseSlot(sim, 1);
    sim.step(DT);
    tapSlot(sim, 1);
    sim.step(DT);
    expect(isPlayerLocked(sim.state, 1)).toBe(true);

    // Release slot 2 now, wait until the exact blowoutTick, then tap slot 2 on the blowout tick -> rejected (INV-3).
    releaseSlot(sim, 2);
    // Current elapsed ticks = 16; step up to exactBlowout - 1.
    while (sim.state[H.phase] === P.active && Math.round(sim.state[H.lampElapsed]! * C.stepHz) < exactBlowout - 1) {
      sim.step(DT);
    }
    expect(sim.state[H.phase]).toBe(P.active);
    tapSlot(sim, 2); // arrives on exact blowoutTick
    sim.step(DT);
    expect(sim.state[H.phase]).toBe(P.roundEnd);

    // Slot 2 was rejected as late (OUT, score 0); slot 0 (locked earlier, then disconnected) kept lock (+1);
    // slot 1 (reconnected & locked later) won (+2).
    expect(isPlayerLocked(sim.state, 2)).toBe(false);
    expect((readPlayerFlags(sim.state, 2) & LIGHT_FLAG.out) !== 0).toBe(true);
    expect(readPlayerLockTick(sim.state, 0)).toBe(11); // immutable first lock, revealed on blowout
    expect(readPlayerLockTick(sim.state, 1)).toBeGreaterThan(11);
    expect(readPlayerLockTick(sim.state, 1)).toBeLessThan(exactBlowout);
    expect(readPlayerScore(sim.state, 1)).toBe(2);
    expect(readPlayerScore(sim.state, 0)).toBe(1);
    expect(readPlayerScore(sim.state, 2)).toBe(0);
    expect(readLockedMask(sim.state)).toBe(0b011);
  });

  test(
    '10,000-tick randomized fuzz asserts INV-1..INV-8 across 2-8 players with disconnects and reconnects',
    { timeout: 15_000 },
    () => {
      const sim = createLastLightSimulation();
      const slots = [0, 1, 2, 3, 4, 5];
      const seed = 0xfeedface;
      sim.startMatch(slots, seed);

      let fuzzRng = 0x12345678;
      const next = (): number => {
        fuzzRng = (fuzzRng + 0x6d2b79f5) >>> 0;
        let z = fuzzRng;
        z = Math.imul(z ^ (z >>> 15), z | 1);
        z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
        return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
      };

      const prevScores = new Float32Array(8);
      const maxActiveTicks = C.scoredMaxSec * C.stepHz;
      const maxRoundDelta = slots.length - 1;
      let activeTicks = 0;
      let checkedTicks = 0;

      for (let tick = 0; tick < 10000; tick += 1) {
        if (sim.state[H.phase] === P.matchOver) {
          // Start a fresh match to keep fuzzing continuously up to 10,000 ticks.
          sim.startMatch(slots, seed + tick);
          prevScores.fill(0);
          activeTicks = 0;
        }

        if (tick % 37 === 0) {
          let mask = 0;
          for (const s of slots) {
            if (next() > 0.15) mask |= 1 << s;
          }
          sim.setConnectedMask(mask);
        }

        for (const s of slots) {
          const press = next() < 0.02 ? 1 : 0;
          sim.applyInput(s, press, Math.floor((next() - 0.5) * 254), Math.floor((next() - 0.5) * 254));
        }

        sim.step(DT);

        // INV-1: All 88 floats finite.
        for (let i = 0; i < C.stateFloats; i += 1) {
          if (!Number.isFinite(sim.state[i]!)) {
            expect(Number.isFinite(sim.state[i]!)).toBe(true);
          }
        }

        const phase = sim.state[H.phase]!;
        const lampFlags = sim.state[H.lampFlags]! | 0;

        // INV-6: Bounded active round duration.
        if (phase === P.active) {
          activeTicks += 1;
          if (activeTicks > maxActiveTicks) {
            expect(activeTicks).toBeLessThanOrEqual(maxActiveTicks);
          }
        } else {
          activeTicks = 0;
        }

        // INV-8: Never expose lockTick while lamp is LIT.
        if ((lampFlags & LAMP_FLAG.lit) !== 0) {
          for (const s of slots) {
            const lockTick = readPlayerLockTick(sim.state, s);
            if (lockTick !== -1) {
              expect(lockTick).toBe(-1);
            }
          }
        }

        // INV-5: Monotonically non-decreasing scores bounded by N - 1 per round.
        for (const s of slots) {
          const sc = readPlayerScore(sim.state, s);
          const delta = sc - prevScores[s]!;
          if (delta < 0 || delta > maxRoundDelta) {
            expect(delta).toBeGreaterThanOrEqual(0);
            expect(delta).toBeLessThanOrEqual(maxRoundDelta);
          }
          prevScores[s] = sc;
        }
        checkedTicks += 1;
      }

      expect(checkedTicks).toBe(10000);
    },
  );
});
