import { expect, test } from 'vitest';
import {
  AUX_LAYOUT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_HEADER,
  CYBER_PHASE,
  ENEMY_TYPE,
} from './constants.ts';
import {
  bleedOutDurationForWeight,
  bossHpMultiplier,
  computeSquadWeight,
  isSoloWeight,
  respawnDurationForWeight,
  waveCountMultiplier,
  waveHpMultiplier,
} from './scaling.ts';
import { createCyberCitadelSimulation } from './simulation.ts';
import { createAuxView, readMetaTrailer } from './state.ts';
import { getWaveDefinition } from './waves.ts';

test('weighted squad scaling computes exact W, multipliers, and solo timers', () => {
  // 1 Human (Solo)
  const w1 = computeSquadWeight(1, []);
  expect(w1).toBeCloseTo(1.0, 5);
  expect(waveCountMultiplier(w1)).toBeCloseTo(0.8, 5);
  expect(waveHpMultiplier(w1)).toBeCloseTo(1.1, 5);
  expect(bossHpMultiplier(w1)).toBeCloseTo(1.0, 5);
  expect(isSoloWeight(w1)).toBe(true);
  expect(bleedOutDurationForWeight(w1)).toBe(5.0);
  expect(respawnDurationForWeight(w1)).toBe(4.0);

  // 1 Human + 1 Easy Bot (level 15) -> 1 + 0.15 + 15/500 = 1.18
  const w1h1b = computeSquadWeight(1, [15]);
  expect(w1h1b).toBeCloseTo(1.18, 5);
  expect(isSoloWeight(w1h1b)).toBe(true);
  expect(bleedOutDurationForWeight(w1h1b)).toBe(5.0);
  expect(respawnDurationForWeight(w1h1b)).toBe(4.0);

  // 1 Human + 6 Hard Bots (level 65) -> 1 + 6 * (0.15 + 65/500) = 1 + 6 * 0.28 = 2.68
  const w1h6b = computeSquadWeight(1, [65, 65, 65, 65, 65, 65]);
  expect(w1h6b).toBeCloseTo(2.68, 5);
  expect(waveCountMultiplier(w1h6b)).toBeCloseTo(1.136, 3);
  expect(waveHpMultiplier(w1h6b)).toBeCloseTo(1.268, 3);

  // 4 Humans
  const w4 = computeSquadWeight(4, []);
  expect(w4).toBeCloseTo(4.0, 5);
  expect(waveCountMultiplier(w4)).toBeCloseTo(1.4, 5);
  expect(waveHpMultiplier(w4)).toBeCloseTo(1.4, 5);
  expect(bossHpMultiplier(w4)).toBeCloseTo(2.05, 5);

  // 8 Humans
  const w8 = computeSquadWeight(8, []);
  expect(w8).toBeCloseTo(8.0, 5);
  expect(waveCountMultiplier(w8)).toBeCloseTo(2.2, 5);
  expect(waveHpMultiplier(w8)).toBeCloseTo(1.8, 5);
  expect(bossHpMultiplier(w8)).toBeCloseTo(3.45, 5);
});

test('Wave 1-8 escalation tables match flank counts, 2.0s telegraph glow, and 160 enemy pool cap queuing', () => {
  expect(getWaveDefinition(1).flanks).toBe(1);
  expect(getWaveDefinition(2).flanks).toBe(2);
  expect(getWaveDefinition(3).flanks).toBe(2);
  expect(getWaveDefinition(4).flanks).toBe(3);
  expect(getWaveDefinition(5).flanks).toBe(3);
  expect(getWaveDefinition(6).flanks).toBe(4);
  expect(getWaveDefinition(7).flanks).toBe(4);
  expect(getWaveDefinition(8).flanks).toBe(4);
  expect(getWaveDefinition(8).hasBoss).toBe(true);

  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1, 2, 3], 12345);
  // Advance through 3.0s COUNTDOWN into Wave 1
  for (let i = 0; i < 362; i += 1) sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.WAVE_ACTIVE);
  expect(sim.state[CYBER_HEADER.wave]).toBe(1);

  // During 2.0s telegraph window, flankGlow0 climbs and zero enemies have spawned yet
  for (let i = 0; i < 120; i += 1) sim.step(C.dt);
  const view = createAuxView(sim.auxState);
  const metaMid = readMetaTrailer(view);
  expect(metaMid.flankGlow0).toBeGreaterThan(50);
  expect(sim.getDebugStats().activeEnemies).toBe(0);

  // Fill enemy pool to 160 hard cap and verify excess spawns queue without dropping or exceeding 160 (INV-3, FR-9.16)
  for (let i = 0; i < AUX_LAYOUT.MAX_ENEMIES; i += 1) {
    const id = sim.spawnEnemyForTest(ENEMY_TYPE.DRONE, -350 + (i % 16) * 40, -350 + Math.floor(i / 16) * 30);
    expect(id).toBeGreaterThanOrEqual(0);
  }
  expect(sim.spawnEnemyForTest(ENEMY_TYPE.DRONE, 0, -300)).toBe(-1);
  const queuedBefore = sim.getDebugStats().queuedEnemies;
  for (let i = 0; i < 240; i += 1) sim.step(C.dt);
  expect(sim.getDebugStats().activeEnemies).toBeLessThanOrEqual(AUX_LAYOUT.MAX_ENEMIES);
  expect(sim.getDebugStats().queuedEnemies).toBeGreaterThan(0);
  expect(sim.getDebugStats().queuedEnemies).toBeLessThanOrEqual(queuedBefore);
});
