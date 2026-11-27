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
  waveCadenceMultiplier,
  waveCountMultiplier,
  waveHpMultiplier,
} from './scaling.ts';
import { createCyberCitadelSimulation } from './simulation.ts';
import { createAuxView, readEnemy, readMetaTrailer } from './state.ts';
import { createCyberWorld, SPAWN_QUEUE_CAP } from './world.ts';
import { getWaveDefinition, populateWaveSpawns } from './waves.ts';

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

  // 1 Human + 1 Easy Bot (level 15) -> 1 + 0.4 + 15/100 = 1.55 (no longer solo weight)
  const w1h1b = computeSquadWeight(1, [15]);
  expect(w1h1b).toBeCloseTo(1.55, 5);
  expect(isSoloWeight(w1h1b)).toBe(false);
  expect(bleedOutDurationForWeight(w1h1b)).toBe(15.0);
  expect(respawnDurationForWeight(w1h1b)).toBe(8.0);

  // 1 Human + 1 Medium Bot (level 40) -> 1 + 0.4 + 40/100 = 1.80
  const w1h1m = computeSquadWeight(1, [40]);
  expect(w1h1m).toBeCloseTo(1.8, 5);

  // 1 Human + 6 Hard Bots (level 65) -> 1 + 6 * (0.4 + 65/100) = 1 + 6 * 1.05 = 7.30
  const w1h6b = computeSquadWeight(1, [65, 65, 65, 65, 65, 65]);
  expect(w1h6b).toBeCloseTo(7.3, 5);
  expect(waveCountMultiplier(w1h6b)).toBeCloseTo(2.06, 3);
  expect(waveHpMultiplier(w1h6b)).toBeCloseTo(1.73, 3);
  expect(bossHpMultiplier(w1h6b)).toBeCloseTo(2.764, 3);

  // 4 Humans
  const w4 = computeSquadWeight(4, []);
  expect(w4).toBeCloseTo(4.0, 5);
  expect(waveCountMultiplier(w4)).toBeCloseTo(1.4, 5);
  expect(waveHpMultiplier(w4)).toBeCloseTo(1.4, 5);
  expect(bossHpMultiplier(w4)).toBeCloseTo(1.84, 5);

  // 8 Humans
  const w8 = computeSquadWeight(8, []);
  expect(w8).toBeCloseTo(8.0, 5);
  expect(waveCountMultiplier(w8)).toBeCloseTo(2.2, 5);
  expect(waveHpMultiplier(w8)).toBeCloseTo(1.8, 5);
  expect(bossHpMultiplier(w8)).toBeCloseTo(2.96, 5);
});

test('Wave 1-8 escalation tables match flank counts, tuned cadences, boss flags, 2.0s telegraph glow, and 160 enemy pool cap queuing', () => {
  expect(getWaveDefinition(1).flanks).toBe(1);
  expect(getWaveDefinition(2).flanks).toBe(2);
  expect(getWaveDefinition(3).flanks).toBe(2);
  expect(getWaveDefinition(4).flanks).toBe(3);
  expect(getWaveDefinition(5).flanks).toBe(3);
  expect(getWaveDefinition(6).flanks).toBe(4);
  expect(getWaveDefinition(7).flanks).toBe(4);
  expect(getWaveDefinition(8).flanks).toBe(4);

  expect(getWaveDefinition(1).spawnCadenceSec).toBe(0.45);
  expect(getWaveDefinition(2).spawnCadenceSec).toBe(0.4);
  expect(getWaveDefinition(3).spawnCadenceSec).toBe(0.35);
  expect(getWaveDefinition(4).spawnCadenceSec).toBe(0.3);
  expect(getWaveDefinition(5).spawnCadenceSec).toBe(0.29);
  expect(getWaveDefinition(6).spawnCadenceSec).toBe(0.28);
  expect(getWaveDefinition(7).spawnCadenceSec).toBe(0.28);
  expect(getWaveDefinition(8).spawnCadenceSec).toBe(0.9);

  for (let w = 1; w <= 6; w += 1) {
    expect(getWaveDefinition(w).hasBoss).toBe(false);
  }
  expect(getWaveDefinition(7).hasBoss).toBe(true);
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

test('waveCadenceMultiplier uses four squad-weight bands', () => {
  expect(waveCadenceMultiplier(1.0)).toBe(1.8);
  expect(waveCadenceMultiplier(1.99)).toBe(1.8);
  expect(waveCadenceMultiplier(2.0)).toBe(1.5);
  expect(waveCadenceMultiplier(3.99)).toBe(1.5);
  expect(waveCadenceMultiplier(4.0)).toBe(1.25);
  expect(waveCadenceMultiplier(5.99)).toBe(1.25);
  expect(waveCadenceMultiplier(6.0)).toBe(1.0);
  expect(waveCadenceMultiplier(8.0)).toBe(1.0);
});

test('Wave 7 spawns gatekeeper Boss at flank 0 alongside final minions while Wave 8 spawns Boss at wave start', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0], 7777);
  sim.jumpToWave(7);
  const view = createAuxView(sim.auxState);

  const def7 = getWaveDefinition(7);
  const squadWeight = sim.getSquadWeight();
  expect(squadWeight).toBeCloseTo(1.0, 5);
  const cadence = def7.spawnCadenceSec * waveCadenceMultiplier(squadWeight);
  expect(cadence).toBeCloseTo(0.28 * 1.8, 5);
  const mult = waveCountMultiplier(squadWeight);
  const expectedMinions =
    Math.max(1, Math.round(def7.drones * mult)) +
    Math.max(1, Math.round(def7.fastDrones * mult)) +
    Math.max(1, Math.round(def7.brutes * mult));
  expect(sim.getDebugStats().queuedEnemies).toBe(expectedMinions + 1);

  const findActiveBoss = () => {
    for (let i = 0; i < AUX_LAYOUT.MAX_ENEMIES; i += 1) {
      const e = readEnemy(view, i);
      if (e.hpPct > 0 && e.type === ENEMY_TYPE.BOSS) return e;
    }
    return null;
  };

  // Right after 2.0s telegraph: minions begin spawning, but Wave 7 Boss has NOT spawned yet
  for (let i = 0; i < 252; i += 1) sim.step(C.dt);
  expect(sim.getDebugStats().activeEnemies).toBeGreaterThan(0);
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(0);
  expect(findActiveBoss()).toBeNull();

  // Advance until ~80% through minion spawns: boss has not spawned yet
  const thresholdMinions = Math.max(1, Math.round(expectedMinions * 0.88));
  const beforeBossDelay = C.flankTelegraphSec + Math.max(0, thresholdMinions - 2) * cadence;
  const ticksAlreadyRun = 252;
  const ticksBeforeBoss = Math.floor(beforeBossDelay / C.dt);
  for (let i = ticksAlreadyRun; i < ticksBeforeBoss; i += 1) {
    if (i % 60 === 0) sim.state[CYBER_HEADER.coreHp] = C.coreMaxHp;
    sim.step(C.dt);
  }
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(0);
  expect(findActiveBoss()).toBeNull();

  // Advance through 88% threshold: gatekeeper Boss spawns at flank 0 alongside final minions
  const atBossDelay = C.flankTelegraphSec + (thresholdMinions + 1) * cadence;
  const ticksAtBoss = Math.ceil((atBossDelay + 0.1) / C.dt);
  for (let i = ticksBeforeBoss; i < ticksAtBoss; i += 1) {
    if (i % 60 === 0) sim.state[CYBER_HEADER.coreHp] = C.coreMaxHp;
    sim.step(C.dt);
  }
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(1);
  const w7Boss = findActiveBoss();
  expect(w7Boss).not.toBeNull();
  expect(w7Boss!.y).toBeLessThan(-320);
  expect(sim.getDebugStats().queuedEnemies).toBeGreaterThan(0);

  // Wave 8 keeps Boss spawn at the beginning (delay = C.flankTelegraphSec) before minion trickle
  sim.jumpToWave(8);
  for (let i = 0; i < 252; i += 1) sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(1);
  expect(sim.getDebugStats().activeEnemies).toBe(1);
  const w8Boss = findActiveBoss();
  expect(w8Boss).not.toBeNull();
  expect(w8Boss!.y).toBeLessThan(-320);
});

test('Wave 8 schedules 4 Dreadnoughts (N@2s, S@20s, E@32s, W@35s) alongside 0.9s base minion cadence', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1], 8888);
  sim.jumpToWave(8);
  const view = createAuxView(sim.auxState);

  const def8 = getWaveDefinition(8);
  const mult = waveCountMultiplier(sim.getSquadWeight());
  const expectedMinions =
    Math.max(1, Math.round(def8.drones * mult)) +
    Math.max(1, Math.round(def8.fastDrones * mult)) +
    Math.max(1, Math.round(def8.brutes * mult));
  expect(sim.getDebugStats().queuedEnemies).toBe(expectedMinions + 4);

  const collectBosses = () => {
    const bosses: Array<{ id: number; x: number; y: number; flankId: number }> = [];
    for (let i = 0; i < AUX_LAYOUT.MAX_ENEMIES; i += 1) {
      const e = readEnemy(view, i);
      if (e.hpPct > 0 && e.type === ENEMY_TYPE.BOSS) {
        bosses.push({ id: i, x: e.x, y: e.y, flankId: e.flankId });
      }
    }
    return bosses;
  };

  let tick = 0;
  const advanceToSec = (targetSec: number) => {
    const targetTicks = Math.ceil(targetSec / C.dt);
    while (tick < targetTicks) {
      if (tick % 60 === 0) sim.state[CYBER_HEADER.coreHp] = C.coreMaxHp;
      sim.step(C.dt);
      tick += 1;
    }
  };

  // At t = 2.1s: Boss 1 (North, flank 0) has spawned
  advanceToSec(2.1);
  let bosses = collectBosses();
  expect(bosses.length).toBe(1);
  expect(bosses[0]!.flankId).toBe(0);
  expect(bosses[0]!.y).toBeLessThan(-320);

  // At t = 10.0s: Minions are trickling in (not blocked by Boss 2 at 20s), still only 1 boss
  advanceToSec(10.0);
  expect(collectBosses().length).toBe(1);
  expect(sim.getDebugStats().activeEnemies).toBeGreaterThan(3);

  // At t = 19.8s: Boss 2 has not spawned yet
  advanceToSec(19.8);
  expect(collectBosses().length).toBe(1);

  // At t = 20.1s: Boss 2 (South, flank 2) has spawned
  advanceToSec(20.1);
  bosses = collectBosses();
  expect(bosses.length).toBe(2);
  const southBoss = bosses.find((b) => b.flankId === 2);
  expect(southBoss).toBeDefined();
  expect(southBoss!.y).toBeGreaterThan(320);

  // At t = 31.8s: Boss 3 & Boss 4 have not spawned yet
  advanceToSec(31.8);
  expect(collectBosses().length).toBe(2);

  // At t = 32.1s: Boss 3 (East, flank 1) has spawned while Boss 4 (West) has not
  advanceToSec(32.1);
  bosses = collectBosses();
  expect(bosses.length).toBe(3);
  const eastBoss = bosses.find((b) => b.flankId === 1);
  expect(eastBoss).toBeDefined();
  expect(eastBoss!.x).toBeGreaterThan(320);
  expect(bosses.find((b) => b.flankId === 3)).toBeUndefined();

  // At t = 34.8s: Boss 4 has still not spawned yet
  advanceToSec(34.8);
  expect(collectBosses().length).toBe(3);

  // At t = 35.1s: Boss 4 (West, flank 3) spawns
  advanceToSec(35.1);
  bosses = collectBosses();
  expect(bosses.length).toBe(4);
  const westBoss = bosses.find((b) => b.flankId === 3);
  expect(westBoss).toBeDefined();
  expect(westBoss!.x).toBeLessThan(-320);
});

test('Wave 8 at W = 3.0 spaces minions at 1.35s and keeps boss timestamps fixed', () => {
  const world = createCyberWorld();
  world.squadWeight = 3;
  populateWaveSpawns(world, 8);

  const baseCadence = getWaveDefinition(8).spawnCadenceSec;
  expect(baseCadence).toBe(0.9);
  const cadence = baseCadence * waveCadenceMultiplier(world.squadWeight);
  expect(cadence).toBeCloseTo(1.35, 5);

  const entries: Array<{ type: number; flank: number; delay: number }> = [];
  let head = world.spawnHead;
  for (let i = 0; i < world.spawnCount; i += 1) {
    entries.push({
      type: world.spawnType[head]!,
      flank: world.spawnFlank[head]!,
      delay: world.spawnDelay[head]!,
    });
    head = (head + 1) % SPAWN_QUEUE_CAP;
  }

  const bosses = entries.filter((entry) => entry.type === ENEMY_TYPE.BOSS);
  expect(bosses.map((boss) => boss.flank)).toEqual([0, 2, 1, 3]);
  expect(bosses.map((boss) => boss.delay)).toEqual([2, 20, 32, 35]);

  const minions = entries.filter((entry) => entry.type !== ENEMY_TYPE.BOSS);
  expect(minions.length).toBeGreaterThan(1);
  expect(minions[0]!.delay).toBeCloseTo(C.flankTelegraphSec + 3.5, 5);
  for (let i = 1; i < minions.length; i += 1) {
    expect(minions[i]!.delay - minions[i - 1]!.delay).toBeCloseTo(1.35, 4);
  }
});
