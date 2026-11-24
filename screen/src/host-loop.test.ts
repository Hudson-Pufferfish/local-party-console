import { expect, test } from 'vitest';
import { createSumoSimulation } from '../../games/sumo-dash/src/simulation.ts';
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
  expect(sim.state[12]).toBeCloseTo(Math.PI / 2);
});
