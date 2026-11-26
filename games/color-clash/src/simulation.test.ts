import { describe, expect, test } from 'vitest';
import {
  COLOR_CLASH_CONSTANTS as C,
  PHASE_COUNTDOWN,
  PHASE_MATCH_OVER,
  PHASE_OVERTIME,
  PHASE_PRACTICE,
  PHASE_ROUND_ACTIVE,
  PHASE_ROUND_END,
} from './constants';
import { createColorClashSimulation, type ColorClashSimulation } from './simulation';

const DT = 1 / 120;
const PLAYER = 8;
const STRIDE = 10;

function baseOf(slot: number): number {
  return PLAYER + slot * STRIDE;
}

function advanceToActive(sim: ColorClashSimulation): void {
  let guard = 0;
  while ((sim.state[1] === PHASE_PRACTICE || sim.state[1] === PHASE_COUNTDOWN) && guard < 5000) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[1]).toBe(PHASE_ROUND_ACTIVE);
}

// Plain comparisons keep this fast enough for the 10,000-tick fuzz (issue #16).
// One expect at the end still reports every broken invariant by cell or slot.
function assertInvariants(sim: ColorClashSimulation, where = 'final'): void {
  const { state, auxState } = sim;
  const bad: string[] = [];
  if (state.length !== 88) bad.push(`state.length ${state.length} !== 88`);
  if (auxState.length !== 1600) bad.push(`auxState.length ${auxState.length} !== 1600`);
  for (let k = 0; k < 88; k += 1) {
    if (!Number.isFinite(state[k])) bad.push(`state[${k}] ${state[k]} not finite`);
  }
  const counts = new Uint16Array(8);
  for (let c = 0; c < 1600; c += 1) {
    const owner = auxState[c];
    if (!(owner >= 0 && owner <= 8)) bad.push(`cell ${c} owner ${owner} not in [0, 8]`);
    if (owner > 0) counts[owner - 1] += 1;
  }
  let total = 0;
  for (let slot = 0; slot < 8; slot += 1) {
    const b = baseOf(slot);
    const flags = state[b + 8];
    if ((flags & 1) !== 0) {
      if (!(Math.abs(state[b]) <= C.maxCoord + 1e-4)) bad.push(`slot ${slot} x ${state[b]} out of bounds`);
      if (!(Math.abs(state[b + 1]) <= C.maxCoord + 1e-4)) bad.push(`slot ${slot} y ${state[b + 1]} out of bounds`);
    }
    const cd = state[b + 5];
    const active = state[b + 6];
    if (!(cd >= 0 && cd <= C.boostCooldown + 1e-4)) bad.push(`slot ${slot} cooldown ${cd} not in [0, ${C.boostCooldown}]`);
    if (!(active >= 0 && active <= C.boostActive + 1e-4)) bad.push(`slot ${slot} boostActive ${active} not in [0, ${C.boostActive}]`);
    if (active > 0 && !(cd + 1e-4 >= active)) bad.push(`slot ${slot} cooldown ${cd} < boostActive ${active}`);
    // Same tolerance as toBeCloseTo(x, 4): |diff| < 10^-4 / 2.
    const pct = (counts[slot] * 100) / 1600;
    if (!(Math.abs(state[b + 7] - pct) < 5e-5)) bad.push(`slot ${slot} coverage ${state[b + 7]} !== ${pct}`);
    total += counts[slot];
  }
  if (total > 1600) bad.push(`total cells ${total} > 1600`);
  expect(bad, `invariants at ${where}`).toEqual([]);
}

describe('ColorClashSimulation', () => {
  test('stamps 40x40 grid with O(1) count conservation, corner boost clamping, and box boundary containment', () => {
    const sim = createColorClashSimulation();
    sim.startMatch([0, 1]);
    expect(sim.state[1]).toBe(C.practiceInitial > 0 ? 4 : PHASE_COUNTDOWN); // PHASE_PRACTICE is 4
    expect(sim.auxState.every((v) => v === 0)).toBe(true);

    // Skip practice to test COUNTDOWN lock
    sim.state[1] = PHASE_COUNTDOWN;
    sim.state[2] = 3.0;

    // applyInput is a strict no-op during COUNTDOWN
    const snapBefore = sim.state.slice();
    sim.applyInput(0, 1, 127, 0);
    expect(Array.from(sim.state)).toEqual(Array.from(snapBefore));

    advanceToActive(sim);
    // Drive slot 0 into top-right corner while boosting to test corner clamping & bounce
    sim.applyInput(0, 1, 127, 127);
    for (let i = 0; i < 240; i += 1) {
      sim.step(DT);
    }
    assertInvariants(sim);
    expect(sim.state[baseOf(0) + 7]).toBeGreaterThan(1);
    expect(Math.abs(sim.state[baseOf(0)])).toBeLessThanOrEqual(C.maxCoord + 1e-4);
    expect(Math.abs(sim.state[baseOf(0) + 1])).toBeLessThanOrEqual(C.maxCoord + 1e-4);

    // Overwrite slot 0 cells by placing slot 1 on slot 0's painted corner while slot 0 stays on its own paint
    const cornerX = sim.state[baseOf(0)];
    const cornerY = sim.state[baseOf(0) + 1];
    const cornerCol = Math.min(39, Math.max(0, Math.floor((cornerX + 400) / 20)));
    const cornerRow = Math.min(39, Math.max(0, Math.floor((cornerY + 400) / 20)));
    const cornerCell = cornerRow * 40 + cornerCol;
    expect(sim.auxState[cornerCell]).toBe(1);

    // Move slot 0 back onto an earlier already-painted spot (spawn -> corner path) and stop boosting
    sim.state[baseOf(0) + 6] = 0;
    sim.state[baseOf(0)] = 260;
    sim.state[baseOf(0) + 1] = 0;
    sim.state[baseOf(0) + 2] = 0;
    sim.state[baseOf(0) + 3] = 0;
    sim.state[baseOf(1)] = cornerX;
    sim.state[baseOf(1) + 1] = cornerY;
    sim.state[baseOf(1) + 2] = 0;
    sim.state[baseOf(1) + 3] = 0;
    sim.applyInput(0, 0, 0, 0);
    sim.applyInput(1, 0, 0, 0);
    const p0Before = sim.state[baseOf(0) + 7];
    sim.step(DT);
    assertInvariants(sim);
    expect(sim.auxState[cornerCell]).toBe(2);
    expect(sim.state[baseOf(0) + 7]).toBeLessThan(p0Before);
    expect(sim.state[baseOf(1) + 7]).toBeGreaterThan(0);
  });

  test('resolves same-tick overlap deterministically (boost beats normal, closer center wins)', () => {
    const sim = createColorClashSimulation();
    sim.startMatch([0, 1]);
    advanceToActive(sim);

    // Cell (20, 20) has world center (10, 10)
    const targetCell = 20 * 40 + 20;
    // Place slot 0 farther from (10, 10) and slot 1 closer to (10, 10), neither boosting
    sim.state[baseOf(0)] = -6;
    sim.state[baseOf(0) + 1] = 10;
    sim.state[baseOf(0) + 2] = 0;
    sim.state[baseOf(0) + 3] = 0;
    sim.state[baseOf(1)] = 12;
    sim.state[baseOf(1) + 1] = 10;
    sim.state[baseOf(1) + 2] = 0;
    sim.state[baseOf(1) + 3] = 0;
    sim.step(DT);
    expect(sim.auxState[targetCell]).toBe(2); // slot 1 (owner=2) is closer to (10, 10)

    // Now slot 1 is closer (dist 2) and slot 0 is farther (dist 20) BUT slot 0 is boosting
    sim.state[baseOf(0)] = -10;
    sim.state[baseOf(0) + 1] = 10;
    sim.state[baseOf(0) + 2] = 0;
    sim.state[baseOf(0) + 3] = 0;
    sim.state[baseOf(0) + 6] = 2.0; // boostActiveTimer > 0
    sim.state[baseOf(0) + 5] = 7.0;
    sim.state[baseOf(1)] = 12;
    sim.state[baseOf(1) + 1] = 10;
    sim.state[baseOf(1) + 2] = 0;
    sim.state[baseOf(1) + 3] = 0;
    sim.state[baseOf(1) + 6] = 0;
    sim.step(DT);
    expect(sim.auxState[targetCell]).toBe(1); // boosting slot 0 beats non-boosting slot 1
    assertInvariants(sim);
  });

  test('boost fires on rising edge for 3s wide stamp (r=54) with 8s cooldown and preserves disconnect territory', () => {
    const sim = createColorClashSimulation();
    sim.startMatch([0, 1]);
    advanceToActive(sim);

    // Normal single-tick stamp at (0, 0): radius 24 covers ~4-5 cells
    sim.state[baseOf(0)] = 0;
    sim.state[baseOf(0) + 1] = 0;
    sim.state[baseOf(1)] = -350;
    sim.state[baseOf(1) + 1] = -350;
    sim.step(DT);
    const normalPct = sim.state[baseOf(0) + 7];
    // Radius 24 covers 4 to 9 cells -> (4 * 100 / 1600 = 0.25%, 9 * 100 / 1600 = 0.5625%)
    expect(normalPct).toBeGreaterThanOrEqual(0.25);
    expect(normalPct).toBeLessThanOrEqual(0.60);

    // Rising edge BOOST expands stamp footprint to radius 54 (~21 cells) and gives high velocity impulse
    sim.applyInput(0, 1, 127, 0);
    sim.step(DT);
    expect(sim.state[baseOf(0) + 6]).toBeCloseTo(C.boostActive, 2);
    expect(sim.state[baseOf(0) + 5]).toBeCloseTo(C.boostCooldown, 2);
    expect(sim.state[baseOf(0) + 8] & 2).toBe(2);
    expect(sim.state[baseOf(0) + 7]).toBeGreaterThan(normalPct);
    expect(Math.hypot(sim.state[baseOf(0) + 2], sim.state[baseOf(0) + 3])).toBeGreaterThan(450);

    // Holding Bit 0 does not re-trigger after cooldown expires until released
    for (let i = 0; i < 120 * 9; i += 1) {
      sim.applyInput(0, 1, 0, 0);
      sim.step(DT);
    }
    expect(sim.state[baseOf(0) + 6]).toBe(0);
    expect(sim.state[baseOf(0) + 5]).toBe(0);

    // Disconnect: zero inputs for 5s decelerates puck to rest and keeps painted cells intact
    const ownedBeforeSilence = sim.state[baseOf(0) + 7];
    sim.applyInput(0, 0, 0, 0);
    for (let i = 0; i < 120 * 5; i += 1) {
      sim.step(DT);
    }
    expect(Math.hypot(sim.state[baseOf(0) + 2], sim.state[baseOf(0) + 3])).toBeLessThan(0.5);
    expect(sim.state[baseOf(0) + 7]).toBe(ownedBeforeSilence);
    assertInvariants(sim);
  });

  test('ends 45s round directly for unique leader and enters 30s Golden Tile OVERTIME on tie', () => {
    // Case A: unique leader after 45s round enters PHASE_ROUND_END
    const simA = createColorClashSimulation();
    simA.startMatch([0, 1]);
    advanceToActive(simA);
    simA.applyInput(0, 1, 127, 0);
    for (let i = 0; i < 120 * 46; i += 1) {
      if (simA.state[1] !== PHASE_ROUND_ACTIVE) break;
      simA.step(DT);
    }
    expect(simA.state[1]).toBe(2); // PHASE_ROUND_END
    expect(simA.state[7]).toBe(0); // leader slot 0
    // After roundEnd duration (0.8s), winner slot 0 has 1 pt (< threshold 3), so enters break practice (4)
    expect(simA.state[baseOf(0) + 9]).toBe(1);
    for (let i = 0; i < 120 * 1; i += 1) {
      simA.step(DT);
    }
    expect(simA.state[1]).toBe(4); // PHASE_PRACTICE break

    // Case B: tie at 45s -> OVERTIME -> Golden Tile instant win
    const simOT = createColorClashSimulation();
    simOT.startMatch([0, 1]);
    advanceToActive(simOT);
    for (let i = 0; i < 120 * 46; i += 1) {
      if (simOT.state[1] === PHASE_OVERTIME) break;
      simOT.step(DT);
    }
    expect(simOT.state[1]).toBe(PHASE_OVERTIME);
    const golden = simOT.state[4];
    expect(golden).toBeGreaterThanOrEqual(0);
    expect(golden).toBeLessThan(1600);
    expect(simOT.state[baseOf(0) + 8] & 8).toBe(8);
    expect(simOT.state[baseOf(1) + 8] & 8).toBe(8);

    // Move contender 1 onto goldenCell -> instant round win
    const gCol = golden % 40;
    const gRow = Math.floor(golden / 40);
    simOT.state[baseOf(1)] = -400 + (gCol + 0.5) * 20;
    simOT.state[baseOf(1) + 1] = -400 + (gRow + 0.5) * 20;
    simOT.step(DT);
    expect(simOT.state[1]).toBe(2); // PHASE_ROUND_END
    expect(simOT.state[7]).toBe(1);

    // Case C: Overtime expires with no Golden Tile capture -> terminates cleanly to round end
    const simExpire = createColorClashSimulation();
    simExpire.startMatch([0, 1]);
    advanceToActive(simExpire);
    for (let i = 0; i < 120 * 80; i += 1) {
      if (simExpire.state[1] === 2) break;
      simExpire.step(DT);
    }
    expect(simExpire.state[1]).toBe(2); // PHASE_ROUND_END
    expect(simExpire.state[7]).toBeGreaterThanOrEqual(0);
    assertInvariants(simExpire);
  });

  test('BOOST held through countdown does not fire on the first ROUND_ACTIVE frame; a fresh press still does (issue #23)', () => {
    const sim = createColorClashSimulation();
    sim.startMatch([0, 1]);
    expect(sim.state[1]).toBe(PHASE_PRACTICE);

    // Step through practice WITHOUT holding BOOST
    let guard = 0;
    while (sim.state[1] === PHASE_PRACTICE && guard < 120 * 35) {
      sim.applyInput(0, 0, 0, 0);
      sim.step(DT);
      guard += 1;
    }
    expect(sim.state[1]).toBe(PHASE_COUNTDOWN);

    // Hold BOOST only during countdown
    guard = 0;
    while (sim.state[1] === PHASE_COUNTDOWN && guard < 1000) {
      sim.applyInput(0, 1, 0, 0);
      sim.step(DT);
      guard += 1;
    }
    expect(sim.state[1]).toBe(PHASE_ROUND_ACTIVE);

    // Assert no boost on first ROUND_ACTIVE frame
    sim.applyInput(0, 1, 0, 0);
    sim.step(DT);
    expect(sim.state[baseOf(0) + 6]).toBe(0);
    expect(sim.state[baseOf(0) + 8] & 2).toBe(0);

    // Release and press after that should still give a 3s boost
    sim.applyInput(0, 0, 0, 0);
    sim.step(DT);
    sim.applyInput(0, 1, 0, 0);
    sim.step(DT);
    expect(sim.state[baseOf(0) + 6]).toBeCloseTo(C.boostActive, 2);
    expect(sim.state[baseOf(0) + 8] & 2).toBe(2);
  });

  test('BOOST held into OVERTIME does not fire on the first overtime frame; a fresh press still does (issue #23)', () => {
    const sim = createColorClashSimulation();
    sim.startMatch([0, 1]);
    let guard = 0;
    while (sim.state[1] !== PHASE_OVERTIME && guard < 120 * 85) {
      sim.applyInput(0, 1, 0, 0);
      sim.applyInput(1, 1, 0, 0);
      sim.step(DT);
      guard += 1;
    }
    expect(sim.state[1]).toBe(PHASE_OVERTIME);

    sim.applyInput(0, 1, 0, 0);
    sim.applyInput(1, 1, 0, 0);
    sim.step(DT);
    expect(sim.state[baseOf(0) + 6]).toBe(0);
    expect(sim.state[baseOf(0) + 8] & 2).toBe(0);

    sim.applyInput(0, 0, 0, 0);
    sim.step(DT);
    sim.applyInput(0, 1, 0, 0);
    sim.step(DT);
    expect(sim.state[baseOf(0) + 6]).toBeCloseTo(C.boostActive, 2);
    expect(sim.state[baseOf(0) + 8] & 2).toBe(2);
  });

  test('reaches target score across rounds and ends match at PHASE_MATCH_OVER', () => {
    const sim = createColorClashSimulation();
    sim.startMatch([0, 1]); // 2 players -> target = 3 pts
    expect(sim.state[1]).toBe(PHASE_PRACTICE);

    // Fast forward rounds where slot 0 wins
    for (let round = 0; round < 3; round += 1) {
      advanceToActive(sim);
      // Let slot 0 paint and win round
      sim.applyInput(0, 1, 127, 0);
      for (let i = 0; i < 120 * 46; i += 1) {
        if (sim.state[1] === PHASE_ROUND_END) break;
        sim.step(DT);
      }
      expect(sim.state[1]).toBe(PHASE_ROUND_END);
      expect(sim.state[7]).toBe(0); // slot 0 won round
      // Step past ROUND_END
      for (let i = 0; i < 120 * 1; i += 1) {
        if (sim.state[1] === PHASE_MATCH_OVER || sim.state[1] === PHASE_PRACTICE) break;
        sim.step(DT);
      }
    }

    expect(sim.state[1]).toBe(PHASE_MATCH_OVER);
    expect(sim.state[baseOf(0) + 9]).toBe(3); // 3 pts reached
    expect(sim.state[baseOf(1) + 9]).toBe(0);
    expect(sim.state[7]).toBe(0); // match winner slot 0
  });

  test('enters sudden death when leaders tie at or above threshold and resolves with sole winner', () => {
    const sim = createColorClashSimulation();
    sim.startMatch([0, 1]); // Target = 3 pts

    // Manually set both players to 3 pts (tied at threshold -> sudden death)
    sim.state[baseOf(0) + 9] = 3;
    sim.state[baseOf(1) + 9] = 3;

    advanceToActive(sim);

    // Let slot 1 paint and win the round
    sim.applyInput(1, 1, 127, 0);
    for (let i = 0; i < 120 * 46; i += 1) {
      if (sim.state[1] === PHASE_ROUND_END) break;
      sim.step(DT);
    }
    expect(sim.state[1]).toBe(PHASE_ROUND_END);
    expect(sim.state[7]).toBe(1); // slot 1 won round

    // In sudden death, only the round winner (slot 1) receives +1 pt
    expect(sim.state[baseOf(0) + 9]).toBe(3);
    expect(sim.state[baseOf(1) + 9]).toBe(4);

    // Step through ROUND_END (0.8s)
    for (let i = 0; i < 120 * 1; i += 1) {
      sim.step(DT);
    }

    // Unique winner (4 vs 3) -> PHASE_MATCH_OVER
    expect(sim.state[1]).toBe(PHASE_MATCH_OVER);
    expect(sim.state[7]).toBe(1);
  });
  });

  test('sudden death only activates tied leaders and parks non-leaders (Sumo rule)', () => {
    const sim = createColorClashSimulation();
    sim.startMatch([0, 1, 2]); // 3 players -> target = 6 pts

    // Slot 0 and Slot 1 tied at 6 pts (leaders at threshold). Slot 2 behind at 4 pts.
    sim.state[baseOf(0) + 9] = 6;
    sim.state[baseOf(1) + 9] = 6;
    sim.state[baseOf(2) + 9] = 4;

    // Advance through break/countdown to active
    advanceToActive(sim);

    // Slot 2 is below top score in sudden death, so slot 2 is parked offscreen and inactive
    expect(sim.state[baseOf(2) + 8] & 1).toBe(0);
    expect(sim.state[baseOf(2)]).toBe(10000);
    // Leaders are active
    expect(sim.state[baseOf(0) + 8] & 1).toBe(1);
    expect(sim.state[baseOf(1) + 8] & 1).toBe(1);

    // Even if slot 2 sends steering inputs, non-leader inputs do not move them or paint
    sim.applyInput(2, 1, 127, 0);
    sim.step(DT);
    expect(sim.state[baseOf(2)]).toBe(10000);
    expect(sim.state[baseOf(2) + 7]).toBe(0);

    // With leaders idle (as if AWAY) and non-leader active, sudden death tiebreak resolves
    // between tied leaders without stalling
    for (let i = 0; i < 120 * 80; i += 1) {
      if (sim.state[1] === PHASE_ROUND_END) break;
      sim.step(DT);
    }
    expect(sim.state[1]).toBe(PHASE_ROUND_END);
    // Winner is a leader (slot 0 by deterministic tiebreak), not slot 2
    expect(sim.state[7]).toBe(0);
    expect(sim.state[baseOf(0) + 9]).toBe(7);
    expect(sim.state[baseOf(1) + 9]).toBe(6);
    expect(sim.state[baseOf(2) + 9]).toBe(4);

    // Step through round end -> unique leader (7 >= 6) -> PHASE_MATCH_OVER
    for (let i = 0; i < 120 * 1; i += 1) {
      sim.step(DT);
    }
    expect(sim.state[1]).toBe(PHASE_MATCH_OVER);
    expect(sim.state[7]).toBe(0); // match winner slot 0
  });

  test('10,000-tick fuzz holds invariants INV-1..6 and replay is bit-exact (INV-8)', () => {
    function runScripted(ticks: number) {
      const sim = createColorClashSimulation();
      sim.startMatch([0, 1, 2, 3, 4, 5, 6, 7]);
      let seed = 0x13579bdf;
      const nextByte = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed & 0xff;
      };
      for (let t = 0; t < ticks; t += 1) {
        if (sim.state[1] === PHASE_MATCH_OVER) {
          sim.startMatch([0, 1, 2, 3, 4, 5, 6, 7]);
        }
        for (let slot = 0; slot < 8; slot += 1) {
          const btn = (nextByte() & 31) === 0 ? 1 : 0;
          const ax = (nextByte() % 255) - 127;
          const ay = (nextByte() % 255) - 127;
          sim.applyInput(slot, btn, ax, ay);
        }
        sim.step(DT);
        if (t % 50 === 0) assertInvariants(sim, `tick ${t}`);
      }
      assertInvariants(sim);
      return {
        state: new Uint8Array(sim.state.buffer.slice(0)),
        aux: sim.auxState.slice(),
      };
    }

    const run1 = runScripted(10000);
    const run2 = runScripted(10000);
    expect(Array.from(run1.state)).toEqual(Array.from(run2.state));
    expect(Array.from(run1.aux)).toEqual(Array.from(run2.aux));
  }, 15_000);
});
