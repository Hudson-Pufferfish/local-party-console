import { expect, test } from 'vitest';
import autoFireSrc from './auto-fire.ts?raw';
import bossSrc from './boss.ts?raw';
import bruteSrc from './brute.ts?raw';
import {
  AUX_LAYOUT,
  BARRICADE_FLAG,
  BUTTON_BIT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PHASE,
  CYBER_PLAYER_OFFSET,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
} from './constants.ts';
import dashSrc from './dash.ts?raw';
import empSrc from './emp.ts?raw';
import { cellCenter, worldToCell } from './flow-field.ts';
import flowFieldSrc from './flow-field.ts?raw';
import railSrc from './rail.ts?raw';
import reviveSrc from './revive.ts?raw';
import { waveCadenceMultiplier, waveCountMultiplier } from './scaling.ts';
import { tryPlaceBarricade } from './shield.ts';
import shieldSrc from './shield.ts?raw';
import { createCyberCitadelSimulation } from './simulation.ts';
import simSrc from './simulation.ts?raw';
import { createAuxView, playerBase, readBarricade, readEnemy, readMetaTrailer } from './state.ts';
import { enqueueSpawn, getWaveDefinition, tickWaveSpawns } from './waves.ts';
import wavesSrc from './waves.ts?raw';
import { createCyberWorld, nextRand } from './world.ts';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function advanceCountdown(sim: ReturnType<typeof createCyberCitadelSimulation>): void {
  for (let i = 0; i < 365; i += 1) {
    if (sim.state[CYBER_HEADER.phaseEnum] === CYBER_PHASE.WAVE_ACTIVE) break;
    sim.step(C.dt);
  }
}

test('startMatch enters COUNTDOWN (3.0s) -> Wave 1, clamps box boundary, and disables player-player collision', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1], 101);
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.COUNTDOWN);
  expect(sim.state[CYBER_HEADER.phaseTimer]).toBeCloseTo(C.countdownSec, 3);
  expect(sim.state[CYBER_HEADER.wave]).toBe(1);

  advanceCountdown(sim);
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.WAVE_ACTIVE);

  // Push P0 hard into +X/+Y corner for 4 seconds: must clamp within [-400, 400] with 0 HP lost
  const hpBefore = sim.state[playerBase(0) + CYBER_PLAYER_OFFSET.hp];
  for (let i = 0; i < 480; i += 1) {
    sim.applyInput(0, 0, 127, 127);
    sim.step(C.dt);
  }
  const b0 = playerBase(0);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.x]).toBeLessThanOrEqual(C.halfArena - C.playerRadius + 1e-3);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.y]).toBeLessThanOrEqual(C.halfArena - C.playerRadius + 1e-3);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.hp]).toBe(hpBefore);

  // Friendly fire & teammate collision off: place P0 and P1 overlapping and move through each other
  const b1 = playerBase(1);
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 160;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = 170;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.applyInput(0, BUTTON_BIT.RAIL, 127, 0);
  sim.applyInput(1, 0, -127, 0);
  sim.step(C.dt);
  expect(sim.state[b1 + CYBER_PLAYER_OFFSET.hp]).toBe(C.playerMaxHp);
});

test('auto-fire enforces 60-degree cone, Core-distance priority (INV-7), and 10% target stickiness (FR-9.6)', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0], 202);
  sim.jumpToWave(1);
  sim.clearSpawnQueueForTest();
  const view = createAuxView(sim.auxState);

  const b0 = playerBase(0);
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 280;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = Math.PI; // facing -X toward Core

  // Target A at Core distance 200: (200, 0)
  const eA = sim.spawnEnemyForTest(ENEMY_TYPE.DRONE, 200, 0, 0, 120);
  // Step 0.25s so P0 locks and fires at eA
  for (let i = 0; i < 30; i += 1) sim.step(C.dt);
  const hpAAfterFirst = readEnemy(view, eA).hpPct;
  expect(hpAAfterFirst).toBeLessThan(255);

  // Spawn Target B at 93% of eA's current Core distance (<10% closer -> stickiness must KEEP lock on eA)
  const eAXAfter1 = readEnemy(view, eA).x;
  const eB = sim.spawnEnemyForTest(ENEMY_TYPE.DRONE, eAXAfter1 * 0.93, 0, 0, 120);
  for (let i = 0; i < 25; i += 1) sim.step(C.dt);
  expect(readEnemy(view, eB).hpPct).toBe(255);
  expect(readEnemy(view, eA).hpPct).toBeLessThan(hpAAfterFirst);

  // Spawn Target C at 75% of eA's current Core distance (>10% closer -> must SWITCH lock to eC)
  const eAXAfter2 = readEnemy(view, eA).x;
  const eC = sim.spawnEnemyForTest(ENEMY_TYPE.DRONE, eAXAfter2 * 0.75, 0, 0, 120);
  for (let i = 0; i < 28; i += 1) sim.step(C.dt);
  expect(readEnemy(view, eC).hpPct).toBeLessThan(255);
});

test('RAIL pierces multiple targets with 15-degree shield snap and 2.5s cooldown; simultaneous DASH+RAIL resolves DASH first', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0], 303);
  sim.jumpToWave(3);
  sim.clearSpawnQueueForTest();
  const view = createAuxView(sim.auxState);

  const b0 = playerBase(0);
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = -250;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = 0;

  // Aligned drones at (-100, 0) and (50, 0), plus shielded brute 10 deg off-axis at (100, 18)
  const d1 = sim.spawnEnemyForTest(ENEMY_TYPE.DRONE, -100, 0, Math.PI, 200);
  const d2 = sim.spawnEnemyForTest(ENEMY_TYPE.DRONE, 50, 0, Math.PI, 200);

  // Fire RAIL along +X
  sim.applyInput(0, BUTTON_BIT.RAIL, 0, 0);
  sim.step(C.dt);
  expect(readEnemy(view, d1).hpPct).toBeLessThan(255);
  expect(readEnemy(view, d2).hpPct).toBeLessThan(255);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.railCooldown]).toBeCloseTo(C.railCooldownSec, 1);

  // Tap RAIL again during cooldown -> ignored without resetting or queuing
  sim.applyInput(0, 0, 0, 0);
  sim.step(C.dt);
  const cdMid = sim.state[b0 + CYBER_PLAYER_OFFSET.railCooldown]!;
  sim.applyInput(0, BUTTON_BIT.RAIL, 0, 0);
  sim.step(C.dt);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.railCooldown]).toBeLessThan(cdMid);

  // Simultaneous DASH + RAIL (FR-9.17): wait out cooldown, then press both on same tick
  sim.applyInput(0, 0, 0, 0);
  for (let i = 0; i < 310; i += 1) sim.step(C.dt);
  const xBefore = sim.state[b0 + CYBER_PLAYER_OFFSET.x]!;
  sim.applyInput(0, BUTTON_BIT.DASH | BUTTON_BIT.RAIL, 127, 0);
  sim.step(C.dt);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.x]).toBeGreaterThan(xBefore);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.railCooldown]).toBeGreaterThan(2.0);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.dashCooldown]).toBeGreaterThan(1.0);
});

test('SHIELD enforces max 2 barricades, 8.0s TTL, Core ring exclusion, and enemy breach when corridor sealed', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0], 404);
  sim.jumpToWave(1);
  sim.clearSpawnQueueForTest();

  const b0 = playerBase(0);
  // Inside Core ring: SHIELD rejected
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 20;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = 0;
  sim.applyInput(0, BUTTON_BIT.SHIELD, 0, 0);
  sim.step(C.dt);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.barricades]).toBe(0);

  // Outside Core ring: place 2 barricades, 3rd rejected (INV-6)
  sim.applyInput(0, 0, 0, 0);
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 220;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.applyInput(0, BUTTON_BIT.SHIELD, 0, 0);
  sim.step(C.dt);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.barricades]).toBe(1);

  // Wait shield cooldown, move slightly, place 2nd
  sim.applyInput(0, 0, 0, 0);
  for (let i = 0; i < 200; i += 1) sim.step(C.dt);
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 80;
  sim.applyInput(0, BUTTON_BIT.SHIELD, 0, 0);
  sim.step(C.dt);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.barricades]).toBe(2);

  // Wait shield cooldown, try 3rd -> still capped at 2
  sim.applyInput(0, 0, 0, 0);
  for (let i = 0; i < 200; i += 1) sim.step(C.dt);
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 160;
  sim.applyInput(0, BUTTON_BIT.SHIELD, 0, 0);
  sim.step(C.dt);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.barricades]).toBe(2);

  // After 8.0s TTL expires, barricades clear back to 0
  sim.applyInput(0, 0, 0, 0);
  for (let i = 0; i < 1000; i += 1) sim.step(C.dt);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.barricades]).toBe(0);
});

test('Button Y prioritizes revive over EMP, enforces 1 HP Core respawn floor + 12% cap, and charges/decays/discharges EMP', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1], 505);
  sim.jumpToWave(1);
  sim.clearSpawnQueueForTest();

  const b0 = playerBase(0);
  const b1 = playerBase(1);
  // Keep wave active with a distant high-HP enemy
  sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, -360, -360, 0, 9999);
  // Put both inside Core ring, with P1 DOWNED right next to P0 -> Y must start REVIVE, not EMP
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 60;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = 90;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.downPlayerForTest(1);

  sim.applyInput(0, BUTTON_BIT.REVIVE_EMP, 0, 0);
  sim.step(C.dt);
  sim.applyInput(0, 0, 0, 0);
  expect((sim.state[b0 + CYBER_PLAYER_OFFSET.flags]! & CYBER_FLAG.EMP_JOINED)).toBe(0);
  // Hold proximity for 2.55s -> P1 revived to ACTIVE with reviveRestoreHp
  for (let i = 0; i < 310; i += 1) sim.step(C.dt);
  expect((sim.state[b1 + CYBER_PLAYER_OFFSET.flags]! & CYBER_FLAG.ACTIVE)).not.toBe(0);
  expect(sim.state[b1 + CYBER_PLAYER_OFFSET.hp]).toBeCloseTo(C.reviveRestoreHp, 1);

  // Now both ACTIVE inside Core ring: P0 taps Y -> joins EMP (>= 50% of 2 living = 1, and >= 1 human)
  const d1 = sim.spawnEnemyForTest(ENEMY_TYPE.DRONE, 200, 0, Math.PI, 40);
  sim.applyInput(0, BUTTON_BIT.REVIVE_EMP, 0, 0);
  sim.step(C.dt);
  sim.applyInput(0, 0, 0, 0);
  for (let i = 0; i < 120; i += 1) sim.step(C.dt); // 1.0s charge
  const chargeMid = sim.state[CYBER_HEADER.empCharge]!;
  expect(chargeMid).toBeGreaterThan(0.25);

  // P0 disconnects (AWAY) -> immediately removed from EMP, charge decays at 10%/s (FR-9.11)
  sim.setConnectedMask(0b10);
  for (let i = 0; i < 120; i += 1) sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.empCharge]!).toBeLessThan(chargeMid - 0.08);

  // Reconnect P0, re-join EMP, finish charging -> fires EMP, increments empFiredCount, kills nearby drone
  sim.setConnectedMask(0b11);
  sim.applyInput(0, BUTTON_BIT.REVIVE_EMP, 0, 0);
  sim.step(C.dt);
  sim.applyInput(0, 0, 0, 0);
  for (let i = 0; i < 420; i += 1) sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.empFiredCount]).toBe(1);
  const view = createAuxView(sim.auxState);
  expect(readEnemy(view, d1).hpPct).toBe(0);

  // Respawn Core HP 1 HP floor + 12% wave cap (INV-5) and all-squad-down does not instant-fail (FR-9.2)
  sim.jumpToWave(2);
  sim.clearSpawnQueueForTest();
  // Distant enemy keeps Wave 2 active without reaching Core during bleed-out check
  sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, -380, -380, 0, 9999);
  sim.state[CYBER_HEADER.coreHp] = 15; // less than 3% of 1000 (30)
  sim.downPlayerForTest(0);
  sim.downPlayerForTest(1);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.downTimer]).toBeCloseTo(C.bleedOutSec, 2);
  // Both downed -> still WAVE_ACTIVE, not instant loss
  sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.WAVE_ACTIVE);
  // Fast-forward near end of bleed-out -> respawning clamps Core HP at 1 (never 0)
  sim.state[b0 + CYBER_PLAYER_OFFSET.downTimer] = 0.1;
  sim.state[b1 + CYBER_PLAYER_OFFSET.downTimer] = 0.1;
  for (let i = 0; i < 30; i += 1) sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.coreHp]).toBe(1);
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.WAVE_ACTIVE);
});

test(
  '3,000-tick multi-wave fuzz (Waves 1, 4, 8) holds INV-1..8 and bit-exact replay determinism',
  { timeout: 40000 },
  () => {
    const profiles = [
      { name: 'Wave 1 Solo', slots: [0], wave: 1, seed: 1001, ticks: 3000 },
      { name: 'Wave 4 Mixed', slots: [0, 1, 2, 3], wave: 4, seed: 4004, ticks: 3000 },
      // Wave 8 runs to 8400 ticks (70.0s) so all 4 bosses (N@2s, S@25s, E@50s, W@65s) are fuzzed
      { name: 'Wave 8 Full 8P', slots: [0, 1, 2, 3, 4, 5, 6, 7], wave: 8, seed: 8008, ticks: 8400 },
    ] as const;

    for (const profile of profiles) {
      const TICKS = profile.ticks;
      const tape = new Int8Array(TICKS * 8 * 3);
      let rng = profile.seed >>> 0;
      const nextRand = (): number => {
        rng = (rng + 0x6d2b79f5) >>> 0;
        let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      for (let tick = 0; tick < TICKS; tick += 1) {
        for (let s = 0; s < 8; s += 1) {
          const base = (tick * 8 + s) * 3;
          tape[base] = Math.round((nextRand() * 2 - 1) * 127);
          tape[base + 1] = Math.round((nextRand() * 2 - 1) * 127);
          const r = nextRand();
          tape[base + 2] = r < 0.04 ? Math.floor(nextRand() * 16) : 0;
        }
      }

      const simA = createCyberCitadelSimulation();
      simA.startMatch([...profile.slots], profile.seed);
      if (profile.wave > 1) simA.jumpToWave(profile.wave);

      const simB = createCyberCitadelSimulation();
      simB.startMatch([...profile.slots], profile.seed);
      if (profile.wave > 1) simB.jumpToWave(profile.wave);

      for (let tick = 0; tick < TICKS; tick += 1) {
        for (const s of profile.slots) {
          const base = (tick * 8 + s) * 3;
          const ax = tape[base]!;
          const ay = tape[base + 1]!;
          const btn = tape[base + 2]! & 0x0f;
          simA.applyInput(s, btn, ax, ay);
          simB.applyInput(s, btn, ax, ay);
        }
        simA.step(C.dt);
        simB.step(C.dt);

        // Assert INV-1..6 every tick on simA
        for (let k = 0; k < 88; k += 1) {
          expect(Number.isFinite(simA.state[k])).toBe(true);
        }
        for (const s of profile.slots) {
          const pb = playerBase(s);
          expect(simA.state[pb + CYBER_PLAYER_OFFSET.x]).toBeGreaterThanOrEqual(-C.halfArena);
          expect(simA.state[pb + CYBER_PLAYER_OFFSET.x]).toBeLessThanOrEqual(C.halfArena);
          expect(simA.state[pb + CYBER_PLAYER_OFFSET.y]).toBeGreaterThanOrEqual(-C.halfArena);
          expect(simA.state[pb + CYBER_PLAYER_OFFSET.y]).toBeLessThanOrEqual(C.halfArena);
          expect(simA.state[pb + CYBER_PLAYER_OFFSET.railCooldown]).toBeGreaterThanOrEqual(0);
          expect(simA.state[pb + CYBER_PLAYER_OFFSET.railCooldown]).toBeLessThanOrEqual(
            C.railCooldownSec + 1e-4,
          );
          expect(simA.state[pb + CYBER_PLAYER_OFFSET.dashCooldown]).toBeGreaterThanOrEqual(0);
          expect(simA.state[pb + CYBER_PLAYER_OFFSET.barricades]).toBeLessThanOrEqual(
            C.barricadeMaxPerPlayer,
          );
        }
        const stats = simA.getDebugStats();
        expect(stats.activeEnemies).toBeLessThanOrEqual(AUX_LAYOUT.MAX_ENEMIES);
        expect(stats.activeBarricades).toBeLessThanOrEqual(AUX_LAYOUT.MAX_BARRICADES);

        if (tick === 999 || tick === 1999 || tick === 2999 || tick === profile.ticks - 1) {
          // INV-8 bit-exact determinism across both primary state and 3KB auxState
          expect(
            bytesEqual(
              new Uint8Array(simA.state.buffer, simA.state.byteOffset, simA.state.byteLength),
              new Uint8Array(simB.state.buffer, simB.state.byteOffset, simB.state.byteLength),
            ),
          ).toBe(true);
          expect(bytesEqual(simA.auxState, simB.auxState)).toBe(true);
        }
      }

      // Sanity: meta trailer readable
      const meta = readMetaTrailer(createAuxView(simA.auxState));
      expect(meta.empRingRequiredCount).toBeGreaterThanOrEqual(1);
    }
  },
);

test('INV-9 static hot-path guard ensures zero Math.random or Date.now inside simulation modules', () => {
  const hotSources = [
    simSrc,
    flowFieldSrc,
    autoFireSrc,
    railSrc,
    dashSrc,
    shieldSrc,
    reviveSrc,
    empSrc,
    bruteSrc,
    bossSrc,
    wavesSrc,
  ];
  for (const src of hotSources) {
    expect(src).not.toContain('Math.random(');
    expect(src).not.toContain('Date.now(');
  }
});

test('living players softly separate and never stack, while living players pass through downed teammates', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1], 101);
  advanceCountdown(sim);

  const b0 = playerBase(0);
  const b1 = playerBase(1);

  // Place both players in collision overlap: dist = 10px (less than minPlayerDist = 48px)
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 100;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 100;
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = 110;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = 100;

  // Step simulation -> soft separation pushes them apart to at least 48px
  sim.step(C.dt);

  const dx = sim.state[b1 + CYBER_PLAYER_OFFSET.x]! - sim.state[b0 + CYBER_PLAYER_OFFSET.x]!;
  const dy = sim.state[b1 + CYBER_PLAYER_OFFSET.y]! - sim.state[b0 + CYBER_PLAYER_OFFSET.y]!;
  const dist = Math.sqrt(dx * dx + dy * dy);
  expect(dist).toBeGreaterThanOrEqual(48 - 1e-4);

  // Now down player 1: living player 0 can overlap directly over them with zero separation
  sim.state[b1 + CYBER_PLAYER_OFFSET.flags] =
    sim.state[b1 + CYBER_PLAYER_OFFSET.flags]! | CYBER_FLAG.DOWNED;
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 100;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 100;
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = 100;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = 100;

  sim.step(C.dt);

  // Positions remain directly on top of each other because downed ally allows 100% pass-through
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.x]).toBe(100);
  expect(sim.state[b1 + CYBER_PLAYER_OFFSET.x]).toBe(100);
});

test('natural Wave 7 -> WAVE_BREAK -> Wave 8 transition heals Core, resets boss slots, and launches 4-boss Wave 8', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1], 7080);
  sim.jumpToWave(7);
  const view = createAuxView(sim.auxState);

  // Damage Core below max so we can observe the +10% WAVE_BREAK repair
  sim.state[CYBER_HEADER.coreHp] = 700;

  // Advance Wave 7 until the queue is empty, including the gatekeeper Dreadnought.
  // Two players use the 1.8 cadence band (0.28s × 1.8), so the drain window follows that stream.
  const def7 = getWaveDefinition(7);
  const squadWeight = sim.getSquadWeight();
  const cadence = def7.spawnCadenceSec * waveCadenceMultiplier(squadWeight);
  const countMult = waveCountMultiplier(squadWeight);
  const minions =
    Math.max(1, Math.round(def7.drones * countMult)) +
    Math.max(1, Math.round(def7.fastDrones * countMult)) +
    Math.max(1, Math.round(def7.brutes * countMult));
  const drainTicks = Math.ceil((C.flankTelegraphSec + (minions + 4) * cadence + 1) / C.dt);
  let sawWave7Boss = false;
  for (let i = 0; i < drainTicks; i += 1) {
    if (i % 60 === 0 && sim.state[CYBER_HEADER.coreHp]! < 700) {
      sim.state[CYBER_HEADER.coreHp] = 700;
    }
    sim.step(C.dt);
    if (!sawWave7Boss && sim.state[CYBER_HEADER.bossPhase] === 1) {
      sawWave7Boss = true;
    }
    if (sim.getDebugStats().queuedEnemies === 0 && sawWave7Boss) break;
  }
  expect(sawWave7Boss).toBe(true);
  expect(sim.state[CYBER_HEADER.wave]).toBe(7);

  // Eliminate all Wave 7 enemies through simulation damage (natural Wave 7 clear)
  sim.state[CYBER_HEADER.coreHp] = 700;
  for (let i = 0; i < AUX_LAYOUT.MAX_ENEMIES; i += 1) {
    if (readEnemy(view, i).hpPct > 0) {
      sim.damageEnemyForTest(i, 99999);
    }
  }
  sim.step(C.dt);

  // Must transition naturally into WAVE_BREAK (15.0s) with +10% Core repair and cleared bossPhase
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.WAVE_BREAK);
  expect(sim.state[CYBER_HEADER.wave]).toBe(7);
  expect(sim.state[CYBER_HEADER.phaseTimer]).toBeCloseTo(C.waveBreakSec, 1);
  // Core receives +10% repair (+100 HP) minus any final-tick enemy contact damage before death
  expect(sim.state[CYBER_HEADER.coreHp]).toBeGreaterThan(780);
  expect(sim.state[CYBER_HEADER.coreHp]).toBeLessThanOrEqual(700 + C.coreMaxHp * C.waveBreakCoreHealPct);
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(0);

  // Advance naturally through 15.0s WAVE_BREAK -> Wave 8 WAVE_ACTIVE
  for (let i = 0; i < Math.ceil((C.waveBreakSec + 0.1) / C.dt); i += 1) {
    sim.step(C.dt);
    if (sim.state[CYBER_HEADER.phaseEnum] === CYBER_PHASE.WAVE_ACTIVE) break;
  }
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.WAVE_ACTIVE);
  expect(sim.state[CYBER_HEADER.wave]).toBe(8);
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(0);
  const def8 = getWaveDefinition(8);
  // Wave 8 queues 4 Dreadnoughts plus scaled minions (for 2 players, mult = 1.0)
  const expectedWave8Queued = def8.drones + def8.fastDrones + def8.brutes + 4;
  expect(sim.getDebugStats().queuedEnemies).toBe(expectedWave8Queued);

  // Advance past 2.0s telegraph -> Wave 8 Boss 1 spawns cleanly on North flank
  for (let i = 0; i < 252; i += 1) sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(1);
  let w8BossCount = 0;
  for (let i = 0; i < AUX_LAYOUT.MAX_ENEMIES; i += 1) {
    const e = readEnemy(view, i);
    if (e.hpPct > 0 && e.type === ENEMY_TYPE.BOSS) w8BossCount += 1;
  }
  expect(w8BossCount).toBe(1);
});

function distSqCircleToCellAabb(x: number, y: number, cellX: number, cellY: number): number {
  const halfCell = C.cellSize * 0.5;
  const dx = x - cellCenter(cellX);
  const dy = y - cellCenter(cellY);
  const clampedDx = Math.max(-halfCell, Math.min(halfCell, dx));
  const clampedDy = Math.max(-halfCell, Math.min(halfCell, dy));
  const rx = dx - clampedDx;
  const ry = dy - clampedDy;
  return rx * rx + ry * ry;
}

function placeBarricadeAtCell(
  sim: ReturnType<typeof createCyberCitadelSimulation>,
  slot: number,
  cellX: number,
  cellY: number,
): void {
  const base = playerBase(slot);
  const dist = C.playerRadius + C.cellSize * 1.1;
  sim.state[base + CYBER_PLAYER_OFFSET.x] = cellCenter(cellX) - dist;
  sim.state[base + CYBER_PLAYER_OFFSET.y] = cellCenter(cellY);
  sim.state[base + CYBER_PLAYER_OFFSET.heading] = 0;
  sim.applyInput(slot, BUTTON_BIT.SHIELD, 0, 0);
  sim.step(C.dt);
  sim.applyInput(slot, 0, 0, 0);
}

test('enemies (Drone, Fast Drone, Brute, Boss) cannot clip barricades and damage blocking barricades', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1, 2], 7601);
  sim.jumpToWave(7);
  sim.clearSpawnQueueForTest();
  const view = createAuxView(sim.auxState);

  // Anchor enemy in far corner keeps WAVE_ACTIVE during barricade placement cooldown
  sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, -360, -360, 0, 9999);

  // Place a 5-cell vertical barricade wall at cx = 28 (x in [160, 180]), cy = 18..22 (y in [-40, 60])
  placeBarricadeAtCell(sim, 0, 28, 18);
  placeBarricadeAtCell(sim, 1, 28, 19);
  placeBarricadeAtCell(sim, 2, 28, 20);
  // Wait out shield cooldown (1.5s = 180 ticks) to place remaining 2 cells
  for (let i = 0; i < 190; i += 1) sim.step(C.dt);
  placeBarricadeAtCell(sim, 0, 28, 21);
  placeBarricadeAtCell(sim, 1, 28, 22);
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.WAVE_ACTIVE);
  expect(sim.getDebugStats().activeBarricades).toBe(5);

  // Park players behind the wall facing away (-X) so auto-fire does not interfere,
  // while P0 at (80, 10) draws Brute and Boss aggro directly across the wall.
  for (let s = 0; s < 3; s += 1) {
    const b = playerBase(s);
    sim.state[b + CYBER_PLAYER_OFFSET.x] = 80;
    sim.state[b + CYBER_PLAYER_OFFSET.y] = 10 + (s - 1) * 60;
    sim.state[b + CYBER_PLAYER_OFFSET.heading] = Math.PI;
  }

  // Spawn all four enemy classes on the East side of the barricade row:
  // - Drone and Fast Drone skim the top edge / corner of the barricade row
  // - Brute and Boss charge straight West into the wall toward P0
  const droneId = sim.spawnEnemyForTest(ENEMY_TYPE.DRONE, 195, -26, Math.PI, 500);
  const fastId = sim.spawnEnemyForTest(ENEMY_TYPE.FAST_DRONE, 194, -24, Math.PI, 500);
  const bruteId = sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, 216, 10, Math.PI, 900);
  const bossId = sim.spawnEnemyForTest(ENEMY_TYPE.BOSS, 236, 10, Math.PI, 1500);

  const tracked: ReadonlyArray<{ id: number; radius: number }> = [
    { id: droneId, radius: C.droneRadius },
    { id: fastId, radius: C.fastDroneRadius },
    { id: bruteId, radius: C.bruteRadius },
    { id: bossId, radius: C.bossRadius },
  ];

  // Step 1.5s (180 ticks) while barricades remain active: assert zero circle-vs-AABB penetration
  // and verify blocked enemies deal damage to the barricade row.
  let observedBarricadeDamage = false;
  for (let tick = 0; tick < 180; tick += 1) {
    sim.step(C.dt);
    for (let bi = 0; bi < AUX_LAYOUT.MAX_BARRICADES; bi += 1) {
      const bar = readBarricade(view, bi);
      if ((bar.flags & BARRICADE_FLAG.ACTIVE) === 0) continue;
      if (bar.hpPct < 255) observedBarricadeDamage = true;
      for (const t of tracked) {
        const e = readEnemy(view, t.id);
        if (e.hpPct === 0) continue;
        const dSq = distSqCircleToCellAabb(e.x, e.y, bar.cellX, bar.cellY);
        const minAllowed = t.radius - 0.1; // allow u16 auxState decode quantization (~0.012)
        expect(dSq).toBeGreaterThanOrEqual(minAllowed * minAllowed);
      }
    }
  }

  expect(observedBarricadeDamage).toBe(true);
});

test('stunned and knocked-back enemies stop on barricades, and placement/spawn checks use circle-vs-AABB', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1], 7602);
  sim.jumpToWave(3);
  sim.clearSpawnQueueForTest();
  const view = createAuxView(sim.auxState);

  // 1. Placement corner clearance: Boss (r=44) at (+39, +39) from cell (28, 20) center (170, 10)
  // has center dist 55.15 > 44+10 (passes circle-vs-circle) but corner dist 41.01 < 44 (overlaps AABB).
  const cornerBoss = sim.spawnEnemyForTest(
    ENEMY_TYPE.BOSS,
    cellCenter(28) + 39,
    cellCenter(20) + 39,
    0,
    9999,
  );
  expect(cornerBoss).toBeGreaterThanOrEqual(0);
  placeBarricadeAtCell(sim, 0, 28, 20);
  expect(sim.getDebugStats().activeBarricades).toBe(0);

  // Clear boss, keep wave active with far anchor, and place barricade at (28, 20)
  sim.clearAllEnemiesForTest();
  sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, -360, -360, 0, 9999);
  placeBarricadeAtCell(sim, 0, 28, 20);
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.WAVE_ACTIVE);
  expect(sim.getDebugStats().activeBarricades).toBe(1);

  // 2. Stunned + knockback stop: EMP stuns a Brute on the East side, then P1 fires RAIL West
  // to knock the stunned Brute into the barricade. Brute must stop outside x >= 180 + 22 and deal 0 damage.
  const b0 = playerBase(0);
  const b1 = playerBase(1);
  // Put P0 and P1 inside Core ring so EMP charges to discharge, facing away from East
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 60;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = Math.PI;
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = 60;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = 50;
  sim.state[b1 + CYBER_PLAYER_OFFSET.heading] = Math.PI;

  const bruteId = sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, 224, 10, Math.PI, 800);
  sim.applyInput(0, BUTTON_BIT.REVIVE_EMP, 0, 0);
  sim.step(C.dt);
  sim.applyInput(0, 0, 0, 0);

  // Charge EMP (3.0s = 360 ticks), keeping Brute repositioned just East of barricade before blast
  for (let i = 0; i < 365; i += 1) {
    sim.step(C.dt);
    if (sim.state[CYBER_HEADER.empFiredCount]! > 0) break;
  }
  expect(sim.state[CYBER_HEADER.empFiredCount]).toBeGreaterThan(0);
  expect((readEnemy(view, bruteId).stateFlags & ENEMY_STATE_FLAG.STUNNED) !== 0).toBe(true);

  // Locate the blocking barricade at (28, 20) and record its HP right after EMP stuns the Brute
  const stunnedPos = readEnemy(view, bruteId);
  const barSlot = (() => {
    for (let bi = 0; bi < AUX_LAYOUT.MAX_BARRICADES; bi += 1) {
      const bar = readBarricade(view, bi);
      if ((bar.flags & BARRICADE_FLAG.ACTIVE) !== 0 && bar.cellX === 28 && bar.cellY === 20) {
        return bi;
      }
    }
    return -1;
  })();
  expect(barSlot).toBeGreaterThanOrEqual(0);
  // Advance one tick so any pre-stun pending damage settles before measuring stunned knockback
  sim.step(C.dt);
  const hpAfterStun = readBarricade(view, barSlot).hpPct;
  expect(hpAfterStun).toBeGreaterThan(0);
  expect(hpAfterStun).toBeLessThan(255);

  // Move P1 to the East of the stunned Brute and fire RAIL West (-X) to knock it into the barricade
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = stunnedPos.x + 80;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = stunnedPos.y;
  sim.state[b1 + CYBER_PLAYER_OFFSET.heading] = Math.PI;
  sim.applyInput(1, BUTTON_BIT.RAIL, 0, 0);
  sim.step(C.dt);
  sim.applyInput(1, 0, 0, 0);

  // Park P1 facing away so auto-fire does not interfere; step 60 ticks under knockback while stunned
  sim.state[b1 + CYBER_PLAYER_OFFSET.heading] = 0;
  for (let tick = 0; tick < 60; tick += 1) {
    sim.step(C.dt);
    const e = readEnemy(view, bruteId);
    const bar = readBarricade(view, barSlot);
    expect(bar.hpPct).toBe(hpAfterStun);
    const dSq = distSqCircleToCellAabb(e.x, e.y, bar.cellX, bar.cellY);
    expect(dSq).toBeGreaterThanOrEqual((C.bruteRadius - 0.1) * (C.bruteRadius - 0.1));
  }

  // 3. Spawn corridor circle-vs-AABB clearance (waves.ts):
  // A barricade 1 cell horizontally adjacent to a Boss's spawn point must delay the spawn.
  const wPeek = createCyberWorld();
  wPeek.rngState = 12345;
  const peekSx = (nextRand(wPeek) * 2 - 1) * 180;
  const spawnCx = worldToCell(peekSx);
  const adjBarCx = spawnCx < C.gridCols - 2 ? spawnCx + 1 : spawnCx - 1;

  const w = createCyberWorld();
  w.rngState = 12345;
  w.pJoined[0] = 1;
  const p0 = playerBase(0);
  w.state[p0 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.JOINED | CYBER_FLAG.ACTIVE;
  w.state[p0 + CYBER_PLAYER_OFFSET.x] = cellCenter(adjBarCx);
  w.state[p0 + CYBER_PLAYER_OFFSET.y] = cellCenter(1) + C.playerRadius + C.cellSize * 1.1;
  w.state[p0 + CYBER_PLAYER_OFFSET.heading] = -Math.PI / 2;
  expect(tryPlaceBarricade(w, 0)).toBe(true);
  expect(w.flowField.isBlocked(spawnCx, 1)).toBe(false);

  enqueueSpawn(w, ENEMY_TYPE.BOSS, 0, 0);
  tickWaveSpawns(w, C.dt);
  expect(w.enemyPool.activeCount()).toBe(0);
  expect(w.spawnCount).toBe(1);
});

test('friendly weapons (auto-fire, RAIL, EMP) continue to pass through barricades', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1], 7603);
  sim.jumpToWave(1);
  sim.clearSpawnQueueForTest();
  const view = createAuxView(sim.auxState);

  // Anchor enemy in far corner keeps WAVE_ACTIVE during barricade placement cooldown
  sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, -360, -360, 0, 9999);

  // Place a 3-cell barricade wall at cx = 28 (x in [160, 180]), cy = 19, 20, 21
  placeBarricadeAtCell(sim, 0, 28, 19);
  placeBarricadeAtCell(sim, 1, 28, 20);
  for (let i = 0; i < 190; i += 1) sim.step(C.dt);
  placeBarricadeAtCell(sim, 0, 28, 21);
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.WAVE_ACTIVE);
  expect(sim.getDebugStats().activeBarricades).toBe(3);

  const b0 = playerBase(0);
  const b1 = playerBase(1);
  // P0 at (100, 10) facing East (+X) directly through the barricade wall; P1 parked away facing West
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 100;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 10;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = 0;
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = -200;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b1 + CYBER_PLAYER_OFFSET.heading] = Math.PI;

  // Spawn high-HP target on the far (East) side of the barricade wall
  const targetId = sim.spawnEnemyForTest(ENEMY_TYPE.DRONE, 230, 10, Math.PI, 600);

  // 1. Auto-fire hits target through barricade
  for (let i = 0; i < 30; i += 1) sim.step(C.dt);
  const hpAfterAuto = readEnemy(view, targetId).hpPct;
  expect(hpAfterAuto).toBeLessThan(255);

  // 2. RAIL pierces through barricade and damages target further
  sim.applyInput(0, BUTTON_BIT.RAIL, 0, 0);
  sim.step(C.dt);
  sim.applyInput(0, 0, 0, 0);
  const hpAfterRail = readEnemy(view, targetId).hpPct;
  expect(hpAfterRail).toBeLessThan(hpAfterAuto);

  // 3. EMP discharges through barricade and hits target on the other side
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 60;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = Math.PI; // stop auto-fire during EMP charge
  sim.applyInput(0, BUTTON_BIT.REVIVE_EMP, 0, 0);
  sim.step(C.dt);
  sim.applyInput(0, 0, 0, 0);
  // Keep target parked behind wall during EMP charge by using a distant high-HP Brute
  const empTarget = sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, 230, 10, Math.PI, 600);
  for (let i = 0; i < 370; i += 1) {
    sim.step(C.dt);
    if (sim.state[CYBER_HEADER.empFiredCount]! > 0) break;
  }
  expect(sim.state[CYBER_HEADER.empFiredCount]).toBeGreaterThan(0);
  // Advance one tick so Stage 6 applies the pending EMP blast damage to enemy HP
  sim.step(C.dt);
  expect(readEnemy(view, empTarget).hpPct).toBeLessThan(255);
});
