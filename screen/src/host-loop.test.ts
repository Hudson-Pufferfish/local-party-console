import { expect, test } from 'vitest';
import { levelsForMask, writeHeuristic } from '../../games/sumo-dash/src/heuristic.ts';
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
  const fill = createBotFill(writeHeuristic, () => Uint8Array.from([0, 0, 25, 65, 0, 0, 0, 0]));
  fill.arm(mask, 'medium');
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
  const fill = createBotFill(writeHeuristic, () => Uint8Array.from([25, 65, 0, 0, 0, 0, 0, 0]));
  fill.arm(mask, 'hard');
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

test('bot fill passes difficulty through levelsForMask into the host loop', () => {
  const sim = createSumoSimulation();
  const mask = new Uint8Array([0, 1, 1, 0, 0, 0, 0, 0]);
  const capturedLevels: number[] = [];
  const fill = createBotFill(
    (state, botIndex, axisX, axisY, buttons, level) => {
      if (level !== undefined && capturedLevels.length < 2) capturedLevels.push(level);
      writeHeuristic(state, botIndex, axisX, axisY, buttons, level);
    },
    (botMask, difficulty) => levelsForMask(botMask, difficulty),
  );
  fill.arm(mask, 'hard');
  const loop = createHostLoop(sim, undefined, () => {}, (slot, current) => fill.fill(slot, current));
  loop.startMatch([0, 1, 2]);
  loop.tick(16, 16);
  expect(capturedLevels).toHaveLength(2);
  expect(capturedLevels[0]).not.toBe(capturedLevels[1]);
  for (const score of capturedLevels) {
    expect(score).toBeGreaterThanOrEqual(50);
    expect(score).toBeLessThanOrEqual(70);
  }
});

test('HostLoop forwards setConnectedMask to ScreenSim when implemented and is a safe no-op otherwise', () => {
  const masks: number[] = [];
  const simWithMask: ScreenSim = {
    state: new Float32Array(88),
    applyInput() {},
    step() {},
    startMatch() {},
    setConnectedMask(mask: number) {
      masks.push(mask);
    },
  };
  const loopWithMask = createHostLoop(simWithMask, undefined, () => {});
  loopWithMask.setConnectedMask(0b0000_0101);
  expect(masks).toEqual([0b0000_0101]);

  const sumoLoop = createHostLoop(createSumoSimulation(), undefined, () => {});
  expect(() => sumoLoop.setConnectedMask(0b0000_0011)).not.toThrow();
});
