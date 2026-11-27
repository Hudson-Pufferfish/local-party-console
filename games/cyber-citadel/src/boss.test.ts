import { expect, test } from 'vitest';
import { hitsBruteFrontalShield } from './brute.ts';
import {
  AUX_LAYOUT,
  BOSS_WEAK_FLAG,
  BUTTON_BIT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PHASE,
  CYBER_PLAYER_OFFSET,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
  PROJECTILE_FLAG,
} from './constants.ts';
import { cellCenter } from './flow-field.ts';
import { tryPlaceBarricade } from './shield.ts';
import { createCyberCitadelSimulation } from './simulation.ts';
import {
  createAuxView,
  playerBase,
  readBossLaserLen,
  readBossSlotMeta,
  readEnemy,
  readMetaTrailer,
  readProjectile,
} from './state.ts';
import { clearBossSlot, createCyberWorld, tickAndSyncAuxState } from './world.ts';
import { findBossSlotByEnemyIdx, onBossDashHit, selectBossThreatTarget, updateBossFsm } from './boss.ts';
import { spawnEnemyImmediate } from './waves.ts';

test('Brute 120-degree frontal shield deflects +-59 deg, allows +-61 deg, RAIL pierces, DASH resets 1.0s spin', () => {
  // Pure arc math: brute at (0, 0) facing +X (heading 0)
  const rad59 = (59 * Math.PI) / 180;
  const rad61 = (61 * Math.PI) / 180;
  expect(hitsBruteFrontalShield(0, 0, 0, true, 0, Math.cos(rad59) * 100, Math.sin(rad59) * 100)).toBe(true);
  expect(hitsBruteFrontalShield(0, 0, 0, true, 0, Math.cos(-rad59) * 100, Math.sin(-rad59) * 100)).toBe(true);
  expect(hitsBruteFrontalShield(0, 0, 0, true, 0, Math.cos(rad61) * 100, Math.sin(rad61) * 100)).toBe(false);
  expect(hitsBruteFrontalShield(0, 0, 0, true, 0, Math.cos(-rad61) * 100, Math.sin(-rad61) * 100)).toBe(false);
  // While spinning (spinTimer > 0), frontal shield is bypassed
  expect(hitsBruteFrontalShield(0, 0, 0, true, 0.5, 100, 0)).toBe(false);

  // Simulation test: auto-fire deflected from front, RAIL pierces and breaks shield, DASH spins for 1.0s without stacking
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1], 42);
  sim.jumpToWave(3);
  const view = createAuxView(sim.auxState);

  // Place P0 at (140, 0) facing +X toward Brute at (240, 0) facing -X (heading PI, shield pointing directly at P0)
  const b0 = playerBase(0);
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 140;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = 0;
  const bruteId = sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, 240, 0, Math.PI, 300);

  // Run 30 ticks of auto-fire (more than 0.2s cadence): frontal shield must deflect -> full hpPct 255
  for (let i = 0; i < 30; i += 1) sim.step(C.dt);
  expect(readEnemy(view, bruteId).hpPct).toBe(255);

  // P0 fires RAIL (bit 0): pierces frontal shield, deals damage, drops SHIELD_UP
  sim.applyInput(0, BUTTON_BIT.RAIL, 0, 0);
  sim.step(C.dt);
  sim.applyInput(0, 0, 0, 0);
  const afterRail = readEnemy(view, bruteId);
  expect(afterRail.hpPct).toBeLessThan(255);
  expect(afterRail.stateFlags & ENEMY_STATE_FLAG.SHIELD_UP).toBe(0);

  // Second Brute for DASH spin test (non-stacking 1.0s spin)
  const brute2 = sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, -200, 0, 0, 300);
  const b1 = playerBase(1);
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = -150;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b1 + CYBER_PLAYER_OFFSET.heading] = Math.PI;
  sim.applyInput(1, BUTTON_BIT.DASH, -127, 0);
  for (let i = 0; i < 15; i += 1) {
    sim.step(C.dt);
    sim.applyInput(1, 0, -127, 0);
  }
  expect(readEnemy(view, brute2).stateFlags & ENEMY_STATE_FLAG.SPUN).not.toBe(0);
  // After 0.6s still spun; after 1.1s spin has ended (proving 1.0s duration, not stacked)
  for (let i = 0; i < 65; i += 1) sim.step(C.dt);
  expect(readEnemy(view, brute2).stateFlags & ENEMY_STATE_FLAG.SPUN).not.toBe(0);
  for (let i = 0; i < 70; i += 1) sim.step(C.dt);
  expect(readEnemy(view, brute2).stateFlags & ENEMY_STATE_FLAG.SPUN).toBe(0);
});

test('Wave 8 Dreadnought transitions phases at 66% and 33%, exposes weak points on opposite dual-dash within 1.0s, and triggers win on defeat', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1], 777);
  sim.jumpToWave(8);
  const view = createAuxView(sim.auxState);

  // Advance past 2.0s telegraph so Dreadnought spawns
  for (let i = 0; i < 250; i += 1) sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(1);

  // Find boss entity
  let bossIdx = -1;
  for (let i = 0; i < 160; i += 1) {
    const e = readEnemy(view, i);
    if (e.hpPct > 0 && e.type === ENEMY_TYPE.BOSS) {
      bossIdx = i;
      break;
    }
  }
  expect(bossIdx).toBeGreaterThanOrEqual(0);
  const boss0 = readEnemy(view, bossIdx);

  // Single dash alone from P0 on left side sets flank hit bit, not vulnerable
  const b0 = playerBase(0);
  const b1 = playerBase(1);
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = boss0.x - 68;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = boss0.y;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = 0;
  sim.applyInput(0, BUTTON_BIT.DASH, 127, 0);
  for (let i = 0; i < 10; i += 1) {
    sim.step(C.dt);
    sim.applyInput(0, 0, 127, 0);
  }
  const metaOneDash = readMetaTrailer(view);
  expect(metaOneDash.bossWeakPointMask & BOSS_WEAK_FLAG.FLANK_A_HIT).not.toBe(0);
  expect(metaOneDash.bossWeakPointMask & BOSS_WEAK_FLAG.VULNERABLE).toBe(0);

  // Second dash by P1 from opposite flank within 1.0s exposes weak point (VULNERABLE)
  const bossNow = readEnemy(view, bossIdx);
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = bossNow.x + 68;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = bossNow.y;
  sim.state[b1 + CYBER_PLAYER_OFFSET.heading] = Math.PI;
  sim.applyInput(1, BUTTON_BIT.DASH, -127, 0);
  for (let i = 0; i < 10; i += 1) {
    sim.step(C.dt);
    sim.applyInput(1, 0, -127, 0);
  }
  const metaDualDash = readMetaTrailer(view);
  expect(metaDualDash.bossWeakPointMask & BOSS_WEAK_FLAG.VULNERABLE).not.toBe(0);

  // Damage boss down past 66% -> Phase 2 (spawns carrier) and 33% -> Phase 3 (enraged)
  // Two players joined -> squadWeight = 2, bossHpMultiplier = 1 + 0.28 * (2 - 1) = 1.28
  const bossMaxHp = C.bossBaseHp * 1.28;
  sim.damageEnemyForTest(bossIdx, bossMaxHp * 0.4);
  sim.step(C.dt);
  sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(2);

  // Verify carrier was deployed upon entering Phase 2
  let carrierFound = false;
  for (let i = 0; i < 160; i += 1) {
    const e = readEnemy(view, i);
    if (e.hpPct > 0 && e.type === ENEMY_TYPE.CARRIER) {
      carrierFound = true;
      break;
    }
  }
  expect(carrierFound).toBe(true);

  sim.damageEnemyForTest(bossIdx, bossMaxHp * 0.4);
  sim.step(C.dt);
  sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(3);

  // Defeat boss and clear remaining wave enemies -> MATCH_OVER victory
  sim.clearAllEnemiesForTest();
  sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.phaseEnum]).toBe(CYBER_PHASE.MATCH_OVER);
  expect(sim.getMatchWon()).toBe(true);
});

test('concurrent multi-boss slots track independent laser sweeps, dual-dash vulnerability, Phase 2 carriers, and isolated death cleanup', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1, 2, 3], 909);
  sim.jumpToWave(8);
  sim.clearSpawnQueueForTest();
  const view = createAuxView(sim.auxState);

  // Spawn two Dreadnoughts on opposite sides of the arena (North & South) with high HP so auto-fire won't prematurely trigger Phase 2
  const bossA = sim.spawnEnemyForTest(ENEMY_TYPE.BOSS, 0, -240, Math.PI * 0.5, 2000);
  const bossB = sim.spawnEnemyForTest(ENEMY_TYPE.BOSS, 0, 240, -Math.PI * 0.5, 2000);
  expect(bossA).toBeGreaterThanOrEqual(0);
  expect(bossB).toBeGreaterThanOrEqual(0);
  expect(bossA).not.toBe(bossB);

  const b0 = playerBase(0);
  const b1 = playerBase(1);
  const b2 = playerBase(2);
  const b3 = playerBase(3);

  // Position P0 & P1 on opposite flanks of Boss A; P2 & P3 safely near Boss B (non-dashing initially)
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = -68;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = -240;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = 0;

  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = 68;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = -240;
  sim.state[b1 + CYBER_PLAYER_OFFSET.heading] = Math.PI;

  sim.state[b2 + CYBER_PLAYER_OFFSET.x] = -220;
  sim.state[b2 + CYBER_PLAYER_OFFSET.y] = 240;
  sim.state[b2 + CYBER_PLAYER_OFFSET.heading] = 0;

  sim.state[b3 + CYBER_PLAYER_OFFSET.x] = 220;
  sim.state[b3 + CYBER_PLAYER_OFFSET.y] = 240;
  sim.state[b3 + CYBER_PLAYER_OFFSET.heading] = Math.PI;

  // Dual-dash Boss A only (P0 from West, P1 from East)
  sim.applyInput(0, BUTTON_BIT.DASH, 127, 0);
  for (let i = 0; i < 8; i += 1) {
    sim.step(C.dt);
    sim.applyInput(0, 0, 127, 0);
  }
  const bossANow = readEnemy(view, bossA);
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = bossANow.x + 68;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = bossANow.y;
  sim.applyInput(1, BUTTON_BIT.DASH, -127, 0);
  for (let i = 0; i < 8; i += 1) {
    sim.step(C.dt);
    sim.applyInput(1, 0, -127, 0);
  }
  sim.applyInput(0, 0, 0, 0);
  sim.applyInput(1, 0, 0, 0);

  // Per-boss slot meta: Boss A is VULNERABLE while Boss B has weakMask === 0
  const slotA = readBossSlotMeta(view, 0);
  const slotB = readBossSlotMeta(view, 1);
  expect(slotA.enemyIdx).toBe(bossA);
  expect(slotB.enemyIdx).toBe(bossB);
  expect(slotA.weakMask & BOSS_WEAK_FLAG.VULNERABLE).not.toBe(0);
  expect(slotB.weakMask).toBe(0);

  // Boss A must be vulnerable while Boss B remains armored: fire identical RAIL shots at each
  const bossAPos = readEnemy(view, bossA);
  const bossBPos = readEnemy(view, bossB);
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = bossAPos.x - 160;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = bossAPos.y;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = 0;
  sim.state[b0 + CYBER_PLAYER_OFFSET.railCooldown] = 0;

  sim.state[b2 + CYBER_PLAYER_OFFSET.x] = bossBPos.x - 160;
  sim.state[b2 + CYBER_PLAYER_OFFSET.y] = bossBPos.y;
  sim.state[b2 + CYBER_PLAYER_OFFSET.heading] = 0;
  sim.state[b2 + CYBER_PLAYER_OFFSET.railCooldown] = 0;

  const hpABeforeRail = readEnemy(view, bossA).hpPct;
  const hpBBeforeRail = readEnemy(view, bossB).hpPct;
  sim.applyInput(0, BUTTON_BIT.RAIL, 0, 0);
  sim.applyInput(2, BUTTON_BIT.RAIL, 0, 0);
  sim.step(C.dt);
  sim.applyInput(0, 0, 0, 0);
  sim.applyInput(2, 0, 0, 0);

  const dmgDropA = hpABeforeRail - readEnemy(view, bossA).hpPct;
  const dmgDropB = hpBBeforeRail - readEnemy(view, bossB).hpPct;
  // Vulnerable Boss A takes full railDamage (90) while armored Boss B takes 0.6x (54)
  expect(dmgDropA).toBeGreaterThan(dmgDropB);

  // Park players facing away so auto-fire does not prematurely push bosses into Phase 2 before testing sweeps
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = -360;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = -360;
  sim.state[b0 + CYBER_PLAYER_OFFSET.heading] = Math.PI;
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = 360;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = -360;
  sim.state[b1 + CYBER_PLAYER_OFFSET.heading] = 0;
  sim.state[b2 + CYBER_PLAYER_OFFSET.x] = -360;
  sim.state[b2 + CYBER_PLAYER_OFFSET.y] = 360;
  sim.state[b2 + CYBER_PLAYER_OFFSET.heading] = Math.PI;
  sim.state[b3 + CYBER_PLAYER_OFFSET.x] = 360;
  sim.state[b3 + CYBER_PLAYER_OFFSET.y] = 360;
  sim.state[b3 + CYBER_PLAYER_OFFSET.heading] = 0;

  // Advance ~3.1s so BOTH Boss A and Boss B independently activate LASER_SWEEP simultaneously at distinct angles
  let sawBothSweeping = false;
  for (let i = 0; i < 420; i += 1) {
    if (i % 30 === 0) {
      sim.state[b0 + CYBER_PLAYER_OFFSET.hp] = C.playerMaxHp;
      sim.state[b1 + CYBER_PLAYER_OFFSET.hp] = C.playerMaxHp;
      sim.state[b2 + CYBER_PLAYER_OFFSET.hp] = C.playerMaxHp;
      sim.state[b3 + CYBER_PLAYER_OFFSET.hp] = C.playerMaxHp;
    }
    sim.step(C.dt);
    const eA = readEnemy(view, bossA);
    const eB = readEnemy(view, bossB);
    if (
      (eA.stateFlags & ENEMY_STATE_FLAG.LASER_SWEEP) !== 0 &&
      (eB.stateFlags & ENEMY_STATE_FLAG.LASER_SWEEP) !== 0
    ) {
      const sweepA = readBossSlotMeta(view, 0);
      const sweepB = readBossSlotMeta(view, 1);
      expect(sweepA.laserAngleU16).not.toBe(sweepB.laserAngleU16);
      sawBothSweeping = true;
      break;
    }
  }
  expect(sawBothSweeping).toBe(true);

  // Drop Boss A into Phase 2 (spawns carrier #1), then drop Boss B into Phase 2 (must also spawn carrier #2)
  const countCarriers = () => {
    let n = 0;
    for (let i = 0; i < 160; i += 1) {
      const e = readEnemy(view, i);
      if (e.hpPct > 0 && e.type === ENEMY_TYPE.CARRIER) n += 1;
    }
    return n;
  };
  const carriersBefore = countCarriers();
  expect(carriersBefore).toBe(0);
  sim.damageEnemyForTest(bossA, 850);
  sim.step(C.dt);
  sim.step(C.dt);
  expect(countCarriers()).toBeGreaterThan(carriersBefore);
  const carriersAfterA = countCarriers();

  sim.damageEnemyForTest(bossB, 850);
  sim.step(C.dt);
  sim.step(C.dt);
  expect(countCarriers()).toBeGreaterThan(carriersAfterA);

  // Kill Boss A completely: Boss B must remain alive and keep bossPhase >= 2 and meta bossHpPct > 0
  sim.damageEnemyForTest(bossA, 5000);
  sim.step(C.dt);
  sim.step(C.dt);
  expect(readEnemy(view, bossA).hpPct).toBe(0);
  expect(readEnemy(view, bossB).hpPct).toBeGreaterThan(0);
  expect(sim.state[CYBER_HEADER.bossPhase]).toBeGreaterThanOrEqual(2);
  expect(readMetaTrailer(view).bossHpPct).toBeGreaterThan(0);

  // Kill Boss B too -> bossPhase returns to 0 and meta bossHpPct returns to 0
  sim.damageEnemyForTest(bossB, 5000);
  sim.step(C.dt);
  sim.step(C.dt);
  expect(sim.state[CYBER_HEADER.bossPhase]).toBe(0);
  expect(readMetaTrailer(view).bossHpPct).toBe(0);
});

test('onBossDashHit resolves the specific collided enemyIdx even when multiple bosses overlap', () => {
  const w = createCyberWorld();
  w.pJoined[0] = 1;
  w.pJoined[1] = 1;

  // Spawn Boss A and Boss B at virtually the same position (overlapping)
  const bossEidA = spawnEnemyImmediate(w, ENEMY_TYPE.BOSS, 0, -200, 0);
  const bossEidB = spawnEnemyImmediate(w, ENEMY_TYPE.BOSS, 2, -202, 2);
  const slotA = findBossSlotByEnemyIdx(w, bossEidA);
  const slotB = findBossSlotByEnemyIdx(w, bossEidB);
  expect(slotA).toBeGreaterThanOrEqual(0);
  expect(slotB).toBeGreaterThanOrEqual(0);
  expect(slotA).not.toBe(slotB);

  // Player 0 dashes directly into Boss B (specifically passing bossEidB)
  onBossDashHit(w, 0, bossEidB, 2, -155);
  // Boss B must record the dash hit; Boss A must NOT receive it
  expect(w.bossFirstDashSlot[slotB]).toBe(0);
  expect(w.bossFirstDashSlot[slotA]).toBe(-1);
  expect(w.bossWeakMask[slotB]).toBe(BOSS_WEAK_FLAG.FLANK_A_HIT);
  expect(w.bossWeakMask[slotA]).toBe(0);

  // Player 1 dashes into Boss B from the opposite flank within 1.0s window
  onBossDashHit(w, 1, bossEidB, 2, -250);
  expect((w.bossWeakMask[slotB]! & BOSS_WEAK_FLAG.VULNERABLE) !== 0).toBe(true);
  expect(w.bossVulnerableTimer[slotB]).toBeGreaterThan(0);
  // Boss A remains un-hit and intact
  expect(w.bossWeakMask[slotA]).toBe(0);
  expect(w.bossVulnerableTimer[slotA]).toBe(0);
});

test('per-boss threat isolates aggro across players and supports split-tanking', () => {
  const w = createCyberWorld();
  w.pJoined[0] = 1;
  w.pJoined[1] = 1;

  const base0 = playerBase(0);
  const base1 = playerBase(1);
  w.state[base0 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.ACTIVE;
  w.state[base0 + CYBER_PLAYER_OFFSET.x] = 0;
  w.state[base0 + CYBER_PLAYER_OFFSET.y] = -300; // 100px from Boss A

  w.state[base1 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.ACTIVE;
  w.state[base1 + CYBER_PLAYER_OFFSET.x] = 0;
  w.state[base1 + CYBER_PLAYER_OFFSET.y] = 300; // 100px from Boss B

  const bossEidA = spawnEnemyImmediate(w, ENEMY_TYPE.BOSS, 0, -200, 0);
  const bossEidB = spawnEnemyImmediate(w, ENEMY_TYPE.BOSS, 0, 200, 2);
  const slotA = findBossSlotByEnemyIdx(w, bossEidA);
  const slotB = findBossSlotByEnemyIdx(w, bossEidB);

  // Player 0 deals damage/dash to Boss A; Player 1 deals damage/dash to Boss B
  const offA0 = slotA * C.maxPlayers + 0;
  const offB1 = slotB * C.maxPlayers + 1;
  w.bossThreat[offA0] = 500;
  w.bossThreat[offB1] = 500;

  // Boss A targets Player 0, Boss B targets Player 1
  expect(selectBossThreatTarget(w, slotA, 0, -200)).toBe(0);
  expect(selectBossThreatTarget(w, slotB, 0, 200)).toBe(1);

  // P0's massive threat on Boss A does NOT pull Boss B
  const offB0 = slotB * C.maxPlayers + 0;
  expect(w.bossThreat[offB0]).toBe(0);
  expect(selectBossThreatTarget(w, slotB, 0, 200)).not.toBe(0);
});

test('unengaged boss > 350px from all active players falls back to Core (target 8)', () => {
  const w = createCyberWorld();
  w.pJoined[0] = 1;
  const base0 = playerBase(0);
  w.state[base0 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.ACTIVE;
  w.state[base0 + CYBER_PLAYER_OFFSET.x] = 0;
  w.state[base0 + CYBER_PLAYER_OFFSET.y] = -380; // > 350px from (0, 0)

  const bossEid = spawnEnemyImmediate(w, ENEMY_TYPE.BOSS, 0, 0, 0);
  const slot = findBossSlotByEnemyIdx(w, bossEid);

  // With 0 threat and distance 380px > 350px (proximityBonus = 0), score = 0
  // selectBossThreatTarget bestScore starts at 0, so fallback 8 (Core) is chosen
  expect(selectBossThreatTarget(w, slot, 0, 0)).toBe(8);
});

test('slot reuse clears previous threat values for that boss slot', () => {
  const w = createCyberWorld();
  w.pJoined[0] = 1;
  const eid1 = spawnEnemyImmediate(w, ENEMY_TYPE.BOSS, 0, -200, 0);
  const slot = findBossSlotByEnemyIdx(w, eid1);
  const off = slot * C.maxPlayers + 0;
  w.bossThreat[off] = 750;

  // Clear or respawn in this slot
  clearBossSlot(w, slot);
  expect(w.bossThreat[off]).toBe(0);

  // Spawn new boss in the cleared slot
  const eid2 = spawnEnemyImmediate(w, ENEMY_TYPE.BOSS, 0, -200, 0);
  const slot2 = findBossSlotByEnemyIdx(w, eid2);
  expect(slot2).toBe(slot);
  expect(w.bossThreat[slot2 * C.maxPlayers + 0]).toBe(0);
});

test('Dreadnought sweeping laser deals 52 DPS to an active player inside the beam', () => {
  const w = createCyberWorld();
  w.pJoined[0] = 1;
  const base0 = playerBase(0);
  w.state[base0 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.ACTIVE;
  w.state[base0 + CYBER_PLAYER_OFFSET.x] = 150;
  w.state[base0 + CYBER_PLAYER_OFFSET.y] = 0;

  const bossEid = spawnEnemyImmediate(w, ENEMY_TYPE.BOSS, 0, 0, 0);
  const slot = findBossSlotByEnemyIdx(w, bossEid);
  w.bossLaserActive[slot] = 1;
  w.bossLaserTimer[slot] = 1.0;
  w.bossLaserAngle[slot] = 0;

  updateBossFsm(w, C.dt);
  expect(w.pPendingDamage[0]).toBeCloseTo(52 * C.dt, 5);
});

test('Dreadnought spawns with 600 base HP scaled by squad weight', () => {
  const solo = createCyberWorld();
  solo.squadWeight = 1.0;
  const soloBoss = spawnEnemyImmediate(solo, ENEMY_TYPE.BOSS, 0, -200, 0);
  expect(solo.eMaxHp[soloBoss]).toBeCloseTo(600, 5);
  expect(solo.eHp[soloBoss]).toBeCloseTo(600, 5);

  const duo = createCyberWorld();
  duo.squadWeight = 2.0;
  const duoBoss = spawnEnemyImmediate(duo, ENEMY_TYPE.BOSS, 0, -200, 0);
  expect(duo.eMaxHp[duoBoss]).toBeCloseTo(600 * 1.28, 5);
  expect(duo.eHp[duoBoss]).toBeCloseTo(600 * 1.28, 5);
});

test('Dreadnought laser stops on barricades, damages wall, blocks end-cap bleed-through, and clips at arena edge', () => {
  const w = createCyberWorld();
  w.pJoined[0] = 1;
  w.pJoined[1] = 1;
  const b0 = playerBase(0);
  const b1 = playerBase(1);
  w.state[b0 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.JOINED | CYBER_FLAG.ACTIVE;
  w.state[b1 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.JOINED | CYBER_FLAG.ACTIVE;

  // Place barricade at cell (28, 20): x in [160, 180], y in [0, 20]
  w.state[b0 + CYBER_PLAYER_OFFSET.x] = cellCenter(28) - (C.playerRadius + C.cellSize * 1.1);
  w.state[b0 + CYBER_PLAYER_OFFSET.y] = cellCenter(20);
  w.state[b0 + CYBER_PLAYER_OFFSET.heading] = 0;
  expect(tryPlaceBarricade(w, 0)).toBe(true);
  expect(w.bActive[0]).toBe(1);

  // P0 hugs the back of the barricade at x = 195 (within 40px of hit point x = 160, testing end-cap guard)
  w.state[b0 + CYBER_PLAYER_OFFSET.x] = 195;
  w.state[b0 + CYBER_PLAYER_OFFSET.y] = 10;
  // P1 stands uncovered in front of the barricade at x = 100
  w.state[b1 + CYBER_PLAYER_OFFSET.x] = 100;
  w.state[b1 + CYBER_PLAYER_OFFSET.y] = 10;

  // Boss at (0, 10) sweeps along exact +X (angle = 0 after sweepSpeed * dt advance)
  const bossEid = spawnEnemyImmediate(w, ENEMY_TYPE.BOSS, 0, 10, 0);
  const slot = findBossSlotByEnemyIdx(w, bossEid);
  w.bossLaserActive[slot] = 1;
  w.bossLaserTimer[slot] = 1.0;
  w.bossLaserAngle[slot] = -C.bossLaserSweepSpeed * C.dt;
  w.state[CYBER_HEADER.tickId] = 0; // divisible by 4 so laser tracer emits

  updateBossFsm(w, C.dt);
  tickAndSyncAuxState(w);

  // Barricade takes 52 DPS, covered P0 takes 0 damage, uncovered P1 takes 52 DPS
  expect(w.bPendingDamage[0]).toBeCloseTo(C.bossLaserDps * C.dt, 5);
  expect(w.pPendingDamage[0]).toBe(0);
  expect(w.pPendingDamage[1]).toBeCloseTo(C.bossLaserDps * C.dt, 5);

  // Synced laser length and tracer endpoint terminate at barricade front face (x = 160, len = 160)
  expect(w.bossLaserLen[slot]).toBeCloseTo(160, 2);
  expect(readBossLaserLen(w.auxView, slot)).toBeCloseTo(160, 1);

  let foundBossTracer = false;
  for (let i = 0; i < AUX_LAYOUT.MAX_PROJECTILES; i += 1) {
    const p = readProjectile(w.auxView, i);
    if (p.ttl > 0 && (p.flags & PROJECTILE_FLAG.BOSS_LASER) !== 0) {
      expect(p.x).toBeCloseTo(160, 1);
      expect(p.y).toBeCloseTo(10, 1);
      foundBossTracer = true;
      break;
    }
  }
  expect(foundBossTracer).toBe(true);

  // Arena boundary clip: unobstructed boss near +X wall at (300, 10) clips beam length to 100 (x = 400)
  const wEdge = createCyberWorld();
  const edgeBossEid = spawnEnemyImmediate(wEdge, ENEMY_TYPE.BOSS, 300, 10, 1);
  const edgeSlot = findBossSlotByEnemyIdx(wEdge, edgeBossEid);
  wEdge.bossLaserActive[edgeSlot] = 1;
  wEdge.bossLaserTimer[edgeSlot] = 1.0;
  wEdge.bossLaserAngle[edgeSlot] = -C.bossLaserSweepSpeed * C.dt;

  updateBossFsm(wEdge, C.dt);
  tickAndSyncAuxState(wEdge);
  expect(wEdge.bossLaserLen[edgeSlot]).toBeCloseTo(100, 2);
  expect(readBossLaserLen(wEdge.auxView, edgeSlot)).toBeCloseTo(100, 1);
});

test('EMP stun immediately cancels an active Boss sweeping laser and resets post-sweep cooldown', () => {
  const w = createCyberWorld();
  w.pJoined[0] = 1;
  const b0 = playerBase(0);
  w.state[b0 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.JOINED | CYBER_FLAG.ACTIVE;
  w.state[b0 + CYBER_PLAYER_OFFSET.x] = 150;
  w.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;

  const bossEid = spawnEnemyImmediate(w, ENEMY_TYPE.BOSS, 0, 0, 0);
  const slot = findBossSlotByEnemyIdx(w, bossEid);

  // Start sweeping laser on Phase 1 boss
  w.bossLaserActive[slot] = 1;
  w.bossLaserTimer[slot] = 1.2;
  w.bossLaserAngle[slot] = 0;
  w.eStateFlags[bossEid] = (w.eStateFlags[bossEid]! | ENEMY_STATE_FLAG.LASER_SWEEP) & 0x3f;

  updateBossFsm(w, C.dt);
  expect(w.bossLaserActive[slot]).toBe(1);
  expect(w.bossLaserLen[slot]).toBeGreaterThan(0);
  expect(w.eStateFlags[bossEid]! & ENEMY_STATE_FLAG.LASER_SWEEP).not.toBe(0);

  // Reset player pending damage, apply EMP stun, and step FSM
  w.pPendingDamage[0] = 0;
  w.eStunTimer[bossEid] = 1.5;
  updateBossFsm(w, C.dt);
  tickAndSyncAuxState(w);

  expect(w.bossLaserActive[slot]).toBe(0);
  expect(w.bossLaserLen[slot]).toBe(0);
  expect(readBossLaserLen(w.auxView, slot)).toBe(0);
  expect(w.eStateFlags[bossEid]! & ENEMY_STATE_FLAG.LASER_SWEEP).toBe(0);
  expect(readEnemy(w.auxView, bossEid).stateFlags & ENEMY_STATE_FLAG.LASER_SWEEP).toBe(0);
  expect(w.bossLaserTimer[slot]).toBeCloseTo(4.2, 5);
  expect(w.pPendingDamage[0]).toBe(0);

  // Phase 3 boss stunned mid-sweep gets 3.0s post-sweep cooldown
  w.eStunTimer[bossEid] = 0;
  w.eHp[bossEid] = w.eMaxHp[bossEid]! * 0.25;
  w.bossLaserActive[slot] = 1;
  w.bossLaserTimer[slot] = 1.0;
  w.bossLaserLen[slot] = 220;
  w.eStateFlags[bossEid] = (w.eStateFlags[bossEid]! | ENEMY_STATE_FLAG.LASER_SWEEP) & 0x3f;

  w.eStunTimer[bossEid] = 1.5;
  updateBossFsm(w, C.dt);

  expect(w.bossLaserActive[slot]).toBe(0);
  expect(w.bossLaserLen[slot]).toBe(0);
  expect(w.eStateFlags[bossEid]! & ENEMY_STATE_FLAG.LASER_SWEEP).toBe(0);
  expect(w.bossLaserTimer[slot]).toBeCloseTo(3.0, 5);
});
