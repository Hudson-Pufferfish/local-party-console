import type { ScreenSim } from '../../../screen/src/host-loop.ts';

export interface CyberSimOptions {
  readonly debugFlowField?: boolean;
}

export interface CyberRosterMeta {
  readonly botMask?: Uint8Array;
  readonly botLevels?: Uint8Array;
}

export interface CyberCitadelSimulation extends ScreenSim {
  readonly state: Float32Array;
  readonly auxState: Uint8Array;
  startMatch(
    slots: number[],
    seedOrRoster?: number | CyberRosterMeta,
    rosterOrSeed?: CyberRosterMeta | number,
  ): void;
  setConnectedMask(mask: number): void;
  getSquadWeight(): number;
  getMatchWon(): boolean;
  getDebugStats(): {
    activeEnemies: number;
    queuedEnemies: number;
    activeBarricades: number;
    squadDamage: number;
    waveRespawnSpent: number;
    flowRebuildCount: number;
  };
  // Deterministic test helpers (never called on runtime hot path)
  jumpToWave(wave: number): void;
  clearSpawnQueueForTest(): void;
  spawnEnemyForTest(
    type: number,
    x: number,
    y: number,
    heading?: number,
    hpOverride?: number,
  ): number;
  damageEnemyForTest(enemyIdx: number, damage: number): void;
  clearAllEnemiesForTest(): void;
  downPlayerForTest(slot: number): void;
}

export interface Vec2Out {
  x: number;
  y: number;
}

export interface BarricadeRayHitOut {
  dist: number;
  barIdx: number;
}

export interface FlowField {
  readonly blocked: Uint8Array;
  readonly cost: Uint16Array;
  readonly flowX: Float32Array;
  readonly flowY: Float32Array;
  readonly rebuildCount: number;
  reset(): void;
  setBlocked(cx: number, cy: number, isBlocked: boolean): void;
  isBlocked(cx: number, cy: number): boolean;
  markDirty(): void;
  rebuildIfDirty(): boolean;
  sample(x: number, y: number, out: Vec2Out): void;
  isUnreachable(x: number, y: number): boolean;
  isCellUnreachable(cx: number, cy: number): boolean;
  writeDebugBytes(auxState: Uint8Array, offset: number): void;
}
