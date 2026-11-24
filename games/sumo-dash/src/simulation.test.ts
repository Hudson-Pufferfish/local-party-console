import { expect, test } from 'vitest';
import { SUMO_CONSTANTS } from './constants';
import { scoreboardLine } from './scoreboard';
import { createSumoSimulation } from './simulation';

declare const Buffer: {
  compare(left: Uint8Array, right: Uint8Array): number;
};

const PHASE = 1;
const ARENA_RADIUS = 3;
const DT = 1 / 120;
const R0 = 400;
const RFLOOR = SUMO_CONSTANTS.rFloor;

test('arena radius stays inside the ring and never grows during a round', () => {
  const sim = createSumoSimulation();
  expect(sim.state.length).toBe(88);
  expect(sim.state.buffer.byteLength).toBe(352);

  sim.startMatch([0, 1]);
  let guard = 0;
  while (sim.state[PHASE] !== 1 && guard < 4000) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(1);

  let previous = sim.state[ARENA_RADIUS];
  expect(previous).toBe(R0);
  let sawShrink = false;
  let sawBelowMin = false;

  for (let n = 0; n < 6000 && sim.state[PHASE] === 1; n += 1) {
    sim.state[8] = 0;
    sim.state[9] = 0;
    sim.state[10] = 0;
    sim.state[11] = 0;
    sim.state[18] = 0;
    sim.state[19] = 0;
    sim.state[20] = 0;
    sim.state[21] = 0;
    sim.step(DT);
    const radius = sim.state[ARENA_RADIUS];
    expect(radius).toBeGreaterThanOrEqual(RFLOOR);
    expect(radius).toBeLessThanOrEqual(R0);
    expect(radius).toBeLessThanOrEqual(previous);
    if (radius < previous) sawShrink = true;
    if (radius < 110) sawBelowMin = true;
    previous = radius;
  }

  expect(sawShrink).toBe(true);
  expect(sawBelowMin).toBe(true);
});

function slotBase(slot: number): number {
  return 8 + slot * 10;
}

function reachActive(sim: ReturnType<typeof createSumoSimulation>): void {
  let guard = 0;
  while (sim.state[PHASE] !== 1 && guard < 4000) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(1);
}

function reachCountdown(sim: ReturnType<typeof createSumoSimulation>): void {
  let guard = 0;
  while (sim.state[PHASE] !== 0 && guard < 4000) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(0);
}

test('holding dash fires one rising edge and keeps cooldown in range', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1]);
  reachCountdown(sim);
  const active = slotBase(0) + 6;
  const cooldown = slotBase(0) + 5;
  const vx = slotBase(0) + 2;
  const vy = slotBase(0) + 3;

  while (sim.state[PHASE] === 0) {
    sim.applyInput(0, 1, 0, 0);
    sim.step(DT);
    expect(sim.state[active]).toBe(0);
    expect(sim.state[cooldown]).toBeGreaterThanOrEqual(0);
    expect(sim.state[cooldown]).toBeLessThanOrEqual(1.5);
  }

  let fires = 0;
  let previousActive = 0;
  for (let n = 0; n < 60; n += 1) {
    sim.applyInput(0, 1, 0, 0);
    sim.step(DT);
    const now = sim.state[active];
    if (previousActive <= 0 && now > 0) {
      fires += 1;
    }
    previousActive = now;
    expect(sim.state[cooldown]).toBeGreaterThanOrEqual(0);
    expect(sim.state[cooldown]).toBeLessThanOrEqual(1.5);
    expect(now).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThanOrEqual(Math.fround(0.18));
  }
  expect(fires).toBe(0);

  sim.applyInput(0, 0, 0, 0);
  sim.step(DT);

  fires = 0;
  previousActive = sim.state[active];
  let dashVx = 0;
  let dashVy = 0;
  for (let n = 0; n < 360; n += 1) {
    sim.applyInput(0, 1, 127, 0);
    sim.step(DT);
    const now = sim.state[active];
    if (previousActive <= 0 && now > 0) {
      fires += 1;
      dashVx = sim.state[vx];
      dashVy = sim.state[vy];
    }
    previousActive = now;
    expect(sim.state[cooldown]).toBeGreaterThanOrEqual(0);
    expect(sim.state[cooldown]).toBeLessThanOrEqual(1.5);
    expect(now).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThanOrEqual(Math.fround(0.18));
  }

  expect(fires).toBe(1);
  expect(dashVx).toBeCloseTo(920, 3);
  expect(dashVy).toBeCloseTo(0, 3);
});

function countAlive(sim: ReturnType<typeof createSumoSimulation>): number {
  let count = 0;
  for (let slot = 0; slot < 8; slot += 1) {
    if ((sim.state[slotBase(slot) + 8] & 1) !== 0) {
      count += 1;
    }
  }
  return count;
}

function scoreSum(sim: ReturnType<typeof createSumoSimulation>): number {
  let sum = 0;
  for (let slot = 0; slot < 8; slot += 1) {
    sum += sim.state[slotBase(slot) + 9];
  }
  return sum;
}

test('same-tick ring-outs draw and award no score', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1]);
  reachActive(sim);
  const before = scoreSum(sim);
  const radius = sim.state[ARENA_RADIUS];
  sim.state[slotBase(0)] = radius + 1;
  sim.state[slotBase(0) + 1] = 0;
  sim.state[slotBase(1)] = -(radius + 1);
  sim.state[slotBase(1) + 1] = 0;
  sim.step(DT);

  expect(countAlive(sim)).toBe(0);
  expect(scoreSum(sim)).toBe(before);
  expect(sim.state[PHASE]).toBe(2);
});

function placeHeadOn(sim: ReturnType<typeof createSumoSimulation>): void {
  const left = slotBase(0);
  const right = slotBase(1);
  sim.state[left] = -20;
  sim.state[left + 1] = 0;
  sim.state[left + 2] = 100;
  sim.state[left + 3] = 0;
  sim.state[left + 6] = 0;
  sim.state[left + 7] = 0;
  sim.state[right] = 20;
  sim.state[right + 1] = 0;
  sim.state[right + 2] = -100;
  sim.state[right + 3] = 0;
  sim.state[right + 6] = 0;
  sim.state[right + 7] = 0;
}

test('overlap stays finite and dash ram scales only the victim', () => {
  const coincident = createSumoSimulation();
  coincident.startMatch([0, 1]);
  reachActive(coincident);
  coincident.state[slotBase(0)] = 0;
  coincident.state[slotBase(0) + 1] = 0;
  coincident.state[slotBase(0) + 2] = 0;
  coincident.state[slotBase(1)] = 0;
  coincident.state[slotBase(1) + 1] = 0;
  coincident.state[slotBase(1) + 2] = 0;
  coincident.step(DT);
  for (let index = 0; index < coincident.state.length; index += 1) {
    expect(Number.isFinite(coincident.state[index])).toBe(true);
  }

  const control = createSumoSimulation();
  control.startMatch([0, 1]);
  reachActive(control);
  placeHeadOn(control);
  control.step(DT);

  const damp = Math.exp(-4.2 * DT);
  const approach = 100 * damp;
  const impulse = 1.85 * approach;
  expect(control.state[slotBase(0) + 2] + control.state[slotBase(1) + 2]).toBeCloseTo(0, 3);
  expect(control.state[slotBase(0) + 2]).toBeCloseTo(approach - impulse, 3);
  expect(control.state[slotBase(1) + 2]).toBeCloseTo(-approach + impulse, 3);

  const ram = createSumoSimulation();
  ram.startMatch([0, 1]);
  reachActive(ram);
  placeHeadOn(ram);
  ram.state[slotBase(0) + 6] = 0.18;
  ram.step(DT);

  const victimDelta = ram.state[slotBase(1) + 2] - (-approach);
  const controlVictimDelta = control.state[slotBase(1) + 2] - (-approach);
  expect(victimDelta).toBeCloseTo(controlVictimDelta * 1.75, 3);
  expect(ram.state[slotBase(0) + 2]).toBeCloseTo(control.state[slotBase(0) + 2], 3);
  expect(ram.state[slotBase(1) + 7]).toBeCloseTo(0.22, 3);
});

test('ring-out stays dead when more input arrives', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1, 2]);
  reachActive(sim);
  const radius = sim.state[ARENA_RADIUS];
  const eliminated = slotBase(2);
  sim.state[eliminated] = radius + 5;
  sim.state[eliminated + 1] = 0;
  sim.step(DT);

  expect(sim.state[PHASE]).toBe(1);
  expect(sim.state[eliminated + 8] & 1).toBe(0);
  sim.applyInput(2, 1, 127, 127);
  sim.step(DT);
  expect(sim.state[eliminated + 8] & 1).toBe(0);
});

test('countdown aim does not move the puck or start a dash', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1]);
  reachCountdown(sim);
  expect(sim.state[PHASE]).toBe(0);
  const base = slotBase(0);
  const x = sim.state[base];
  const y = sim.state[base + 1];
  const vx = sim.state[base + 2];
  const vy = sim.state[base + 3];
  const angle = sim.state[base + 4];

  sim.applyInput(0, 1, 127, 0);

  expect(sim.state[base]).toBe(x);
  expect(sim.state[base + 1]).toBe(y);
  expect(sim.state[base + 2]).toBe(vx);
  expect(sim.state[base + 3]).toBe(vy);
  expect(sim.state[base + 5]).toBe(0);
  expect(sim.state[base + 6]).toBe(0);
  expect(sim.state[base + 4]).not.toBe(angle);
  expect(sim.state[base + 4]).toBeCloseTo(0, 5);

  sim.step(DT);
  expect(sim.state[PHASE]).toBe(0);
  expect(sim.state[base + 2]).toBe(0);
  expect(sim.state[base + 3]).toBe(0);
  expect(sim.state[base + 6]).toBe(0);
});

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

test('fuzz holds the sim invariants for 10000 steps', () => {
  const sim = createSumoSimulation();
  const state = sim.state;
  sim.startMatch([0, 1, 2, 3, 4, 5, 6, 7]);
  const rand = mulberry32(0x51f0d);
  const dead = [false, false, false, false, false, false, false, false];
  let completed = 0;
  let score = scoreSum(sim);
  let previousPhase = state[PHASE];
  let trackingRadius = false;
  let previousRadius = state[ARENA_RADIUS];

  for (let step = 0; step < 10000; step += 1) {
    for (let slot = 0; slot < 8; slot += 1) {
      const axisX = ((rand() * 255) | 0) - 127;
      const axisY = ((rand() * 255) | 0) - 127;
      const buttons = (rand() * 256) | 0;
      sim.applyInput(slot, buttons, axisX, axisY);
    }
    sim.step(DT);
    expect(sim.state).toBe(state);

    for (let index = 0; index < state.length; index += 1) {
      expect(Number.isFinite(state[index]), `index ${index} step ${step}`).toBe(true);
    }

    const phase = state[PHASE];
    const radius = state[ARENA_RADIUS];
    expect(radius).toBeGreaterThanOrEqual(RFLOOR);
    expect(radius).toBeLessThanOrEqual(400);
    if (phase === 1) {
      if (!trackingRadius) {
        trackingRadius = true;
        previousRadius = radius;
      }
      expect(radius).toBeLessThanOrEqual(previousRadius);
      previousRadius = radius;
    } else {
      trackingRadius = false;
    }

    for (let slot = 0; slot < 8; slot += 1) {
      const base = slotBase(slot);
      expect(state[base + 5]).toBeGreaterThanOrEqual(0);
      expect(state[base + 5]).toBeLessThanOrEqual(1.5);
      expect(state[base + 6]).toBeGreaterThanOrEqual(0);
      expect(state[base + 6]).toBeLessThanOrEqual(Math.fround(0.18));
      expect(state[base + 7]).toBeGreaterThanOrEqual(0);
      expect(state[base + 7]).toBeLessThanOrEqual(Math.fround(0.22));
      expect(state[base + 8] & 4).toBe(0);
      const alive = (state[base + 8] & 1) !== 0;
      if (phase === 1 || phase === 2) {
        if (dead[slot]) {
          expect(alive).toBe(false);
        }
        if (!alive) {
          dead[slot] = true;
        }
      }
    }
    if (phase === 0 || phase === 4) {
      for (let slot = 0; slot < 8; slot += 1) dead[slot] = false;
    }

    if (previousPhase === 1 && phase === 2) {
      completed += 1;
      const nextScore = scoreSum(sim);
      if (countAlive(sim) === 0) {
        expect(nextScore).toBe(score);
      } else {
        expect(nextScore).toBe(score + 1);
      }
      score = nextScore;
    }
    expect(scoreSum(sim)).toBeLessThanOrEqual(completed);
    previousPhase = phase;
  }
});

test('the same input log replays to the same float bytes', () => {
  const frames = 30 * 120;
  const rand = mulberry32(0xc0ffee);
  const log: Array<{ buttons: number; axisX: number; axisY: number }> = [];
  for (let frame = 0; frame < frames; frame += 1) {
    for (let slot = 0; slot < 8; slot += 1) {
      log.push({
        buttons: (rand() * 256) | 0,
        axisX: ((rand() * 255) | 0) - 127,
        axisY: ((rand() * 255) | 0) - 127,
      });
    }
  }

  function run(): Uint8Array {
    const sim = createSumoSimulation();
    sim.startMatch([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let frame = 0; frame < frames; frame += 1) {
      for (let slot = 0; slot < 8; slot += 1) {
        const sample = log[frame * 8 + slot];
        sim.applyInput(slot, sample.buttons, sample.axisX, sample.axisY);
      }
      sim.step(DT);
    }
    const bytes = new Uint8Array(sim.state.byteLength);
    bytes.set(new Uint8Array(sim.state.buffer, sim.state.byteOffset, sim.state.byteLength));
    return bytes;
  }

  expect(Buffer.compare(run(), run())).toBe(0);
});

test('practice lets a puck move and dash, then countdown puts it back on the spawn ring', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1]);
  expect(sim.state[PHASE]).toBe(4);
  const base = slotBase(0);
  const spawnX = sim.state[base] ?? 0;
  const spawnY = sim.state[base + 1] ?? 0;

  for (let n = 0; n < 40; n += 1) {
    sim.applyInput(0, 1, 127, 0);
    sim.step(DT);
  }

  expect(sim.state[PHASE]).toBe(4);
  expect(Math.hypot((sim.state[base] ?? 0) - spawnX, (sim.state[base + 1] ?? 0) - spawnY)).toBeGreaterThan(5);
  expect(sim.state[base + 5] ?? 0).toBeGreaterThan(0);
  expect(sim.state[slotBase(0) + 9]).toBe(0);

  reachCountdown(sim);
  expect(sim.state[base]).toBeCloseTo(spawnX, 4);
  expect(sim.state[base + 1]).toBeCloseTo(spawnY, 4);
  expect(sim.state[base + 2]).toBe(0);
  expect(sim.state[base + 3]).toBe(0);
});

test('three round wins end the match and the scoreboard follows the scores', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1]);
  const loser = slotBase(1);
  for (let round = 0; round < 3; round += 1) {
    reachActive(sim);
    const radius = sim.state[ARENA_RADIUS] ?? 0;
    sim.state[loser] = radius + 5;
    sim.state[loser + 1] = 0;
    sim.step(DT);
    expect(sim.state[PHASE]).toBe(2);
    expect(sim.state[slotBase(0) + 9]).toBe(round + 1);
    expect(scoreboardLine(sim.state, ['Hudson', 'Ada'], 3)).toBe(`hu ${round + 1}/3  ad 0/3`);
  }
  let guard = 0;
  while (sim.state[PHASE] !== 3 && guard < 4000) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(3);
  expect(sim.state[slotBase(0) + 9]).toBe(3);
});

test('a pack that stays inside still ends the round and scores', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1, 2]);
  reachActive(sim);
  let guard = 0;
  while (sim.state[PHASE] === 1 && guard < 8000) {
    const radius = sim.state[ARENA_RADIUS] ?? 0;
    const keep = Math.min(radius * 0.45, 80);
    for (const slot of [0, 1, 2]) {
      const base = slotBase(slot);
      if ((sim.state[base + 8] & 1) === 0) continue;
      const angle = (slot / 3) * Math.PI * 2;
      sim.state[base] = Math.cos(angle) * keep;
      sim.state[base + 1] = Math.sin(angle) * keep;
      sim.state[base + 2] = 0;
      sim.state[base + 3] = 0;
    }
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(2);
  expect(scoreSum(sim)).toBe(1);
  const line = scoreboardLine(sim.state, ['Hudson', '', ''], 3);
  expect(line.includes('1/3')).toBe(true);
});
