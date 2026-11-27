import {
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_HEADER,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
} from './constants.ts';
import { worldToCell } from './flow-field.ts';
import {
  bossHpMultiplier,
  waveCadenceMultiplier,
  waveCountMultiplier,
  waveHpMultiplier,
} from './scaling.ts';
import { clearBossSlot, nextRand, SPAWN_QUEUE_CAP, type CyberWorld } from './world.ts';

export interface WaveDefinition {
  readonly wave: number;
  readonly flanks: number;
  readonly drones: number;
  readonly fastDrones: number;
  readonly brutes: number;
  readonly hasBoss: boolean;
  readonly spawnCadenceSec: number;
}

const WAVE_TABLE: readonly WaveDefinition[] = [
  { wave: 1, flanks: 1, drones: 21, fastDrones: 1, brutes: 5, hasBoss: false, spawnCadenceSec: 0.45 },
  { wave: 2, flanks: 2, drones: 29, fastDrones: 3, brutes: 6, hasBoss: false, spawnCadenceSec: 0.4 },
  { wave: 3, flanks: 2, drones: 25, fastDrones: 8, brutes: 7, hasBoss: false, spawnCadenceSec: 0.35 },
  { wave: 4, flanks: 3, drones: 19, fastDrones: 16, brutes: 10, hasBoss: false, spawnCadenceSec: 0.3 },
  { wave: 5, flanks: 3, drones: 24, fastDrones: 18, brutes: 10, hasBoss: false, spawnCadenceSec: 0.29 },
  { wave: 6, flanks: 4, drones: 20, fastDrones: 26, brutes: 13, hasBoss: false, spawnCadenceSec: 0.28 },
  { wave: 7, flanks: 4, drones: 28, fastDrones: 26, brutes: 15, hasBoss: true, spawnCadenceSec: 0.28 },
  { wave: 8, flanks: 4, drones: 24, fastDrones: 12, brutes: 7, hasBoss: true, spawnCadenceSec: 1.4 },
];

export function getWaveDefinition(wave: number): WaveDefinition {
  const idx = Math.max(1, Math.min(C.totalWaves, Math.trunc(wave))) - 1;
  return WAVE_TABLE[idx]!;
}

export function enqueueSpawn(w: CyberWorld, type: number, flank: number, delaySec: number): boolean {
  if (w.spawnCount >= SPAWN_QUEUE_CAP) return false;
  w.spawnType[w.spawnTail] = type;
  w.spawnFlank[w.spawnTail] = flank & 3;
  w.spawnDelay[w.spawnTail] = delaySec;
  w.spawnTail = (w.spawnTail + 1) % SPAWN_QUEUE_CAP;
  w.spawnCount += 1;
  return true;
}

export function clearSpawnQueue(w: CyberWorld): void {
  w.spawnHead = 0;
  w.spawnTail = 0;
  w.spawnCount = 0;
  w.flankGlow.fill(0);
}

export function flankSpawnPoint(w: CyberWorld, flank: number): { x: number; y: number } {
  const spread = (nextRand(w) * 2 - 1) * 180;
  const edge = C.halfArena - 24;
  const f = flank & 3;
  if (f === 0) return { x: spread, y: -edge }; // N
  if (f === 1) return { x: edge, y: spread }; // E
  if (f === 2) return { x: spread, y: edge }; // S
  return { x: -edge, y: spread }; // W
}

export function populateWaveSpawns(w: CyberWorld, wave: number): void {
  clearSpawnQueue(w);
  const def = getWaveDefinition(wave);
  w.waveElapsed = 0;
  w.waveActiveFlanks = def.flanks;
  w.waveRespawnSpent = 0;
  w.empFiredThisWave = false;
  w.state[CYBER_HEADER.empCharge] = 0;

  const countMult = waveCountMultiplier(w.squadWeight);
  const cadence = def.spawnCadenceSec * waveCadenceMultiplier(w.squadWeight);
  const drones = Math.max(1, Math.round(def.drones * countMult));
  const fastDrones = def.fastDrones > 0 ? Math.max(1, Math.round(def.fastDrones * countMult)) : 0;
  const brutes = def.brutes > 0 ? Math.max(1, Math.round(def.brutes * countMult)) : 0;

  let delay = C.flankTelegraphSec;
  if (def.hasBoss && def.wave === 8) {
    // Wave 8 Boss 1: flank 0 (North) at delay = C.flankTelegraphSec (2.0s)
    enqueueSpawn(w, ENEMY_TYPE.BOSS, 0, delay);
    delay += 2.5; // First minions at 4.5s, after the North boss intro at 2.0s
  }

  let dLeft = drones;
  let fLeft = fastDrones;
  let bLeft = brutes;
  let turn = 0;

  const totalMinions = drones + fastDrones + brutes;
  // For Wave 7, spawn boss near the end alongside the final few enemies (~88% through minion spawns)
  const bossSpawnThreshold = def.wave === 7 ? Math.max(1, Math.round(totalMinions * 0.88)) : -1;
  let bossSpawnedInWave7 = false;
  // For Wave 8, interleave Boss 2 (South @ 25.0s), Boss 3 (East @ 50.0s), and Boss 4 (West @ 65.0s) in FIFO delay order
  const WAVE8_BOSS2_DELAY = 25.0;
  const WAVE8_BOSS3_DELAY = 50.0;
  const WAVE8_BOSS4_DELAY = 65.0;
  let wave8Boss2Queued = false;
  let wave8Boss3Queued = false;
  let wave8Boss4Queued = false;

  while (dLeft > 0 || fLeft > 0 || bLeft > 0) {
    const minionsSpawned = totalMinions - (dLeft + fLeft + bLeft);
    if (def.hasBoss && def.wave === 7 && !bossSpawnedInWave7 && minionsSpawned >= bossSpawnThreshold) {
      enqueueSpawn(w, ENEMY_TYPE.BOSS, 0, delay);
      bossSpawnedInWave7 = true;
    }
    if (def.hasBoss && def.wave === 8) {
      if (!wave8Boss2Queued && delay >= WAVE8_BOSS2_DELAY) {
        enqueueSpawn(w, ENEMY_TYPE.BOSS, 2, WAVE8_BOSS2_DELAY);
        wave8Boss2Queued = true;
      }
      if (!wave8Boss3Queued && delay >= WAVE8_BOSS3_DELAY) {
        enqueueSpawn(w, ENEMY_TYPE.BOSS, 1, WAVE8_BOSS3_DELAY);
        wave8Boss3Queued = true;
      }
      if (!wave8Boss4Queued && delay >= WAVE8_BOSS4_DELAY) {
        enqueueSpawn(w, ENEMY_TYPE.BOSS, 3, WAVE8_BOSS4_DELAY);
        wave8Boss4Queued = true;
      }
    }

    const flank = turn % def.flanks;
    if (bLeft > 0 && (turn % 4 === 2 || (dLeft === 0 && fLeft === 0))) {
      enqueueSpawn(w, ENEMY_TYPE.BRUTE, flank, delay);
      bLeft -= 1;
    } else if (fLeft > 0 && (turn % 2 === 1 || dLeft === 0)) {
      enqueueSpawn(w, ENEMY_TYPE.FAST_DRONE, flank, delay);
      fLeft -= 1;
    } else if (dLeft > 0) {
      enqueueSpawn(w, ENEMY_TYPE.DRONE, flank, delay);
      dLeft -= 1;
    }
    delay += cadence;
    turn += 1;
  }

  if (def.hasBoss && def.wave === 7 && !bossSpawnedInWave7) {
    enqueueSpawn(w, ENEMY_TYPE.BOSS, 0, delay);
  }
  if (def.hasBoss && def.wave === 8) {
    if (!wave8Boss2Queued) {
      enqueueSpawn(w, ENEMY_TYPE.BOSS, 2, WAVE8_BOSS2_DELAY);
    }
    if (!wave8Boss3Queued) {
      enqueueSpawn(w, ENEMY_TYPE.BOSS, 1, WAVE8_BOSS3_DELAY);
    }
    if (!wave8Boss4Queued) {
      enqueueSpawn(w, ENEMY_TYPE.BOSS, 3, WAVE8_BOSS4_DELAY);
    }
  }
}

export function spawnEnemyImmediate(
  w: CyberWorld,
  type: number,
  x: number,
  y: number,
  flank: number,
  headingOverride?: number,
  hpOverride?: number,
): number {
  let bossSlot = -1;
  if (type === ENEMY_TYPE.BOSS) {
    for (let b = 0; b < C.maxBosses; b += 1) {
      if (w.bossEnemyIdx[b] === -1) {
        bossSlot = b;
        break;
      }
    }
    if (bossSlot < 0) return -1;
  }

  const id = w.enemyPool.acquire();
  if (id < 0) return -1;

  const hpMult = waveHpMultiplier(w.squadWeight);
  let hp: number;
  let speed: number;
  let radius: number;
  let dps: number;
  let flags: number = ENEMY_STATE_FLAG.ALIVE;

  if (type === ENEMY_TYPE.FAST_DRONE) {
    hp = C.fastDroneBaseHp * hpMult;
    speed = C.fastDroneSpeed;
    radius = C.fastDroneRadius;
    dps = C.fastDroneDps;
  } else if (type === ENEMY_TYPE.BRUTE) {
    hp = C.bruteBaseHp * hpMult;
    speed = C.bruteSpeed;
    radius = C.bruteRadius;
    dps = C.bruteDps;
    flags |= ENEMY_STATE_FLAG.SHIELD_UP;
  } else if (type === ENEMY_TYPE.CARRIER) {
    hp = C.carrierBaseHp * hpMult;
    speed = C.carrierSpeed;
    radius = C.carrierRadius;
    dps = C.droneDps;
  } else if (type === ENEMY_TYPE.BOSS) {
    hp = C.bossBaseHp * bossHpMultiplier(w.squadWeight);
    speed = C.bossSpeed;
    radius = C.bossRadius;
    dps = C.bossMeleeDps;
    clearBossSlot(w, bossSlot);
    w.bossEnemyIdx[bossSlot] = id;
    w.bossPhase[bossSlot] = 1;
    if (w.state[CYBER_HEADER.bossPhase]! < 1) {
      w.state[CYBER_HEADER.bossPhase] = 1;
    }
  } else {
    hp = C.droneBaseHp * hpMult;
    speed = C.droneSpeed;
    radius = C.droneRadius;
    dps = C.droneDps;
  }

  if (hpOverride !== undefined && hpOverride > 0) {
    hp = hpOverride;
  }

  w.eType[id] = type;
  w.eX[id] = x;
  w.eY[id] = y;
  w.eVx[id] = 0;
  w.eVy[id] = 0;
  w.eHeading[id] = headingOverride !== undefined ? headingOverride : Math.atan2(-y, -x);
  w.eHp[id] = hp;
  w.eMaxHp[id] = hp;
  w.eRadius[id] = radius;
  w.eSpeed[id] = speed;
  w.eDps[id] = dps;
  w.eStateFlags[id] = flags;
  w.eFlank[id] = flank & 3;
  w.eTarget[id] = 8; // Core
  w.eSpinTimer[id] = 0;
  w.eStunTimer[id] = 0;
  w.eShieldBreakTimer[id] = 0;
  w.eCarrierTimer[id] = C.carrierSpawnIntervalSec;
  w.ePendingDamage[id] = 0;
  w.eKnockX[id] = 0;
  w.eKnockY[id] = 0;
  return id;
}

export function tickWaveSpawns(w: CyberWorld, dt: number): void {
  w.waveElapsed += dt;

  // Update 2.0s corridor telegraph glow (ramps 0..255 during [0, 2.0s], pulses lightly while queue remains)
  const telegraph = C.flankTelegraphSec;
  let glowVal = 0;
  if (w.spawnCount > 0) {
    if (w.waveElapsed < telegraph) {
      glowVal = Math.min(255, Math.round((w.waveElapsed / telegraph) * 255));
    } else {
      glowVal = 110;
    }
  }
  for (let f = 0; f < 4; f += 1) {
    w.flankGlow[f] = f < w.waveActiveFlanks ? glowVal : 0;
  }

  // Drain due spawns; delay 1 tick if enemy pool is at 160 cap or spawn cell is blocked (FR-9.16)
  let spawnedThisTick = 0;
  while (w.spawnCount > 0 && spawnedThisTick < 4) {
    const head = w.spawnHead;
    if (w.spawnDelay[head]! > w.waveElapsed) break;
    if (w.enemyPool.activeCount() >= w.enemyPool.capacity) break;

    const flank = w.spawnFlank[head]!;
    const type = w.spawnType[head]!;

    // Compute deterministic spawn point using scratch coordinates without allocating
    const spread = (nextRand(w) * 2 - 1) * 180;
    const edge = C.halfArena - 24;
    let sx = 0;
    let sy = 0;
    if (flank === 0) {
      sx = spread;
      sy = -edge;
    } else if (flank === 1) {
      sx = edge;
      sy = spread;
    } else if (flank === 2) {
      sx = spread;
      sy = edge;
    } else {
      sx = -edge;
      sy = spread;
    }

    const cx = worldToCell(sx);
    const cy = worldToCell(sy);
    if (w.flowField.isBlocked(cx, cy)) {
      // Barricade on spawn corridor -> delay 1 tick (FR-9.16)
      break;
    }

    const eid = spawnEnemyImmediate(w, type, sx, sy, flank);
    if (eid < 0) break;

    w.spawnHead = (head + 1) % SPAWN_QUEUE_CAP;
    w.spawnCount -= 1;
    spawnedThisTick += 1;
  }
}
