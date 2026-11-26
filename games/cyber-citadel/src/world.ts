import { UniformGridHash } from '../../../shared/src/physics-2d/grid-hash.ts';
import type { PhysicsBody2D } from '../../../shared/src/physics-2d/motion.ts';
import {
  AUX_LAYOUT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_STATE_FLOATS,
  ENEMY_TYPE,
} from './constants.ts';
import { createFlowField } from './flow-field.ts';
import {
  clearBarricadeRaw,
  clearEnemyRaw,
  clearProjectileRaw,
  createAuxBuffer,
  createFreeList,
  encodeAngleU8,
  encodeFacingSector4,
  encodeHpPctU8,
  writeBarricadeRaw,
  writeEnemyRaw,
  writeMetaTrailerRaw,
  writeProjectileRaw,
  type FreeList,
} from './state.ts';
import type { FlowField, Vec2Out } from './types.ts';

export const SPAWN_QUEUE_CAP = 512;

export interface CyberWorld {
  readonly state: Float32Array;
  readonly auxState: Uint8Array;
  readonly auxView: DataView;
  readonly debugFlowField: boolean;
  readonly gridHash: UniformGridHash;
  readonly flowField: FlowField;
  readonly queryBuf: Int32Array;
  readonly scratchVec: Vec2Out;
  readonly scratchBody: PhysicsBody2D;
  readonly scratchDir: Vec2Out;
  readonly scratchEnd: Vec2Out;

  // Player runtime SoA (8 slots)
  readonly pJoined: Uint8Array;
  readonly pIsBot: Uint8Array;
  readonly pBotLevel: Uint8Array;
  readonly pInputAxisX: Int8Array;
  readonly pInputAxisY: Int8Array;
  readonly pInputButtons: Uint8Array;
  readonly pInputPrevButtons: Uint8Array;
  readonly pInputEdge: Uint8Array;
  readonly pVx: Float32Array;
  readonly pVy: Float32Array;
  readonly pDashTimer: Float32Array;
  readonly pDashDirX: Float32Array;
  readonly pDashDirY: Float32Array;
  readonly pShieldCooldown: Float32Array;
  readonly pAutoFireTimer: Float32Array;
  readonly pAutoFireTarget: Int16Array;
  readonly pReviveOwner: Int8Array; // for downed target slot -> reviver slot (-1 none)
  readonly pReviveTarget: Int8Array; // for reviver slot -> downed target slot (-1 none)
  readonly pDisconnectTimer: Float32Array;
  readonly pPendingDamage: Float32Array;
  readonly pBossThreat: Float32Array;

  // Enemy SoA (160 cap)
  readonly enemyPool: FreeList;
  readonly eType: Uint8Array;
  readonly eX: Float32Array;
  readonly eY: Float32Array;
  readonly eVx: Float32Array;
  readonly eVy: Float32Array;
  readonly eHeading: Float32Array;
  readonly eHp: Float32Array;
  readonly eMaxHp: Float32Array;
  readonly eRadius: Float32Array;
  readonly eSpeed: Float32Array;
  readonly eDps: Float32Array;
  readonly eStateFlags: Uint8Array;
  readonly eFlank: Uint8Array;
  readonly eTarget: Uint8Array;
  readonly eSpinTimer: Float32Array;
  readonly eStunTimer: Float32Array;
  readonly eShieldBreakTimer: Float32Array;
  readonly eCarrierTimer: Float32Array;
  readonly ePendingDamage: Float32Array;
  readonly eKnockX: Float32Array;
  readonly eKnockY: Float32Array;
  readonly eHitRailTick: Uint32Array;

  // Projectile / tracer SoA (256 cap)
  readonly projTtl: Uint8Array;
  readonly projX: Float32Array;
  readonly projY: Float32Array;
  readonly projOwner: Uint8Array;
  readonly projFlags: Uint8Array;
  projCursor: number;

  // Barricade SoA (24 cap)
  readonly barPool: FreeList;
  readonly bActive: Uint8Array;
  readonly bCellX: Uint8Array;
  readonly bCellY: Uint8Array;
  readonly bOwner: Uint8Array;
  readonly bHp: Float32Array;
  readonly bMaxHp: Float32Array;
  readonly bTtl: Float32Array;
  readonly bFlags: Uint8Array;
  readonly bPendingDamage: Float32Array;

  // Wave spawn queue ring buffer
  readonly spawnType: Uint8Array;
  readonly spawnFlank: Uint8Array;
  readonly spawnDelay: Float32Array;
  readonly flankGlow: Uint8Array;
  spawnHead: number;
  spawnTail: number;
  spawnCount: number;
  waveElapsed: number;
  waveActiveFlanks: number;

  // Boss runtime state
  bossEnemyIdx: number;
  bossLaserAngle: number;
  bossLaserTimer: number;
  bossLaserActive: boolean;
  bossCarrierTimer: number;
  bossFirstDashSlot: number;
  bossFirstDashAngle: number;
  bossDualDashTimer: number;
  bossVulnerableTimer: number;
  bossWeakMask: number;

  // Match scalar state
  rngState: number;
  connectedMask: number;
  squadWeight: number;
  waveRespawnSpent: number;
  empFiredThisWave: boolean;
  empJoinedCount: number;
  empRequiredCount: number;
  squadDamageDealt: number;
  corePendingDamage: number;
  matchWon: boolean;
}

export function createCyberWorld(debugFlowField = false): CyberWorld {
  const aux = createAuxBuffer(debugFlowField);
  const maxE = AUX_LAYOUT.MAX_ENEMIES;
  const maxP = AUX_LAYOUT.MAX_PROJECTILES;
  const maxB = AUX_LAYOUT.MAX_BARRICADES;

  return {
    state: new Float32Array(CYBER_STATE_FLOATS),
    auxState: aux.bytes,
    auxView: aux.view,
    debugFlowField,
    gridHash: new UniformGridHash({
      minX: -C.halfArena,
      minY: -C.halfArena,
      width: C.arenaSize,
      height: C.arenaSize,
      cellSize: C.cellSize,
      maxEntities: maxE,
      maxNodes: maxE * 25,
    }),
    flowField: createFlowField(),
    queryBuf: new Int32Array(maxE),
    scratchVec: { x: 0, y: 0 },
    scratchBody: { x: 0, y: 0, vx: 0, vy: 0 },
    scratchDir: { x: 1, y: 0 },
    scratchEnd: { x: 0, y: 0 },

    pJoined: new Uint8Array(C.maxPlayers),
    pIsBot: new Uint8Array(C.maxPlayers),
    pBotLevel: new Uint8Array(C.maxPlayers),
    pInputAxisX: new Int8Array(C.maxPlayers),
    pInputAxisY: new Int8Array(C.maxPlayers),
    pInputButtons: new Uint8Array(C.maxPlayers),
    pInputPrevButtons: new Uint8Array(C.maxPlayers),
    pInputEdge: new Uint8Array(C.maxPlayers),
    pVx: new Float32Array(C.maxPlayers),
    pVy: new Float32Array(C.maxPlayers),
    pDashTimer: new Float32Array(C.maxPlayers),
    pDashDirX: new Float32Array(C.maxPlayers),
    pDashDirY: new Float32Array(C.maxPlayers),
    pShieldCooldown: new Float32Array(C.maxPlayers),
    pAutoFireTimer: new Float32Array(C.maxPlayers),
    pAutoFireTarget: new Int16Array(C.maxPlayers),
    pReviveOwner: new Int8Array(C.maxPlayers),
    pReviveTarget: new Int8Array(C.maxPlayers),
    pDisconnectTimer: new Float32Array(C.maxPlayers),
    pPendingDamage: new Float32Array(C.maxPlayers),
    pBossThreat: new Float32Array(C.maxPlayers),

    enemyPool: createFreeList(maxE),
    eType: new Uint8Array(maxE),
    eX: new Float32Array(maxE),
    eY: new Float32Array(maxE),
    eVx: new Float32Array(maxE),
    eVy: new Float32Array(maxE),
    eHeading: new Float32Array(maxE),
    eHp: new Float32Array(maxE),
    eMaxHp: new Float32Array(maxE),
    eRadius: new Float32Array(maxE),
    eSpeed: new Float32Array(maxE),
    eDps: new Float32Array(maxE),
    eStateFlags: new Uint8Array(maxE),
    eFlank: new Uint8Array(maxE),
    eTarget: new Uint8Array(maxE),
    eSpinTimer: new Float32Array(maxE),
    eStunTimer: new Float32Array(maxE),
    eShieldBreakTimer: new Float32Array(maxE),
    eCarrierTimer: new Float32Array(maxE),
    ePendingDamage: new Float32Array(maxE),
    eKnockX: new Float32Array(maxE),
    eKnockY: new Float32Array(maxE),
    eHitRailTick: new Uint32Array(maxE),

    projTtl: new Uint8Array(maxP),
    projX: new Float32Array(maxP),
    projY: new Float32Array(maxP),
    projOwner: new Uint8Array(maxP),
    projFlags: new Uint8Array(maxP),
    projCursor: 0,

    barPool: createFreeList(maxB),
    bActive: new Uint8Array(maxB),
    bCellX: new Uint8Array(maxB),
    bCellY: new Uint8Array(maxB),
    bOwner: new Uint8Array(maxB),
    bHp: new Float32Array(maxB),
    bMaxHp: new Float32Array(maxB),
    bTtl: new Float32Array(maxB),
    bFlags: new Uint8Array(maxB),
    bPendingDamage: new Float32Array(maxB),

    spawnType: new Uint8Array(SPAWN_QUEUE_CAP),
    spawnFlank: new Uint8Array(SPAWN_QUEUE_CAP),
    spawnDelay: new Float32Array(SPAWN_QUEUE_CAP),
    flankGlow: new Uint8Array(4),
    spawnHead: 0,
    spawnTail: 0,
    spawnCount: 0,
    waveElapsed: 0,
    waveActiveFlanks: 1,

    bossEnemyIdx: -1,
    bossLaserAngle: 0,
    bossLaserTimer: 0,
    bossLaserActive: false,
    bossCarrierTimer: 0,
    bossFirstDashSlot: -1,
    bossFirstDashAngle: 0,
    bossDualDashTimer: 0,
    bossVulnerableTimer: 0,
    bossWeakMask: 0,

    rngState: C.defaultSeed,
    connectedMask: 0,
    squadWeight: 1,
    waveRespawnSpent: 0,
    empFiredThisWave: false,
    empJoinedCount: 0,
    empRequiredCount: 1,
    squadDamageDealt: 0,
    corePendingDamage: 0,
    matchWon: false,
  };
}

/** Deterministic Mulberry32 PRNG matching bomb-pass. */
export function nextRand(w: CyberWorld): number {
  w.rngState = (w.rngState + 0x6d2b79f5) >>> 0;
  let t = Math.imul(w.rngState ^ (w.rngState >>> 15), 1 | w.rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function spawnTracer(
  w: CyberWorld,
  x: number,
  y: number,
  ownerSlot: number,
  flags: number,
  ttlTicks: number,
): void {
  const idx = w.projCursor;
  w.projCursor = (idx + 1) % AUX_LAYOUT.MAX_PROJECTILES;
  w.projX[idx] = x;
  w.projY[idx] = y;
  w.projOwner[idx] = ownerSlot & 0x07;
  w.projFlags[idx] = flags & 0xf8;
  w.projTtl[idx] = ttlTicks > 255 ? 255 : ttlTicks;
}

export function tickAndSyncAuxState(w: CyberWorld): void {
  const view = w.auxView;
  const maxE = AUX_LAYOUT.MAX_ENEMIES;
  let bruteCursor = 0;

  for (let i = 0; i < maxE; i += 1) {
    if (!w.enemyPool.isActive(i) || w.eHp[i]! <= 0) {
      clearEnemyRaw(view, i);
      continue;
    }
    const hpPct = encodeHpPctU8(w.eHp[i]!, w.eMaxHp[i]!);
    const type = w.eType[i]!;
    const heading = w.eHeading[i]!;
    writeEnemyRaw(
      view,
      i,
      w.eX[i]!,
      w.eY[i]!,
      hpPct,
      type,
      w.eStateFlags[i]!,
      w.eFlank[i]!,
      w.eTarget[i]!,
      encodeFacingSector4(heading),
    );
    if ((type === ENEMY_TYPE.BRUTE || type === ENEMY_TYPE.BOSS) && bruteCursor < 32) {
      view.setUint8(AUX_LAYOUT.META_BRUTE_HEADING + bruteCursor, encodeAngleU8(heading));
      bruteCursor += 1;
    }
  }
  while (bruteCursor < 32) {
    view.setUint8(AUX_LAYOUT.META_BRUTE_HEADING + bruteCursor, 0);
    bruteCursor += 1;
  }

  const maxP = AUX_LAYOUT.MAX_PROJECTILES;
  for (let i = 0; i < maxP; i += 1) {
    const ttl = w.projTtl[i]!;
    if (ttl === 0) {
      clearProjectileRaw(view, i);
      continue;
    }
    writeProjectileRaw(view, i, w.projX[i]!, w.projY[i]!, w.projOwner[i]!, w.projFlags[i]!, ttl);
    w.projTtl[i] = ttl - 1;
  }

  const maxB = AUX_LAYOUT.MAX_BARRICADES;
  for (let i = 0; i < maxB; i += 1) {
    if (w.bActive[i] === 0) {
      clearBarricadeRaw(view, i);
      continue;
    }
    const hpPct = encodeHpPctU8(w.bHp[i]!, w.bMaxHp[i]!);
    const ttlSteps = Math.ceil(w.bTtl[i]! / 0.05);
    writeBarricadeRaw(
      view,
      i,
      w.bCellX[i]!,
      w.bCellY[i]!,
      w.bOwner[i]!,
      hpPct,
      ttlSteps,
      w.bFlags[i]!,
    );
  }

  const bossIdx = w.bossEnemyIdx;
  const bossHpPct =
    bossIdx >= 0 && w.enemyPool.isActive(bossIdx)
      ? encodeHpPctU8(w.eHp[bossIdx]!, w.eMaxHp[bossIdx]!)
      : 0;
  const twoPi = Math.PI * 2;
  const normLaser = ((w.bossLaserAngle % twoPi) + twoPi) % twoPi;
  const laserU16 = Math.round((normLaser / twoPi) * 65535) & 0xffff;

  writeMetaTrailerRaw(
    view,
    w.flankGlow[0]!,
    w.flankGlow[1]!,
    w.flankGlow[2]!,
    w.flankGlow[3]!,
    laserU16,
    w.bossWeakMask,
    bossHpPct,
    Math.floor(w.squadDamageDealt),
    w.enemyPool.activeCount() + w.spawnCount,
    w.empJoinedCount,
    w.empRequiredCount,
  );

  if (w.debugFlowField) {
    w.flowField.writeDebugBytes(w.auxState, AUX_LAYOUT.FLOW_DEBUG_OFFSET);
  }
}

export function rebuildEnemyGrid(w: CyberWorld): void {
  w.gridHash.clear();
  const maxE = AUX_LAYOUT.MAX_ENEMIES;
  for (let i = 0; i < maxE; i += 1) {
    if (!w.enemyPool.isActive(i) || w.eHp[i]! <= 0) continue;
    w.gridHash.insert(i, w.eX[i]!, w.eY[i]!, w.eRadius[i]!);
  }
}
