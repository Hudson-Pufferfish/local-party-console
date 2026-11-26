import { expect, test } from 'vitest';
import { bannerCopy, matchWinnerTag } from './banner';
import { SUMO_CONSTANTS } from './constants';
import { eventsFromHeaderDiff } from './events';
import {
  activePlayerCount,
  hasUniqueWinner,
  isSuddenDeath,
  scoreboardHeader,
  scoreboardLine,
  scoreboardRows,
} from './scoreboard';
import { createSumoSimulation } from './simulation';

declare const Buffer: {
  compare(left: Uint8Array, right: Uint8Array): number;
};

const PHASE = 1;
const ARENA_RADIUS = 3;
const DT = 1 / 120;
const R0 = SUMO_CONSTANTS.r0;
const RFLOOR = SUMO_CONSTANTS.rFloor;
const DASH_COOLDOWN = SUMO_CONSTANTS.dashCooldown;
const DASH_ACTIVE = Math.fround(SUMO_CONSTANTS.dashActive);
const STUN_TIME = Math.fround(SUMO_CONSTANTS.stunTime);

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
    expect(sim.state[cooldown]).toBeLessThanOrEqual(DASH_COOLDOWN);
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
    expect(sim.state[cooldown]).toBeLessThanOrEqual(DASH_COOLDOWN);
    expect(now).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThanOrEqual(DASH_ACTIVE);
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
    expect(sim.state[cooldown]).toBeLessThanOrEqual(DASH_COOLDOWN);
    expect(now).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThanOrEqual(DASH_ACTIVE);
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

test('a same-tick wipe stays in the round and awards no score', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1]);
  reachActive(sim);
  const before = scoreSum(sim);
  const radius = sim.state[ARENA_RADIUS] ?? 0;
  sim.state[slotBase(0)] = radius + 40;
  sim.state[slotBase(0) + 1] = 0;
  sim.state[slotBase(0) + 2] = 500;
  sim.state[slotBase(1)] = -(radius + 40);
  sim.state[slotBase(1) + 1] = 0;
  sim.state[slotBase(1) + 2] = -500;
  sim.step(DT);

  expect(sim.state[PHASE]).toBe(1);
  expect(countAlive(sim)).toBe(2);
  expect(scoreSum(sim)).toBe(before);
  expect(Math.hypot(sim.state[slotBase(0)] ?? 0, sim.state[slotBase(0) + 1] ?? 0)).toBeLessThan(radius);
  expect(Math.hypot(sim.state[slotBase(1)] ?? 0, sim.state[slotBase(1) + 1] ?? 0)).toBeLessThan(radius);
  expect(sim.state[slotBase(0) + 2] ?? 0).toBeLessThanOrEqual(0);
  expect(sim.state[slotBase(1) + 2] ?? 0).toBeGreaterThanOrEqual(0);
});

test('everyone outside on a small ring does not open a scoreless break', () => {
  const timers = [0, 27, 33];
  for (const timer of timers) {
    const sim = createSumoSimulation();
    sim.startMatch([0, 1, 2]);
    reachActive(sim);
    sim.state[2] = timer;
    const before = scoreSum(sim);
    for (const slot of [0, 1, 2]) {
      const base = slotBase(slot);
      const angle = (slot / 3) * Math.PI * 2;
      sim.state[base] = Math.cos(angle) * 500;
      sim.state[base + 1] = Math.sin(angle) * 500;
      sim.state[base + 2] = Math.cos(angle) * 500;
      sim.state[base + 3] = Math.sin(angle) * 500;
    }
    let guard = 0;
    while (sim.state[PHASE] === 1 && guard < 30) {
      sim.step(DT);
      guard += 1;
    }
    if (sim.state[PHASE] === 2) {
      expect(scoreSum(sim)).toBe(before + 3);
    } else {
      expect(sim.state[PHASE]).toBe(1);
      expect(scoreSum(sim)).toBe(before);
      expect(countAlive(sim)).toBe(3);
    }
    expect(sim.state[PHASE]).not.toBe(4);
  }
});

test('a scored round opens the break in place, then countdown is the lineup', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1]);
  reachActive(sim);
  const winner = slotBase(0);
  const loser = slotBase(1);
  sim.state[winner] = 40;
  sim.state[winner + 1] = -25;
  sim.state[winner + 2] = 12;
  sim.state[winner + 3] = 0;
  const radius = sim.state[ARENA_RADIUS] ?? 0;
  sim.state[loser] = radius + 30;
  sim.state[loser + 1] = 0;
  sim.state[loser + 2] = 400;
  sim.step(DT);
  expect(sim.state[PHASE]).toBe(2);
  const heldX = sim.state[winner] ?? 0;
  const heldY = sim.state[winner + 1] ?? 0;
  const heldVx = sim.state[winner + 2] ?? 0;
  expect(Math.hypot(heldX, heldY)).toBeLessThan(80);
  let guard = 0;
  while (sim.state[PHASE] === 2 && guard < 200) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(4);
  expect(sim.state[winner]).toBeCloseTo(heldX, 3);
  expect(sim.state[winner + 1]).toBeCloseTo(heldY, 3);
  expect(sim.state[winner + 2]).toBeCloseTo(heldVx, 3);
  expect(sim.state[loser + 8] & 1).toBe(1);
  expect(Math.hypot(sim.state[loser] ?? 0, sim.state[loser + 1] ?? 0)).toBeLessThan(R0);
  expect(sim.state[loser + 2] ?? 0).toBeLessThanOrEqual(0);
  expect(sim.state[winner + 9]).toBe(1);
  expect(sim.state[loser + 9]).toBe(0);

  reachCountdown(sim);
  expect(sim.state[winner]).toBeCloseTo(SUMO_CONSTANTS.rSpawn, 3);
  expect(sim.state[winner + 1]).toBeCloseTo(0, 3);
  expect(sim.state[winner + 9]).toBe(1);
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
  ram.state[slotBase(0) + 6] = DASH_ACTIVE;
  ram.step(DT);

  const victimDelta = ram.state[slotBase(1) + 2] - (-approach);
  const controlVictimDelta = control.state[slotBase(1) + 2] - (-approach);
  expect(victimDelta).toBeCloseTo(controlVictimDelta * 1.75, 3);
  expect(ram.state[slotBase(0) + 2]).toBeCloseTo(control.state[slotBase(0) + 2], 3);
  expect(ram.state[slotBase(1) + 7]).toBeCloseTo(STUN_TIME, 3);
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

// Vitest expect() is too slow for about 150 checks per step over 10,000 steps (issue #16).
// The message names the step, so a failure still points at the exact frame.
function check(ok: boolean, what: string, step: number): void {
  if (!ok) throw new Error(`step ${step}: ${what}`);
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
    const wasSuddenDeath = isSuddenDeath(state);
    sim.step(DT);
    check(sim.state === state, 'sim.state is the same array', step);

    for (let index = 0; index < state.length; index += 1) {
      check(Number.isFinite(state[index]), `state[${index}] ${state[index]} is finite`, step);
    }

    const phase = state[PHASE];
    const radius = state[ARENA_RADIUS];
    check(radius >= RFLOOR && radius <= R0, `radius ${radius} in [${RFLOOR}, ${R0}]`, step);
    if (phase === 1) {
      if (!trackingRadius) {
        trackingRadius = true;
        previousRadius = radius;
      }
      check(radius <= previousRadius, `radius ${radius} <= previous ${previousRadius}`, step);
      previousRadius = radius;
    } else {
      trackingRadius = false;
    }

    for (let slot = 0; slot < 8; slot += 1) {
      const base = slotBase(slot);
      check(state[base + 5] >= 0 && state[base + 5] <= DASH_COOLDOWN, `slot ${slot} [5] ${state[base + 5]} in [0, ${DASH_COOLDOWN}]`, step);
      check(state[base + 6] >= 0 && state[base + 6] <= DASH_ACTIVE, `slot ${slot} [6] ${state[base + 6]} in [0, ${DASH_ACTIVE}]`, step);
      check(state[base + 7] >= 0 && state[base + 7] <= STUN_TIME, `slot ${slot} [7] ${state[base + 7]} in [0, ${STUN_TIME}]`, step);
      check((state[base + 8] & 4) === 0, `slot ${slot} flag bit 4 is clear`, step);
      const alive = (state[base + 8] & 1) !== 0;
      if (phase === 1 || phase === 2) {
        if (dead[slot]) {
          check(!alive, `slot ${slot} stays dead`, step);
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
      const gained = nextScore - score;
      if (countAlive(sim) === 0) {
        check(gained === 0, `gained ${gained} === 0 with no survivors`, step);
      } else if (wasSuddenDeath) {
        check(gained === 1, `gained ${gained} === 1 in sudden death`, step);
      } else {
        // 8 players: min sum without ties = 8*7/2 = 28, max with all losers tied 2nd = 7*7 = 49
        check(gained >= 28 && gained <= 49, `gained ${gained} in [28, 49]`, step);
      }
      score = nextScore;
    }
    check(scoreSum(sim) <= completed * 49, `score sum <= ${completed * 49}`, step);
    previousPhase = phase;
  }
}, 15_000);

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

test('practice keeps pucks inside r0 - puckRadius under full steer, dashes, and rim collisions', () => {
  const maxRadius = SUMO_CONSTANTS.r0 - SUMO_CONSTANTS.puckRadius;
  const sim = createSumoSimulation();
  sim.startMatch([0, 1]);
  expect(sim.state[PHASE]).toBe(4);

  const base0 = slotBase(0);
  const base1 = slotBase(1);
  let sawBounce = false;

  // Drive puck 0 straight east and puck 1 diagonally northwest with repeated dashes throughout practice.
  for (let tick = 0; tick < 600 && sim.state[PHASE] === 4; tick += 1) {
    const dashPulse = tick % 190 === 1 ? 1 : 0;
    sim.applyInput(0, dashPulse, 127, 0);
    sim.applyInput(1, dashPulse, -127, -127);
    const prevVx0 = sim.state[base0 + 2] ?? 0;
    sim.step(DT);

    const r0 = Math.hypot(sim.state[base0] ?? 0, sim.state[base0 + 1] ?? 0);
    const r1 = Math.hypot(sim.state[base1] ?? 0, sim.state[base1 + 1] ?? 0);
    expect(Number.isFinite(r0)).toBe(true);
    expect(Number.isFinite(r1)).toBe(true);
    expect(r0).toBeLessThanOrEqual(maxRadius);
    expect(r1).toBeLessThanOrEqual(maxRadius);
    if (prevVx0 > 100 && (sim.state[base0 + 2] ?? 0) < 0) {
      sawBounce = true;
    }
  }

  expect(sawBounce).toBe(true);

  // Also check rim collision between two pucks during practice does not push outer puck past maxRadius.
  sim.state[base0] = maxRadius - 2;
  sim.state[base0 + 1] = 0;
  sim.state[base0 + 2] = 0;
  sim.state[base0 + 3] = 0;
  sim.state[base1] = maxRadius - SUMO_CONSTANTS.puckRadius * 2 + 10;
  sim.state[base1 + 1] = 0;
  sim.state[base1 + 2] = 920;
  sim.state[base1 + 3] = 0;
  sim.state[base1 + 6] = DASH_ACTIVE;
  sim.step(DT);
  expect(Math.hypot(sim.state[base0] ?? 0, sim.state[base0 + 1] ?? 0)).toBeLessThanOrEqual(maxRadius);
  expect(Math.hypot(sim.state[base1] ?? 0, sim.state[base1 + 1] ?? 0)).toBeLessThanOrEqual(maxRadius);
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
    expect(scoreboardLine(sim.state, ['Hudson', 'Ada'])).toBe(`HUDSON ${round + 1}  ADA 0`);
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
  expect(scoreSum(sim)).toBe(3);
  expect(scoreboardHeader(sim.state)).toBe('THRESHOLD: 6');
  const line = scoreboardLine(sim.state, ['Hudson', '', '']);
  expect(line.includes(' 2')).toBe(true);
});

test('practice countdown lasts 20 seconds before entering 3-2-1 countdown', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1]);
  expect(sim.state[PHASE]).toBe(4);
  expect(sim.state[2]).toBeCloseTo(20, 5);

  for (let tick = 0; tick < 20 * 120 - 2; tick += 1) {
    sim.step(DT);
  }
  expect(sim.state[PHASE]).toBe(4);
  expect(sim.state[2]).toBeGreaterThan(0);

  for (let tick = 0; tick < 5 && sim.state[PHASE] === 4; tick += 1) {
    sim.step(DT);
  }
  expect(sim.state[PHASE]).toBe(0);
  expect(sim.state[2]).toBeCloseTo(3, 5);
});

test('ranked elimination awards N-1..0, ties share the higher rank, and match ends at (N-1)*3', () => {
  // 7-player tie case: 2 players fall on same tick for 6th & 7th -> BOTH get 6th place (+1 pt)
  const sim7 = createSumoSimulation();
  sim7.startMatch([0, 1, 2, 3, 4, 5, 6]);
  reachActive(sim7);
  const keepCenter = (sim: ReturnType<typeof createSumoSimulation>, slots: readonly number[]): void => {
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]!;
      const base = slotBase(slot);
      const angle = (i / Math.max(1, slots.length)) * Math.PI * 2;
      sim.state[base] = Math.cos(angle) * 60;
      sim.state[base + 1] = Math.sin(angle) * 60;
      sim.state[base + 2] = 0;
      sim.state[base + 3] = 0;
    }
  };
  const pushOut = (sim: ReturnType<typeof createSumoSimulation>, slots: readonly number[]): void => {
    const out = (sim.state[ARENA_RADIUS] ?? R0) + 50;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]!;
      const base = slotBase(slot);
      const angle = (i / Math.max(1, slots.length)) * Math.PI * 2;
      sim.state[base] = Math.cos(angle) * out;
      sim.state[base + 1] = Math.sin(angle) * out;
      sim.state[base + 2] = 0;
      sim.state[base + 3] = 0;
    }
  };

  // Tick 1: slots 5 and 6 fall together -> tie for 6th & 7th -> BOTH get 6th place = 7 - 6 = 1 pt
  keepCenter(sim7, [0, 1, 2, 3, 4]);
  pushOut(sim7, [5, 6]);
  sim7.step(DT);
  expect(sim7.state[PHASE]).toBe(1);

  // Tick 2: slot 4 falls -> 5th place = 2 pts
  keepCenter(sim7, [0, 1, 2, 3]);
  pushOut(sim7, [4]);
  sim7.step(DT);

  // Tick 3: slots 2 and 3 fall together -> tie for 3rd & 4th -> BOTH get 3rd place = 4 pts
  keepCenter(sim7, [0, 1]);
  pushOut(sim7, [2, 3]);
  sim7.step(DT);

  // Tick 4: slot 1 falls -> 2nd place = 5 pts; slot 0 survives -> 1st place = 6 pts
  keepCenter(sim7, [0]);
  pushOut(sim7, [1]);
  sim7.step(DT);

  expect(sim7.state[PHASE]).toBe(2);
  expect(sim7.state[slotBase(0) + 9]).toBe(6);
  expect(sim7.state[slotBase(1) + 9]).toBe(5);
  expect(sim7.state[slotBase(2) + 9]).toBe(4);
  expect(sim7.state[slotBase(3) + 9]).toBe(4);
  expect(sim7.state[slotBase(4) + 9]).toBe(2);
  expect(sim7.state[slotBase(5) + 9]).toBe(1);
  expect(sim7.state[slotBase(6) + 9]).toBe(1);

  // 4-player match ends at target = (4 - 1) * 3 = 9 (three 1st-place finishes of +3 each)
  const sim4 = createSumoSimulation();
  sim4.startMatch([0, 1, 2, 3]);
  for (let round = 0; round < 3; round += 1) {
    reachActive(sim4);
    keepCenter(sim4, [0, 1, 2]);
    pushOut(sim4, [3]);
    sim4.step(DT);
    keepCenter(sim4, [0, 1]);
    pushOut(sim4, [2]);
    sim4.step(DT);
    keepCenter(sim4, [0]);
    pushOut(sim4, [1]);
    const beforeEnd = sim4.state.slice();
    sim4.step(DT);
    expect(sim4.state[PHASE]).toBe(2);
    expect(sim4.state[slotBase(0) + 9]).toBe((round + 1) * 3);
    expect(sim4.state[slotBase(1) + 9]).toBe((round + 1) * 2);
    expect(sim4.state[slotBase(2) + 9]).toBe((round + 1) * 1);
    expect(sim4.state[slotBase(3) + 9]).toBe(0);
    const roundEndEvent = eventsFromHeaderDiff(beforeEnd, sim4.state).find(
      (event) => event.type === 'sumo:round_end',
    );
    expect(roundEndEvent?.payload).toEqual({
      winnerIndex: 0,
      scores: [(round + 1) * 3, (round + 1) * 2, (round + 1) * 1, 0, 0, 0, 0, 0],
      matchOver: round === 2,
    });
    // Advance past ROUND_END
    let guard = 0;
    while (sim4.state[PHASE] === 2 && guard < 200) {
      sim4.step(DT);
      guard += 1;
    }
    if (round < 2) {
      expect(sim4.state[PHASE]).toBe(4);
    } else {
      expect(sim4.state[PHASE]).toBe(3);
    }
  }
});

test('tied leaders at threshold trigger sudden death overtime until a sole leader emerges', () => {
  const names = ['Hudson', 'Ada', 'Max'];
  const sim = createSumoSimulation();
  sim.startMatch([0, 1, 2]);
  reachActive(sim);

  const keepCenter = (slots: readonly number[]): void => {
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]!;
      const base = slotBase(slot);
      const angle = (i / Math.max(1, slots.length)) * Math.PI * 2;
      sim.state[base] = Math.cos(angle) * 60;
      sim.state[base + 1] = Math.sin(angle) * 60;
      sim.state[base + 2] = 0;
      sim.state[base + 3] = 0;
    }
  };
  const pushOut = (slots: readonly number[]): void => {
    const out = (sim.state[ARENA_RADIUS] ?? R0) + 50;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]!;
      const base = slotBase(slot);
      const angle = (i / Math.max(1, slots.length)) * Math.PI * 2;
      sim.state[base] = Math.cos(angle) * out;
      sim.state[base + 1] = Math.sin(angle) * out;
      sim.state[base + 2] = 0;
      sim.state[base + 3] = 0;
    }
  };

  // Target for 3 players is 6; set Hudson and Ada to target - 1 (5 pts)
  sim.state[slotBase(0) + 9] = 5;
  sim.state[slotBase(1) + 9] = 5;
  sim.state[slotBase(2) + 9] = 0;

  // Eliminate Hudson and Ada on the same tick while Max survives -> both tie 2nd (+1 pt) and reach 6 pts
  keepCenter([2]);
  pushOut([0, 1]);
  const beforeTieEnd = sim.state.slice();
  sim.step(DT);

  expect(sim.state[PHASE]).toBe(2);
  expect(sim.state[slotBase(0) + 9]).toBe(6);
  expect(sim.state[slotBase(1) + 9]).toBe(6);
  expect(sim.state[slotBase(2) + 9]).toBe(2);
  expect(isSuddenDeath(sim.state)).toBe(true);
  expect(matchWinnerTag(sim.state, names)).toBeUndefined();
  expect(bannerCopy(sim.state[PHASE], sim.state[2], matchWinnerTag(sim.state, names), isSuddenDeath(sim.state))).toBe(
    'SUDDEN DEATH',
  );
  expect(scoreboardHeader(sim.state)).toBe('SUDDEN DEATH');
  expect(scoreboardRows(sim.state, names).map((row) => `${row.name} ${row.score}`)).toEqual(['HUDSON 6', 'ADA 6', 'MAX 2']);

  const tieEndEvent = eventsFromHeaderDiff(beforeTieEnd, sim.state).find(
    (event) => event.type === 'sumo:round_end',
  );
  expect(tieEndEvent?.payload).toEqual({
    winnerIndex: 2,
    scores: [6, 6, 2, 0, 0, 0, 0, 0],
    matchOver: false,
  });

  // Match must NOT transition to MATCH_OVER; returns to PRACTICE then COUNTDOWN with SUDDEN DEATH
  // Only tied leaders (Hudson & Ada) are revived; Max (2 pts, even though he won the previous round) stays eliminated off-screen
  let guard = 0;
  while (sim.state[PHASE] === 2 && guard < 200) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(4);
  expect(countAlive(sim)).toBe(2);
  expect(sim.state[slotBase(0) + 8] & 1).toBe(1);
  expect(sim.state[slotBase(1) + 8] & 1).toBe(1);
  expect(sim.state[slotBase(2) + 8] & 1).toBe(0);
  expect(Math.hypot(sim.state[slotBase(2)] ?? 0, sim.state[slotBase(2) + 1] ?? 0)).toBeGreaterThan(R0);
  expect(bannerCopy(sim.state[PHASE], sim.state[2], matchWinnerTag(sim.state, names), isSuddenDeath(sim.state))).toBe(
    'SUDDEN DEATH 20',
  );

  reachCountdown(sim);
  expect(countAlive(sim)).toBe(2);
  expect(sim.state[slotBase(0) + 8] & 1).toBe(1);
  expect(sim.state[slotBase(1) + 8] & 1).toBe(1);
  expect(sim.state[slotBase(2) + 8] & 1).toBe(0);
  expect(bannerCopy(sim.state[PHASE], sim.state[2], matchWinnerTag(sim.state, names), isSuddenDeath(sim.state))).toBe(
    'SUDDEN DEATH 3',
  );

  // Next round: contender-only duel; Hudson knocks out Ada for an immediate +1 match victory
  reachActive(sim);
  expect(countAlive(sim)).toBe(2);
  expect(sim.state[slotBase(2) + 8] & 1).toBe(0);
  keepCenter([0]);
  pushOut([1]);
  const beforeWinEnd = sim.state.slice();
  sim.step(DT);

  expect(sim.state[PHASE]).toBe(2);
  expect(sim.state[slotBase(0) + 9]).toBe(7);
  expect(sim.state[slotBase(1) + 9]).toBe(6);
  expect(sim.state[slotBase(2) + 9]).toBe(2);
  expect(isSuddenDeath(sim.state)).toBe(false);
  expect(hasUniqueWinner(sim.state)).toBe(true);
  expect(matchWinnerTag(sim.state, names)).toBe('HUDSON');
  expect(bannerCopy(sim.state[PHASE], sim.state[2], matchWinnerTag(sim.state, names), isSuddenDeath(sim.state))).toBe(
    'HUDSON WINS',
  );

  const winEndEvent = eventsFromHeaderDiff(beforeWinEnd, sim.state).find(
    (event) => event.type === 'sumo:round_end',
  );
  expect(winEndEvent?.payload).toEqual({
    winnerIndex: 0,
    scores: [7, 6, 2, 0, 0, 0, 0, 0],
    matchOver: true,
  });

  guard = 0;
  while (sim.state[PHASE] === 2 && guard < 200) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(3);
  expect(bannerCopy(sim.state[PHASE], sim.state[2], matchWinnerTag(sim.state, names), isSuddenDeath(sim.state))).toBe(
    'HUDSON WINS',
  );
});

test('3-way tie at threshold enters sudden death and ends only when one leader stands alone', () => {
  const names = ['Hudson', 'Ada', 'Max', 'Zoe'];
  const sim = createSumoSimulation();
  sim.startMatch([0, 1, 2, 3]); // target = (4 - 1) * 3 = 9
  reachActive(sim);

  const keepCenter = (slots: readonly number[]): void => {
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]!;
      const base = slotBase(slot);
      const angle = (i / Math.max(1, slots.length)) * Math.PI * 2;
      sim.state[base] = Math.cos(angle) * 60;
      sim.state[base + 1] = Math.sin(angle) * 60;
      sim.state[base + 2] = 0;
      sim.state[base + 3] = 0;
    }
  };
  const pushOut = (slots: readonly number[]): void => {
    const out = (sim.state[ARENA_RADIUS] ?? R0) + 50;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]!;
      const base = slotBase(slot);
      const angle = (i / Math.max(1, slots.length)) * Math.PI * 2;
      sim.state[base] = Math.cos(angle) * out;
      sim.state[base + 1] = Math.sin(angle) * out;
      sim.state[base + 2] = 0;
      sim.state[base + 3] = 0;
    }
  };

  // Setup: Hudson=6, Ada=7, Max=8, Zoe=0; round awards +3, +2, +1, +0 -> 3-way tie at 9 pts!
  sim.state[slotBase(0) + 9] = 6;
  sim.state[slotBase(1) + 9] = 7;
  sim.state[slotBase(2) + 9] = 8;
  sim.state[slotBase(3) + 9] = 0;

  keepCenter([0, 1, 2]);
  pushOut([3]); // Zoe 4th (+0)
  sim.step(DT);

  keepCenter([0, 1]);
  pushOut([2]); // Max 3rd (+1 -> 9)
  sim.step(DT);

  keepCenter([0]);
  pushOut([1]); // Ada 2nd (+2 -> 9), Hudson 1st (+3 -> 9)
  const beforeThreeWay = sim.state.slice();
  sim.step(DT);

  expect(sim.state[PHASE]).toBe(2);
  expect([0, 1, 2, 3].map((slot) => sim.state[slotBase(slot) + 9])).toEqual([9, 9, 9, 0]);
  expect(isSuddenDeath(sim.state)).toBe(true);
  expect(matchWinnerTag(sim.state, names)).toBeUndefined();
  expect(scoreboardHeader(sim.state)).toBe('SUDDEN DEATH');
  expect(bannerCopy(sim.state[PHASE], sim.state[2], matchWinnerTag(sim.state, names), isSuddenDeath(sim.state))).toBe(
    'SUDDEN DEATH',
  );
  expect(
    eventsFromHeaderDiff(beforeThreeWay, sim.state).find((event) => event.type === 'sumo:round_end')?.payload,
  ).toEqual({
    winnerIndex: 0,
    scores: [9, 9, 9, 0, 0, 0, 0, 0],
    matchOver: false,
  });

  // Must enter PRACTICE -> COUNTDOWN -> ROUND_ACTIVE with only the 3 tied contenders alive; Zoe (0 pts) stays out & on scoreboard
  let guard = 0;
  while (sim.state[PHASE] === 2 && guard < 200) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(4);
  expect(countAlive(sim)).toBe(3);
  expect(sim.state[slotBase(3) + 8] & 1).toBe(0);
  expect(activePlayerCount(sim.state)).toBe(4);
  expect(scoreboardRows(sim.state, names).map((row) => `${row.name} ${row.score}`)).toEqual(['HUDSON 9', 'ADA 9', 'MAX 9', 'ZOE 0']);

  reachCountdown(sim);
  expect(countAlive(sim)).toBe(3);
  expect(sim.state[slotBase(3) + 8] & 1).toBe(0);
  expect(activePlayerCount(sim.state)).toBe(4);

  reachActive(sim);
  expect(countAlive(sim)).toBe(3);
  expect(sim.state[slotBase(3) + 8] & 1).toBe(0);

  // Overtime round: only the 3 contenders fight; Max survives -> +1 pt (10), others unchanged
  keepCenter([1, 2]);
  pushOut([0]);
  sim.step(DT);
  expect(sim.state[PHASE]).toBe(1);

  keepCenter([2]);
  pushOut([1]);
  sim.step(DT);

  expect(sim.state[PHASE]).toBe(2);
  expect([0, 1, 2, 3].map((slot) => sim.state[slotBase(slot) + 9])).toEqual([9, 9, 10, 0]);
  expect(isSuddenDeath(sim.state)).toBe(false);
  expect(hasUniqueWinner(sim.state)).toBe(true);
  expect(matchWinnerTag(sim.state, names)).toBe('MAX');
  expect(scoreboardHeader(sim.state)).toBe('THRESHOLD: 9');
  expect(scoreboardRows(sim.state, names).map((row) => `${row.name} ${row.score}`)).toEqual(['HUDSON 9', 'ADA 9', 'MAX 10', 'ZOE 0']);

  guard = 0;
  while (sim.state[PHASE] === 2 && guard < 200) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(3);
  expect(bannerCopy(sim.state[PHASE], sim.state[2], matchWinnerTag(sim.state, names), isSuddenDeath(sim.state))).toBe(
    'MAX WINS',
  );
});

test('sudden death excludes trailing players, repeats on simultaneous wipe, and ends decisively on sole survivor', () => {
  const names = ['Hudson', 'Ada', 'Max', 'Zoe'];
  const sim = createSumoSimulation();
  sim.startMatch([0, 1, 2, 3]); // target = 9
  reachActive(sim);

  // Tie P1 and P2 at 12 pts while P3=8 and P4=4 trail far behind
  sim.state[slotBase(0) + 9] = 12;
  sim.state[slotBase(1) + 9] = 12;
  sim.state[slotBase(2) + 9] = 8;
  sim.state[slotBase(3) + 9] = 4;

  // Force a zero-survivor round end while tied to trigger sudden death break directly
  sim.state[slotBase(0) + 8] = 0;
  sim.state[slotBase(1) + 8] = 0;
  sim.state[slotBase(2) + 8] = 0;
  sim.state[slotBase(3) + 8] = 0;
  sim.step(DT);
  expect(sim.state[PHASE]).toBe(2);

  // Advance past ROUND_END into Sudden Death PRACTICE
  let guard = 0;
  while (sim.state[PHASE] === 2 && guard < 200) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(4);
  expect(countAlive(sim)).toBe(2);
  expect(sim.state[slotBase(0) + 8] & 1).toBe(1);
  expect(sim.state[slotBase(1) + 8] & 1).toBe(1);
  expect(sim.state[slotBase(2) + 8] & 1).toBe(0);
  expect(sim.state[slotBase(3) + 8] & 1).toBe(0);
  expect(Math.hypot(sim.state[slotBase(2)] ?? 0, sim.state[slotBase(2) + 1] ?? 0)).toBeGreaterThan(R0);
  expect(Math.hypot(sim.state[slotBase(3)] ?? 0, sim.state[slotBase(3) + 1] ?? 0)).toBeGreaterThan(R0);

  // Trailing player inputs during PRACTICE and COUNTDOWN must not revive or move them
  const p4X = sim.state[slotBase(3)] ?? 0;
  sim.applyInput(3, 1, 127, 0);
  sim.step(DT);
  expect(sim.state[slotBase(3) + 8] & 1).toBe(0);
  expect(sim.state[slotBase(3)]).toBe(p4X);

  reachCountdown(sim);
  expect(countAlive(sim)).toBe(2);
  expect(sim.state[slotBase(2) + 8] & 1).toBe(0);
  expect(sim.state[slotBase(3) + 8] & 1).toBe(0);
  const p4CountdownAngle = sim.state[slotBase(3) + 4] ?? 0;
  sim.applyInput(3, 1, 127, 64);
  sim.step(DT);
  expect(sim.state[slotBase(3) + 8] & 1).toBe(0);
  expect(sim.state[slotBase(3) + 4]).toBe(p4CountdownAngle);

  // Enter Sudden Death ROUND_ACTIVE: only P1 & P2 participate
  reachActive(sim);
  expect(countAlive(sim)).toBe(2);
  expect(sim.state[slotBase(0) + 8] & 1).toBe(1);
  expect(sim.state[slotBase(1) + 8] & 1).toBe(1);
  expect(sim.state[slotBase(2) + 8] & 1).toBe(0);
  expect(sim.state[slotBase(3) + 8] & 1).toBe(0);

  // Simultaneous ring-out of both contenders above rMin keeps them tied and active without awarding points
  const radius = sim.state[ARENA_RADIUS] ?? R0;
  sim.state[slotBase(0)] = radius + 40;
  sim.state[slotBase(0) + 1] = 0;
  sim.state[slotBase(1)] = -(radius + 40);
  sim.state[slotBase(1) + 1] = 0;
  sim.step(DT);
  expect(sim.state[PHASE]).toBe(1);
  expect(countAlive(sim)).toBe(2);
  expect([0, 1, 2, 3].map((slot) => sim.state[slotBase(slot) + 9])).toEqual([12, 12, 8, 4]);

  // Decisive elimination: P2 rings out while P1 survives -> P1 gets +1 (13) and wins immediately
  sim.state[slotBase(0)] = 0;
  sim.state[slotBase(0) + 1] = 0;
  sim.state[slotBase(0) + 2] = 0;
  sim.state[slotBase(0) + 3] = 0;
  sim.state[slotBase(1)] = radius + 50;
  sim.state[slotBase(1) + 1] = 0;
  const beforeDecisive = sim.state.slice();
  sim.step(DT);

  expect(sim.state[PHASE]).toBe(2);
  expect([0, 1, 2, 3].map((slot) => sim.state[slotBase(slot) + 9])).toEqual([13, 12, 8, 4]);
  expect(hasUniqueWinner(sim.state)).toBe(true);
  expect(isSuddenDeath(sim.state)).toBe(false);
  expect(scoreboardRows(sim.state, names).map((row) => `${row.name} ${row.score}`)).toEqual(['HUDSON 13', 'ADA 12', 'MAX 8', 'ZOE 4']);
  expect(
    eventsFromHeaderDiff(beforeDecisive, sim.state).find((event) => event.type === 'sumo:round_end')?.payload,
  ).toEqual({
    winnerIndex: 0,
    scores: [13, 12, 8, 4, 0, 0, 0, 0],
    matchOver: true,
  });

  guard = 0;
  while (sim.state[PHASE] === 2 && guard < 200) {
    sim.step(DT);
    guard += 1;
  }
  expect(sim.state[PHASE]).toBe(3);
  expect(matchWinnerTag(sim.state, names)).toBe('HUDSON');
  expect(bannerCopy(sim.state[PHASE], sim.state[2], matchWinnerTag(sim.state, names), isSuddenDeath(sim.state))).toBe(
    'HUDSON WINS',
  );
});
