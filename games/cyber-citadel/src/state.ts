import {
  AUX_LAYOUT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_PLAYER_BASE,
  CYBER_PLAYER_STRIDE,
} from './constants.ts';

const COORD_SCALE_ENC = 65535 / C.arenaSize;
const COORD_SCALE_DEC = C.arenaSize / 65535;
const TWO_PI = Math.PI * 2;
const ANG_SCALE_ENC = 255 / TWO_PI;
const ANG_SCALE_DEC = TWO_PI / 255;

export interface AuxBuffer {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  readonly debugFlowField: boolean;
}

export interface EnemyEntry {
  x: number;
  y: number;
  hpPct: number;
  type: number;
  stateFlags: number;
  flankId: number;
  target: number;
  facingSector: number;
}

export interface ProjectileEntry {
  x: number;
  y: number;
  ownerSlot: number;
  flags: number;
  ttl: number;
}

export interface BarricadeEntry {
  cellX: number;
  cellY: number;
  ownerSlot: number;
  hpPct: number;
  ttlSteps: number;
  flags: number;
}

export interface MetaTrailer {
  flankGlow0: number;
  flankGlow1: number;
  flankGlow2: number;
  flankGlow3: number;
  bossLaserAngleU16: number;
  bossWeakPointMask: number;
  bossHpPct: number;
  squadDamageDealt: number;
  enemiesRemaining: number;
  empRingJoinedCount: number;
  empRingRequiredCount: number;
}

export interface BossSlotMeta {
  enemyIdx: number;
  weakMask: number;
  laserAngleU16: number;
}

export interface FreeList {
  readonly capacity: number;
  acquire(): number;
  release(index: number): void;
  reset(): void;
  isActive(index: number): boolean;
  activeCount(): number;
}

export function playerBase(slot: number): number {
  return CYBER_PLAYER_BASE + slot * CYBER_PLAYER_STRIDE;
}

export function encodeCoordU16(worldCoord: number): number {
  if (!Number.isFinite(worldCoord)) return 32768;
  const raw = Math.round((worldCoord + C.halfArena) * COORD_SCALE_ENC);
  if (raw <= 0) return 0;
  if (raw >= 65535) return 65535;
  return raw;
}

export function decodeCoordU16(u16: number): number {
  return u16 * COORD_SCALE_DEC - C.halfArena;
}

export function encodeAngleU8(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  const wrapped = ((radians % TWO_PI) + TWO_PI) % TWO_PI;
  const raw = Math.round(wrapped * ANG_SCALE_ENC);
  return raw >= 255 ? 255 : raw;
}

export function decodeAngleU8(u8: number): number {
  return (u8 & 0xff) * ANG_SCALE_DEC;
}

export function encodeFacingSector4(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  const wrapped = ((radians % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round((wrapped / TWO_PI) * 16) & 0x0f;
}

export function decodeFacingSector4(sector: number): number {
  return ((sector & 0x0f) / 16) * TWO_PI;
}

export function encodeHpPctU8(hp: number, maxHp: number): number {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || hp <= 0 || maxHp <= 0) {
    return 0;
  }
  const scaled = Math.ceil((hp / maxHp) * 255);
  if (scaled < 1) return 1;
  if (scaled > 255) return 255;
  return scaled;
}

export function createAuxBuffer(debugFlowField = false): AuxBuffer {
  const size = debugFlowField ? AUX_LAYOUT.AUX_DEBUG_BYTES : AUX_LAYOUT.AUX_CORE_BYTES;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { bytes, view, debugFlowField };
}

export function createAuxView(auxBytes: Uint8Array): DataView {
  return new DataView(auxBytes.buffer, auxBytes.byteOffset, auxBytes.byteLength);
}

/** Zero-allocation hot-path enemy writer. */
export function writeEnemyRaw(
  view: DataView,
  index: number,
  x: number,
  y: number,
  hpPct: number,
  type: number,
  stateFlags: number,
  flankId: number,
  target: number,
  facingSector: number,
): void {
  const off = AUX_LAYOUT.ENEMIES_OFFSET + index * AUX_LAYOUT.ENEMY_STRIDE;
  view.setUint16(off, encodeCoordU16(x), true);
  view.setUint16(off + 2, encodeCoordU16(y), true);
  view.setUint8(off + 4, hpPct & 0xff);
  view.setUint8(off + 5, type & 0xff);
  view.setUint8(off + 6, (stateFlags & 0x3f) | ((flankId & 0x03) << 6));
  view.setUint8(off + 7, (target & 0x0f) | ((facingSector & 0x0f) << 4));
}

export function clearEnemyRaw(view: DataView, index: number): void {
  const off = AUX_LAYOUT.ENEMIES_OFFSET + index * AUX_LAYOUT.ENEMY_STRIDE;
  view.setUint32(off, 0, true);
  view.setUint32(off + 4, 0, true);
}

export function writeEnemy(view: DataView, index: number, entry: EnemyEntry): void {
  writeEnemyRaw(
    view,
    index,
    entry.x,
    entry.y,
    entry.hpPct,
    entry.type,
    entry.stateFlags,
    entry.flankId,
    entry.target,
    entry.facingSector,
  );
}

export function readEnemy(view: DataView, index: number): EnemyEntry {
  const off = AUX_LAYOUT.ENEMIES_OFFSET + index * AUX_LAYOUT.ENEMY_STRIDE;
  const stateByte = view.getUint8(off + 6);
  const targetByte = view.getUint8(off + 7);
  return {
    x: decodeCoordU16(view.getUint16(off, true)),
    y: decodeCoordU16(view.getUint16(off + 2, true)),
    hpPct: view.getUint8(off + 4),
    type: view.getUint8(off + 5),
    stateFlags: stateByte & 0x3f,
    flankId: (stateByte >> 6) & 0x03,
    target: targetByte & 0x0f,
    facingSector: (targetByte >> 4) & 0x0f,
  };
}

/** Zero-allocation hot-path projectile/tracer writer. */
export function writeProjectileRaw(
  view: DataView,
  index: number,
  x: number,
  y: number,
  ownerSlot: number,
  flags: number,
  ttl: number,
): void {
  const off = AUX_LAYOUT.PROJECTILES_OFFSET + index * AUX_LAYOUT.PROJECTILE_STRIDE;
  view.setUint16(off, encodeCoordU16(x), true);
  view.setUint16(off + 2, encodeCoordU16(y), true);
  view.setUint8(off + 4, (ownerSlot & 0x07) | (flags & 0xf8));
  view.setUint8(off + 5, ttl > 255 ? 255 : ttl < 0 ? 0 : ttl & 0xff);
}

export function clearProjectileRaw(view: DataView, index: number): void {
  const off = AUX_LAYOUT.PROJECTILES_OFFSET + index * AUX_LAYOUT.PROJECTILE_STRIDE;
  view.setUint32(off, 0, true);
  view.setUint16(off + 4, 0, true);
}

export function writeProjectile(view: DataView, index: number, entry: ProjectileEntry): void {
  writeProjectileRaw(view, index, entry.x, entry.y, entry.ownerSlot, entry.flags, entry.ttl);
}

export function readProjectile(view: DataView, index: number): ProjectileEntry {
  const off = AUX_LAYOUT.PROJECTILES_OFFSET + index * AUX_LAYOUT.PROJECTILE_STRIDE;
  const ownerByte = view.getUint8(off + 4);
  return {
    x: decodeCoordU16(view.getUint16(off, true)),
    y: decodeCoordU16(view.getUint16(off + 2, true)),
    ownerSlot: ownerByte & 0x07,
    flags: ownerByte & 0xf8,
    ttl: view.getUint8(off + 5),
  };
}

/** Zero-allocation hot-path barricade writer. */
export function writeBarricadeRaw(
  view: DataView,
  index: number,
  cellX: number,
  cellY: number,
  ownerSlot: number,
  hpPct: number,
  ttlSteps: number,
  flags: number,
): void {
  const off = AUX_LAYOUT.BARRICADES_OFFSET + index * AUX_LAYOUT.BARRICADE_STRIDE;
  view.setUint8(off, cellX & 0xff);
  view.setUint8(off + 1, cellY & 0xff);
  view.setUint8(off + 2, ownerSlot & 0x07);
  view.setUint8(off + 3, hpPct & 0xff);
  view.setUint8(off + 4, ttlSteps > 255 ? 255 : ttlSteps < 0 ? 0 : ttlSteps & 0xff);
  view.setUint8(off + 5, flags & 0xff);
}

export function clearBarricadeRaw(view: DataView, index: number): void {
  const off = AUX_LAYOUT.BARRICADES_OFFSET + index * AUX_LAYOUT.BARRICADE_STRIDE;
  view.setUint32(off, 0, true);
  view.setUint16(off + 4, 0, true);
}

export function writeBarricade(view: DataView, index: number, entry: BarricadeEntry): void {
  writeBarricadeRaw(
    view,
    index,
    entry.cellX,
    entry.cellY,
    entry.ownerSlot,
    entry.hpPct,
    entry.ttlSteps,
    entry.flags,
  );
}

export function readBarricade(view: DataView, index: number): BarricadeEntry {
  const off = AUX_LAYOUT.BARRICADES_OFFSET + index * AUX_LAYOUT.BARRICADE_STRIDE;
  return {
    cellX: view.getUint8(off),
    cellY: view.getUint8(off + 1),
    ownerSlot: view.getUint8(off + 2) & 0x07,
    hpPct: view.getUint8(off + 3),
    ttlSteps: view.getUint8(off + 4),
    flags: view.getUint8(off + 5),
  };
}

export function writeMetaTrailerRaw(
  view: DataView,
  flankGlow0: number,
  flankGlow1: number,
  flankGlow2: number,
  flankGlow3: number,
  bossLaserAngleU16: number,
  bossWeakPointMask: number,
  bossHpPct: number,
  squadDamageDealt: number,
  enemiesRemaining: number,
  empRingJoinedCount: number,
  empRingRequiredCount: number,
): void {
  view.setUint8(AUX_LAYOUT.META_FLANK_GLOW, flankGlow0 & 0xff);
  view.setUint8(AUX_LAYOUT.META_FLANK_GLOW + 1, flankGlow1 & 0xff);
  view.setUint8(AUX_LAYOUT.META_FLANK_GLOW + 2, flankGlow2 & 0xff);
  view.setUint8(AUX_LAYOUT.META_FLANK_GLOW + 3, flankGlow3 & 0xff);
  view.setUint16(AUX_LAYOUT.META_BOSS_LASER_ANGLE, bossLaserAngleU16 & 0xffff, true);
  view.setUint8(AUX_LAYOUT.META_BOSS_WEAK_MASK, bossWeakPointMask & 0xff);
  view.setUint8(AUX_LAYOUT.META_BOSS_HP_PCT, bossHpPct & 0xff);
  view.setUint32(AUX_LAYOUT.META_SQUAD_DAMAGE, squadDamageDealt >>> 0, true);
  view.setUint16(AUX_LAYOUT.META_ENEMIES_REMAINING, enemiesRemaining & 0xffff, true);
  view.setUint8(AUX_LAYOUT.META_EMP_JOINED, empRingJoinedCount & 0xff);
  view.setUint8(AUX_LAYOUT.META_EMP_REQUIRED, empRingRequiredCount & 0xff);
}

export function writeMetaTrailer(view: DataView, meta: MetaTrailer): void {
  writeMetaTrailerRaw(
    view,
    meta.flankGlow0,
    meta.flankGlow1,
    meta.flankGlow2,
    meta.flankGlow3,
    meta.bossLaserAngleU16,
    meta.bossWeakPointMask,
    meta.bossHpPct,
    meta.squadDamageDealt,
    meta.enemiesRemaining,
    meta.empRingJoinedCount,
    meta.empRingRequiredCount,
  );
}

export function readMetaTrailer(view: DataView): MetaTrailer {
  return {
    flankGlow0: view.getUint8(AUX_LAYOUT.META_FLANK_GLOW),
    flankGlow1: view.getUint8(AUX_LAYOUT.META_FLANK_GLOW + 1),
    flankGlow2: view.getUint8(AUX_LAYOUT.META_FLANK_GLOW + 2),
    flankGlow3: view.getUint8(AUX_LAYOUT.META_FLANK_GLOW + 3),
    bossLaserAngleU16: view.getUint16(AUX_LAYOUT.META_BOSS_LASER_ANGLE, true),
    bossWeakPointMask: view.getUint8(AUX_LAYOUT.META_BOSS_WEAK_MASK),
    bossHpPct: view.getUint8(AUX_LAYOUT.META_BOSS_HP_PCT),
    squadDamageDealt: view.getUint32(AUX_LAYOUT.META_SQUAD_DAMAGE, true),
    enemiesRemaining: view.getUint16(AUX_LAYOUT.META_ENEMIES_REMAINING, true),
    empRingJoinedCount: view.getUint8(AUX_LAYOUT.META_EMP_JOINED),
    empRingRequiredCount: view.getUint8(AUX_LAYOUT.META_EMP_REQUIRED),
  };
}

/** Zero-allocation hot-path per-boss slot writer (4 slots x 4 bytes in META_BOSS_SLOTS). */
export function writeBossSlotMetaRaw(
  view: DataView,
  bossSlot: number,
  enemyIdx: number,
  weakMask: number,
  laserAngleU16: number,
): void {
  const off = AUX_LAYOUT.META_BOSS_SLOTS + bossSlot * AUX_LAYOUT.META_BOSS_SLOT_STRIDE;
  view.setUint8(off, enemyIdx >= 0 ? (enemyIdx + 1) & 0xff : 0);
  view.setUint8(off + 1, weakMask & 0xff);
  view.setUint16(off + 2, laserAngleU16 & 0xffff, true);
}

export function readBossSlotMeta(view: DataView, bossSlot: number): BossSlotMeta {
  const off = AUX_LAYOUT.META_BOSS_SLOTS + bossSlot * AUX_LAYOUT.META_BOSS_SLOT_STRIDE;
  const rawIdx = view.getUint8(off);
  return {
    enemyIdx: rawIdx === 0 ? -1 : rawIdx - 1,
    weakMask: view.getUint8(off + 1),
    laserAngleU16: view.getUint16(off + 2, true),
  };
}

export function createFreeList(capacity: number): FreeList {
  const stack = new Int16Array(capacity);
  const active = new Uint8Array(capacity);
  let top = capacity;

  function reset(): void {
    active.fill(0);
    // Push in reverse so lowest index is acquired first (deterministic).
    for (let i = 0; i < capacity; i += 1) {
      stack[i] = capacity - 1 - i;
    }
    top = capacity;
  }

  reset();

  return {
    capacity,
    acquire(): number {
      if (top <= 0) return -1;
      top -= 1;
      const idx = stack[top]!;
      active[idx] = 1;
      return idx;
    },
    release(index: number): void {
      if (index < 0 || index >= capacity || active[index] === 0) return;
      active[index] = 0;
      stack[top] = index;
      top += 1;
    },
    reset,
    isActive(index: number): boolean {
      return index >= 0 && index < capacity && active[index] === 1;
    },
    activeCount(): number {
      return capacity - top;
    },
  };
}
