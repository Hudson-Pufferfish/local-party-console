import { expect, test } from 'vitest';
import { writeHeuristic } from '../../games/sumo-dash/src/heuristic.ts';
import { createSumoSimulation } from '../../games/sumo-dash/src/simulation.ts';
import { createBotFill } from './bot-fill.ts';
import { createHostLoop, type ScreenSim } from './host-loop.ts';

test('a human slot still receives applyInput when a bot fills another slot', () => {
  const sim = createSumoSimulation();
  const applied: number[] = [];
  const wrapped: ScreenSim = {
    get state() {
      return sim.state;
    },
    applyInput(playerIndex, buttons, axisX, axisY) {
      applied.push(playerIndex);
      sim.applyInput(playerIndex, buttons, axisX, axisY);
    },
    step(dt) {
      sim.step(dt);
    },
    startMatch(slots) {
      sim.startMatch(slots);
    },
  };
  const loop = createHostLoop(wrapped, undefined, () => {}, (slot) => slot === 1);
  loop.startMatch([0, 1]);
  expect(loop.accept(0, 1, 0, 0, 127, 1000)).toBe(true);
  loop.tick(20, 1010);
  expect(applied).toContain(0);
  expect(applied).not.toContain(1);
  expect(Math.hypot(sim.state[10] ?? 0, sim.state[11] ?? 0)).toBeGreaterThan(0);
});

test('a held stick moves a human while bots fill the other slots', () => {
  const sim = createSumoSimulation();
  const mask = new Uint8Array([0, 0, 1, 1, 0, 0, 0, 0]);
  const fill = createBotFill(writeHeuristic, () => Uint8Array.from([0, 0, 2, 5, 0, 0, 0, 0]));
  fill.arm(mask);
  const loop = createHostLoop(sim, undefined, () => {}, (slot, current) => fill.fill(slot, current));
  loop.startMatch([0, 1, 2, 3]);
  let now = 0;
  for (let step = 0; step < 400; step += 1) {
    now += 16;
    loop.accept(0, step + 1, 0, 127, 0, now);
    loop.tick(16, now);
  }
  const moved = Math.hypot((sim.state[8] ?? 0) - 240, sim.state[9] ?? 0);
  expect(moved).toBeGreaterThan(40);
});

test('two bots do not stay locked together for the whole round', () => {
  const sim = createSumoSimulation();
  const mask = new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0]);
  const fill = createBotFill(writeHeuristic, () => Uint8Array.from([2, 5, 0, 0, 0, 0, 0, 0]));
  fill.arm(mask);
  const loop = createHostLoop(sim, undefined, () => {}, (slot, current) => fill.fill(slot, current));
  loop.startMatch([0, 1]);
  let now = 0;
  for (let step = 0; step < 7500; step += 1) {
    now += 16;
    loop.tick(16, now);
  }
  const weak = sim.state[17] ?? 0;
  const strong = sim.state[27] ?? 0;
  expect(weak + strong).toBeGreaterThan(0);
  expect(strong).toBeGreaterThan(weak);
});
