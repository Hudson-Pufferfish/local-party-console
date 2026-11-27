import { expect, test } from 'vitest';
import {
  AUX_LAYOUT,
  BARRICADE_FLAG,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
  PROJECTILE_FLAG,
} from './constants.ts';
import {
  createAuxBuffer,
  createFreeList,
  decodeAngleU8,
  decodeCoordU16,
  encodeAngleU8,
  encodeCoordU16,
  encodeHpPctU8,
  readBarricade,
  readEnemy,
  readMetaTrailer,
  readProjectile,
  writeBarricade,
  writeEnemy,
  writeMetaTrailer,
  writeProjectile,
} from './state.ts';

test('fixed-point coordinate, angle, and HP encoders clamp safely with sub-pixel precision', () => {
  expect(encodeCoordU16(-400)).toBe(0);
  expect(encodeCoordU16(400)).toBe(65535);
  expect(encodeCoordU16(-9999)).toBe(0);
  expect(encodeCoordU16(9999)).toBe(65535);
  expect(encodeCoordU16(Number.NaN)).toBe(32768);

  const samples = [-400, -250.33, -0.01, 0, 123.45, 399.9, 400];
  for (const w of samples) {
    const rt = decodeCoordU16(encodeCoordU16(w));
    expect(Math.abs(rt - w)).toBeLessThan(0.015);
  }

  expect(encodeAngleU8(0)).toBe(0);
  expect(Math.abs(decodeAngleU8(encodeAngleU8(Math.PI)) - Math.PI)).toBeLessThan(0.03);
  expect(encodeAngleU8(-Math.PI * 0.5)).toBe(encodeAngleU8(Math.PI * 1.5));

  expect(encodeHpPctU8(0, 100)).toBe(0);
  expect(encodeHpPctU8(0.01, 100)).toBe(1);
  expect(encodeHpPctU8(100, 100)).toBe(255);
  expect(encodeHpPctU8(50, 100)).toBeGreaterThanOrEqual(127);
});

test('AUX_LAYOUT regions are non-overlapping and pack/unpack enemies, projectiles, barricades, and meta within 3072 bytes', () => {
  expect(AUX_LAYOUT.ENEMIES_OFFSET + AUX_LAYOUT.ENEMIES_BYTES).toBe(AUX_LAYOUT.PROJECTILES_OFFSET);
  expect(AUX_LAYOUT.PROJECTILES_OFFSET + AUX_LAYOUT.PROJECTILES_BYTES).toBe(AUX_LAYOUT.BARRICADES_OFFSET);
  expect(AUX_LAYOUT.BARRICADES_OFFSET + AUX_LAYOUT.BARRICADES_BYTES).toBe(AUX_LAYOUT.META_OFFSET);
  expect(AUX_LAYOUT.META_OFFSET + AUX_LAYOUT.META_BYTES).toBe(AUX_LAYOUT.AUX_CORE_BYTES);
  expect(AUX_LAYOUT.AUX_CORE_BYTES).toBe(3072);
  expect(AUX_LAYOUT.AUX_DEBUG_BYTES).toBe(4672);

  const aux = createAuxBuffer(false);
  expect(aux.bytes.byteLength).toBe(3072);
  const auxDebug = createAuxBuffer(true);
  expect(auxDebug.bytes.byteLength).toBe(4672);

  writeEnemy(aux.view, 15, {
    x: -128.5,
    y: 274.25,
    hpPct: 200,
    type: ENEMY_TYPE.BRUTE,
    stateFlags: ENEMY_STATE_FLAG.ALIVE | ENEMY_STATE_FLAG.SHIELD_UP,
    flankId: 2,
    target: 3,
    facingSector: 11,
  });
  const enemy = readEnemy(aux.view, 15);
  expect(Math.abs(enemy.x - -128.5)).toBeLessThan(0.015);
  expect(Math.abs(enemy.y - 274.25)).toBeLessThan(0.015);
  expect(enemy.hpPct).toBe(200);
  expect(enemy.type).toBe(ENEMY_TYPE.BRUTE);
  expect(enemy.stateFlags & ENEMY_STATE_FLAG.SHIELD_UP).not.toBe(0);
  expect(enemy.flankId).toBe(2);
  expect(enemy.target).toBe(3);
  expect(enemy.facingSector).toBe(11);

  writeProjectile(aux.view, 42, {
    x: 310,
    y: -95,
    ownerSlot: 5,
    flags: PROJECTILE_FLAG.ACTIVE | PROJECTILE_FLAG.RAIL_BEAM,
    ttl: 18,
  });
  const proj = readProjectile(aux.view, 42);
  expect(Math.abs(proj.x - 310)).toBeLessThan(0.015);
  expect(Math.abs(proj.y - -95)).toBeLessThan(0.015);
  expect(proj.ownerSlot).toBe(5);
  expect(proj.flags & PROJECTILE_FLAG.RAIL_BEAM).not.toBe(0);
  expect(proj.ttl).toBe(18);

  writeBarricade(aux.view, 7, {
    cellX: 18,
    cellY: 22,
    ownerSlot: 4,
    hpPct: 255,
    ttlSteps: 160,
    flags: BARRICADE_FLAG.ACTIVE | BARRICADE_FLAG.ORIENT_VERT,
  });
  const bar = readBarricade(aux.view, 7);
  expect(bar).toEqual({
    cellX: 18,
    cellY: 22,
    ownerSlot: 4,
    hpPct: 255,
    ttlSteps: 160,
    flags: BARRICADE_FLAG.ACTIVE | BARRICADE_FLAG.ORIENT_VERT,
  });

  writeMetaTrailer(aux.view, {
    flankGlow0: 10,
    flankGlow1: 90,
    flankGlow2: 180,
    flankGlow3: 255,
    bossLaserAngleU16: 12345,
    bossWeakPointMask: 0b101,
    bossHpPct: 170,
    squadDamageDealt: 987654,
    enemiesRemaining: 42,
    empRingJoinedCount: 3,
    empRingRequiredCount: 4,
  });
  const meta = readMetaTrailer(aux.view);
  expect(meta.flankGlow0).toBe(10);
  expect(meta.flankGlow3).toBe(255);
  expect(meta.bossLaserAngleU16).toBe(12345);
  expect(meta.bossWeakPointMask).toBe(0b101);
  expect(meta.bossHpPct).toBe(170);
  expect(meta.squadDamageDealt).toBe(987654);
  expect(meta.enemiesRemaining).toBe(42);
  expect(meta.empRingJoinedCount).toBe(3);
  expect(meta.empRingRequiredCount).toBe(4);
});

test('createFreeList enforces capacity, rejects double release, and leaks zero slots across cycles', () => {
  const pool = createFreeList(160);
  const acquired: number[] = [];
  for (let i = 0; i < 160; i += 1) {
    const id = pool.acquire();
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThan(160);
    acquired.push(id);
  }
  expect(new Set(acquired).size).toBe(160);
  expect(pool.acquire()).toBe(-1);
  expect(pool.activeCount()).toBe(160);

  pool.release(acquired[5]!);
  pool.release(acquired[5]!); // duplicate release must be ignored
  expect(pool.activeCount()).toBe(159);
  expect(pool.acquire()).toBe(acquired[5]);
  expect(pool.acquire()).toBe(-1);
});
