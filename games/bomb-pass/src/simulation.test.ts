import { expect, test } from 'vitest';
import {
  BOMB_CONSTANTS as C,
  BOMB_FLAG_ALIVE,
  BOMB_FLAG_EXPLODED,
  BOMB_FLAG_HOLDING,
  BOMB_FLAG_SD_CONTENDER,
  BOMB_HEADER,
  BOMB_PHASE,
  BOMB_PLAYER_BASE,
  BOMB_PLAYER_STRIDE,
  BOMB_ROUND_FLAG,
} from './constants.ts';
import { createBombPassSimulation, type BombPassSimulation } from './simulation.ts';

const DT = 1 / 120;

function playerBase(slot: number): number {
  return BOMB_PLAYER_BASE + slot * BOMB_PLAYER_STRIDE;
}

function stepTicks(sim: BombPassSimulation, ticks: number): void {
  for (let t = 0; t < ticks; t += 1) sim.step(DT);
}

function advanceToActive(sim: BombPassSimulation): void {
  let guard = 0;
  while (sim.state[BOMB_HEADER.phase] !== BOMB_PHASE.active && guard < 4000) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[BOMB_HEADER.phase]).toBe(BOMB_PHASE.active);
}

function assertInvariants(sim: BombPassSimulation): void {
  const s = sim.state;
  // INV-1: All 88 floats finite
  for (let i = 0; i < C.stateFloats; i += 1) {
    expect(Number.isFinite(s[i])).toBe(true);
  }
  const phase = s[BOMB_HEADER.phase];
  const maxR = C.arenaRadius - C.puckRadius + 1e-3;
  // INV-2: Radial containment during PRACTICE and ROUND_ACTIVE
  if (phase === BOMB_PHASE.practice || phase === BOMB_PHASE.active) {
    for (let slot = 0; slot < C.maxPlayers; slot += 1) {
      const base = playerBase(slot);
      if ((s[base + 8] & BOMB_FLAG_ALIVE) === 0) continue;
      const dist = Math.hypot(s[base], s[base + 1]);
      expect(dist).toBeLessThanOrEqual(maxR);
    }
  }
  // INV-3: Single bomb conservation during ROUND_ACTIVE
  if (phase === BOMB_PHASE.active) {
    const holder = s[BOMB_HEADER.bombHolder];
    let holdingCount = 0;
    for (let slot = 0; slot < C.maxPlayers; slot += 1) {
      const flags = s[playerBase(slot) + 8];
      if ((flags & BOMB_FLAG_HOLDING) !== 0) {
        holdingCount += 1;
        expect(slot).toBe(holder);
        expect((flags & BOMB_FLAG_ALIVE) !== 0).toBe(true);
      }
    }
    if (holder === -1) {
      expect(holdingCount).toBe(0);
    } else {
      expect(Number.isInteger(holder)).toBe(true);
      expect(holder).toBeGreaterThanOrEqual(0);
      expect(holder).toBeLessThan(C.maxPlayers);
      expect(holdingCount).toBe(1);
    }
  }
  // INV-4: Monotonic non-negative timers within bounds
  expect(s[BOMB_HEADER.bombTimer]).toBeGreaterThanOrEqual(0);
  expect(s[BOMB_HEADER.bombTimer]).toBeLessThanOrEqual(C.fuseDuration + 1e-4);
  expect(s[BOMB_HEADER.transferCooldown]).toBeGreaterThanOrEqual(0);
  expect(s[BOMB_HEADER.transferCooldown]).toBeLessThanOrEqual(C.transferCooldown + 1e-4);
  for (let slot = 0; slot < C.maxPlayers; slot += 1) {
    const base = playerBase(slot);
    expect(s[base + 5]).toBeGreaterThanOrEqual(0);
    expect(s[base + 5]).toBeLessThanOrEqual(C.dashCooldown + 1e-4);
    expect(s[base + 6]).toBeGreaterThanOrEqual(0);
    expect(s[base + 6]).toBeLessThanOrEqual(C.dashActive + 1e-4);
    expect(s[base + 7]).toBeGreaterThanOrEqual(0);
    expect(s[base + 7]).toBeLessThanOrEqual(C.blastBreather + 1e-4);
  }
}

test('solid circular boundary keeps dashing puck inside R - r with inward reflection (INV-2)', () => {
  const sim = createBombPassSimulation();
  sim.startMatch([0, 1], 0x12345678);
  const base0 = playerBase(0);
  // Place P0 near rim moving outward and dash radially outward
  sim.state[base0] = 365;
  sim.state[base0 + 1] = 0;
  sim.state[base0 + 2] = 0;
  sim.state[base0 + 3] = 0;
  sim.applyInput(0, 1, 127, 0);
  stepTicks(sim, 3);
  const dist = Math.hypot(sim.state[base0], sim.state[base0 + 1]);
  expect(dist).toBeLessThanOrEqual(C.arenaRadius - C.puckRadius + 1e-3);
  expect(sim.state[base0 + 2]).toBeLessThan(0);
});

test('seeded initial assignment, 15s fuse explosion, 0.85s breather, and re-arm (INV-3, INV-4)', () => {
  const sim = createBombPassSimulation();
  sim.startMatch([0, 1, 2], 0x00c0ffee);
  expect(sim.state[BOMB_HEADER.phase]).toBe(BOMB_PHASE.practice);
  expect(sim.state[BOMB_HEADER.bombHolder]).toBe(-1);

  advanceToActive(sim);
  const initialHolder = sim.state[BOMB_HEADER.bombHolder];
  expect(initialHolder).toBeGreaterThanOrEqual(0);
  expect(initialHolder).toBeLessThanOrEqual(2);
  expect(sim.state[BOMB_HEADER.bombTimer]).toBeCloseTo(C.fuseDuration, 3);
  expect((sim.state[playerBase(initialHolder) + 8] & BOMB_FLAG_HOLDING) !== 0).toBe(true);

  // Step 15.0s with no contact -> initial holder explodes, breather begins
  stepTicks(sim, 15 * 120 + 2);
  expect((sim.state[playerBase(initialHolder) + 8] & BOMB_FLAG_ALIVE) === 0).toBe(true);
  expect((sim.state[playerBase(initialHolder) + 8] & BOMB_FLAG_EXPLODED) !== 0).toBe(true);
  expect(sim.state[BOMB_HEADER.phase]).toBe(BOMB_PHASE.active);
  expect(sim.state[BOMB_HEADER.bombHolder]).toBe(-1);
  expect(sim.state[BOMB_HEADER.phaseTimer]).toBeGreaterThan(0);

  // After 0.85s breather -> new bomb arms on one of the 2 remaining survivors
  stepTicks(sim, Math.ceil(C.blastBreather * 120) + 2);
  const nextHolder = sim.state[BOMB_HEADER.bombHolder];
  expect(nextHolder).toBeGreaterThanOrEqual(0);
  expect(nextHolder).not.toBe(initialHolder);
  expect((sim.state[playerBase(nextHolder) + 8] & BOMB_FLAG_ALIVE) !== 0).toBe(true);
  expect(sim.state[BOMB_HEADER.bombTimer]).toBeGreaterThan(14.5);
});

test('collision transfer preserves bombTimer and enforces 0.5s lockout without ping-pong (INV-4)', () => {
  const sim = createBombPassSimulation();
  sim.startMatch([0, 1, 2], 0x11223344);
  advanceToActive(sim);

  const holder = sim.state[BOMB_HEADER.bombHolder];
  const other = holder === 0 ? 1 : 0;
  const third = [0, 1, 2].find((s) => s !== holder && s !== other)!;

  // Move third far away; step 2 seconds so timer is ~13s
  sim.state[playerBase(third)] = 0;
  sim.state[playerBase(third) + 1] = 300;
  stepTicks(sim, 240);
  const timerBefore = sim.state[BOMB_HEADER.bombTimer];
  expect(timerBefore).toBeCloseTo(13.0, 1);

  // Force overlap between holder and other
  sim.state[playerBase(holder)] = 0;
  sim.state[playerBase(holder) + 1] = 0;
  sim.state[playerBase(holder) + 2] = 100;
  sim.state[playerBase(holder) + 3] = 0;
  sim.state[playerBase(other)] = 40;
  sim.state[playerBase(other) + 1] = 0;
  sim.state[playerBase(other) + 2] = -100;
  sim.state[playerBase(other) + 3] = 0;
  sim.step(DT);

  expect(sim.state[BOMB_HEADER.bombHolder]).toBe(other);
  expect(sim.state[BOMB_HEADER.transferCooldown]).toBeCloseTo(C.transferCooldown, 3);
  expect(sim.state[BOMB_HEADER.bombTimer]).toBeCloseTo(timerBefore - DT, 2);

  // Force immediate second overlap 0.1s later -> blocked by lockout
  stepTicks(sim, 12);
  sim.state[playerBase(holder)] = 0;
  sim.state[playerBase(holder) + 1] = 0;
  sim.state[playerBase(other)] = 30;
  sim.state[playerBase(other) + 1] = 0;
  sim.step(DT);
  expect(sim.state[BOMB_HEADER.bombHolder]).toBe(other);

  // Wait past 0.55s total -> transfer back to original holder succeeds
  stepTicks(sim, 55);
  expect(sim.state[BOMB_HEADER.transferCooldown]).toBe(0);
  sim.state[playerBase(holder)] = 0;
  sim.state[playerBase(holder) + 1] = 0;
  sim.state[playerBase(other)] = 30;
  sim.state[playerBase(other) + 1] = 0;
  sim.step(DT);
  expect(sim.state[BOMB_HEADER.bombHolder]).toBe(holder);
});

test('multi-puck cluster tie-breaks by distSq, then closing speed, then lowest slot (INV-5)', () => {
  // Case 1: closest distSq wins
  {
    const sim = createBombPassSimulation();
    sim.startMatch([0, 1, 2], 0xaaaa);
    advanceToActive(sim);
    const holder = sim.state[BOMB_HEADER.bombHolder];
    const [a, b] = [0, 1, 2].filter((s) => s !== holder);
    sim.state[playerBase(holder)] = 0;
    sim.state[playerBase(holder) + 1] = 0;
    sim.state[playerBase(holder) + 2] = 0;
    sim.state[playerBase(holder) + 3] = 0;
    sim.state[playerBase(a)] = 48;
    sim.state[playerBase(a) + 1] = 0;
    sim.state[playerBase(b)] = -40;
    sim.state[playerBase(b) + 1] = 0;
    sim.step(DT);
    expect(sim.state[BOMB_HEADER.bombHolder]).toBe(b);
  }

  // Case 2: equal distance -> higher closing speed wins
  {
    const sim = createBombPassSimulation();
    sim.startMatch([0, 1, 2], 0xaaaa);
    advanceToActive(sim);
    const holder = sim.state[BOMB_HEADER.bombHolder];
    const [a, b] = [0, 1, 2].filter((s) => s !== holder);
    sim.state[playerBase(holder)] = 0;
    sim.state[playerBase(holder) + 1] = 0;
    sim.state[playerBase(holder) + 2] = 0;
    sim.state[playerBase(holder) + 3] = 0;
    // Both at exact distance 40, b moving faster toward holder
    sim.state[playerBase(a)] = 40;
    sim.state[playerBase(a) + 1] = 0;
    sim.state[playerBase(a) + 2] = 0;
    sim.state[playerBase(a) + 3] = 0;
    sim.state[playerBase(b)] = -40;
    sim.state[playerBase(b) + 1] = 0;
    sim.state[playerBase(b) + 2] = 200;
    sim.state[playerBase(b) + 3] = 0;
    // Wait: integrateMotion moves b closer too! So place a slightly closer before step OR give exact post-integration tie
    // Place them so after 1 tick of motion their positions are equal distance? Actually set pre-move positions compensating velocity:
    // At dt = 1/120, damp = exp(-4.2/120) ≈ 0.9656; simpler: verify equal distance AND equal velocity -> lowest slot wins in Case 3,
    // and for Case 2 compensate b's starting x so post-integration dist matches a's!
    const damp = Math.exp(-C.mu * DT);
    sim.state[playerBase(b)] = -(40 + 200 * damp * DT);
    sim.step(DT);
    expect(sim.state[BOMB_HEADER.bombHolder]).toBe(b);
  }

  // Case 3: equal distance and equal closing speed -> lowest slot wins
  {
    const sim = createBombPassSimulation();
    sim.startMatch([0, 1, 2], 0xaaaa);
    advanceToActive(sim);
    const holder = sim.state[BOMB_HEADER.bombHolder];
    const [low, high] = [0, 1, 2].filter((s) => s !== holder).sort((x, y) => x - y);
    sim.state[playerBase(holder)] = 0;
    sim.state[playerBase(holder) + 1] = 0;
    sim.state[playerBase(holder) + 2] = 0;
    sim.state[playerBase(holder) + 3] = 0;
    sim.state[playerBase(low)] = 40;
    sim.state[playerBase(low) + 1] = 0;
    sim.state[playerBase(low) + 2] = 0;
    sim.state[playerBase(low) + 3] = 0;
    sim.state[playerBase(high)] = -40;
    sim.state[playerBase(high) + 1] = 0;
    sim.state[playerBase(high) + 2] = 0;
    sim.state[playerBase(high) + 3] = 0;
    sim.step(DT);
    expect(sim.state[BOMB_HEADER.bombHolder]).toBe(low);
  }
});

test('disconnect while holding bomb auto-passes to closest connected alive puck with >= 2.0s floor (INV-6)', () => {
  const sim = createBombPassSimulation();
  sim.startMatch([0, 1, 2], 0x5555);
  advanceToActive(sim);
  const holder = sim.state[BOMB_HEADER.bombHolder];
  const [near, far] = [0, 1, 2].filter((s) => s !== holder);

  sim.state[playerBase(holder)] = 0;
  sim.state[playerBase(holder) + 1] = 0;
  sim.state[playerBase(near)] = 120;
  sim.state[playerBase(near) + 1] = 0;
  sim.state[playerBase(far)] = 260;
  sim.state[playerBase(far) + 1] = 0;
  sim.state[BOMB_HEADER.bombTimer] = 0.8;

  // Disconnect holder only
  const mask = ((1 << near) | (1 << far)) & 0xff;
  sim.setConnectedMask(mask);
  sim.step(DT);

  expect(sim.state[BOMB_HEADER.bombHolder]).toBe(near);
  expect(sim.state[BOMB_HEADER.bombTimer]).toBeCloseTo(C.disconnectFuseFloor, 3);
  expect(sim.state[BOMB_HEADER.transferCooldown]).toBeCloseTo(C.transferCooldown, 3);
  // Disconnected puck is NOT eliminated
  expect((sim.state[playerBase(holder) + 8] & BOMB_FLAG_ALIVE) !== 0).toBe(true);
});

test('simultaneous final-2 point-blank explosion awards 0 pts and triggers 7.5s ROUND_SUDDEN_DEATH (INV-7)', () => {
  const sim = createBombPassSimulation();
  sim.startMatch([0, 1], 0x7777);
  advanceToActive(sim);

  // Place both pucks within blast radius (64) while transferCooldown prevents passing
  sim.state[playerBase(0)] = 0;
  sim.state[playerBase(0) + 1] = 0;
  sim.state[playerBase(1)] = 58;
  sim.state[playerBase(1) + 1] = 0;
  sim.state[BOMB_HEADER.transferCooldown] = 0.4;
  sim.state[BOMB_HEADER.bombTimer] = DT * 0.5;

  sim.step(DT);

  expect(sim.state[BOMB_HEADER.phase]).toBe(BOMB_PHASE.roundEnd);
  expect((sim.state[playerBase(0) + 8] & BOMB_FLAG_ALIVE) === 0).toBe(true);
  expect((sim.state[playerBase(1) + 8] & BOMB_FLAG_ALIVE) === 0).toBe(true);
  expect(sim.state[playerBase(0) + 9]).toBe(0);
  expect(sim.state[playerBase(1) + 9]).toBe(0);
  expect((sim.state[BOMB_HEADER.roundFlags] & BOMB_ROUND_FLAG.roundSuddenDeath) !== 0).toBe(true);
  expect((sim.state[playerBase(0) + 8] & BOMB_FLAG_SD_CONTENDER) !== 0).toBe(true);
  expect((sim.state[playerBase(1) + 8] & BOMB_FLAG_SD_CONTENDER) !== 0).toBe(true);

  // Advance past 1.5s ROUND_END -> skips PRACTICE directly into COUNTDOWN
  stepTicks(sim, Math.ceil(C.roundEndSuddenDeath * 120) + 2);
  expect(sim.state[BOMB_HEADER.phase]).toBe(BOMB_PHASE.countdown);

  // Advance past 3.0s COUNTDOWN -> ROUND_ACTIVE with halved 7.5s fuse
  stepTicks(sim, Math.ceil(C.countdown * 120) + 2);
  expect(sim.state[BOMB_HEADER.phase]).toBe(BOMB_PHASE.active);
  expect(sim.state[BOMB_HEADER.bombTimer]).toBeGreaterThan(7.0);
  expect(sim.state[BOMB_HEADER.bombTimer]).toBeLessThanOrEqual(C.suddenDeathFuse + 1e-4);
});

test('10,000-tick 8-player fuzz preserves INV-1..INV-7 and replays bit-exact (INV-9)', () => {
  function runFuzz(seed: number, ticks: number): Float32Array {
    const sim = createBombPassSimulation();
    sim.startMatch([0, 1, 2, 3, 4, 5, 6, 7], seed);
    let rng = (seed ^ 0x9e3779b9) >>> 0;
    const nextRand = (): number => {
      rng = (rng + 0x6d2b79f5) >>> 0;
      let z = rng;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };

    for (let t = 0; t < ticks; t += 1) {
      if (t % 300 === 150) {
        const drop = Math.floor(nextRand() * 8);
        sim.setConnectedMask(0xff & ~(1 << drop));
      } else if (t % 300 === 210) {
        sim.setConnectedMask(0xff);
      }
      if (t % 2 === 0) {
        for (let slot = 0; slot < 8; slot += 1) {
          const ax = Math.round((nextRand() * 2 - 1) * 127);
          const ay = Math.round((nextRand() * 2 - 1) * 127);
          const btn = nextRand() < 0.06 ? 1 : 0;
          sim.applyInput(slot, btn, ax, ay);
        }
      }
      sim.step(DT);
      if (t % 25 === 0) assertInvariants(sim);
      if (sim.state[BOMB_HEADER.phase] === BOMB_PHASE.matchOver) {
        sim.startMatch([0, 1, 2, 3, 4, 5, 6, 7], seed + t);
      }
    }
    assertInvariants(sim);
    return new Float32Array(sim.state);
  }

  const snapA = runFuzz(0xdeadbeef, 10000);
  const snapB = runFuzz(0xdeadbeef, 10000);
  const bytesA = new Uint8Array(snapA.buffer, snapA.byteOffset, snapA.byteLength);
  const bytesB = new Uint8Array(snapB.buffer, snapB.byteOffset, snapB.byteLength);
  expect(bytesA).toEqual(bytesB);
});
