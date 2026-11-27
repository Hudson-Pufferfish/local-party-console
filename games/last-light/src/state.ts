import {
  LAMP_FLAG,
  LAST_LIGHT_CONSTANTS as C,
  LIGHT_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PLAYER_BASE as PLAYER,
  LIGHT_PLAYER_OFFSET as OFF,
  LIGHT_PLAYER_STRIDE as STRIDE,
} from './constants.ts';

export function playerBase(slot: number): number {
  return PLAYER + slot * STRIDE;
}

export function readPlayerFlags(state: Float32Array, slot: number): number {
  return (state[playerBase(slot) + OFF.flags] ?? 0) | 0;
}

export function readPlayerLockTick(state: Float32Array, slot: number): number {
  return state[playerBase(slot) + OFF.lockTick] ?? -1;
}

export function readPlayerScore(state: Float32Array, slot: number): number {
  return state[playerBase(slot) + OFF.score] ?? 0;
}

export function readPlayerLastRoundPoints(state: Float32Array, slot: number): number {
  return state[playerBase(slot) + OFF.lastRoundPoints] ?? 0;
}

export function isPlayerLocked(state: Float32Array, slot: number): boolean {
  return (readPlayerFlags(state, slot) & LIGHT_FLAG.locked) !== 0;
}

export function isPlayerActive(state: Float32Array, slot: number): boolean {
  return (readPlayerFlags(state, slot) & LIGHT_FLAG.active) !== 0;
}

export function isPlayerJoined(state: Float32Array, slot: number): boolean {
  return (readPlayerFlags(state, slot) & LIGHT_FLAG.joined) !== 0;
}

export function readLockedMask(state: Float32Array): number {
  let mask = 0;
  for (let slot = 0; slot < C.maxPlayers; slot += 1) {
    if ((readPlayerFlags(state, slot) & LIGHT_FLAG.locked) !== 0) {
      mask |= 1 << slot;
    }
  }
  return mask;
}

export function readOutMask(state: Float32Array): number {
  let mask = 0;
  for (let slot = 0; slot < C.maxPlayers; slot += 1) {
    if ((readPlayerFlags(state, slot) & LIGHT_FLAG.out) !== 0) {
      mask |= 1 << slot;
    }
  }
  return mask;
}

export function readContenderMask(state: Float32Array): number {
  let mask = 0;
  for (let slot = 0; slot < C.maxPlayers; slot += 1) {
    if ((readPlayerFlags(state, slot) & LIGHT_FLAG.contender) !== 0) {
      mask |= 1 << slot;
    }
  }
  return mask;
}

export function readScoresArray(state: Float32Array): number[] {
  return [
    readPlayerScore(state, 0),
    readPlayerScore(state, 1),
    readPlayerScore(state, 2),
    readPlayerScore(state, 3),
    readPlayerScore(state, 4),
    readPlayerScore(state, 5),
    readPlayerScore(state, 6),
    readPlayerScore(state, 7),
  ];
}

export interface LastLightPrivateState {
  readonly buffer: Float32Array;
  readonly privateLockTick: Int32Array;
  getBlowoutTick(): number;
  setBlowoutTick(ticks: number): void;
  recordLock(slot: number, tick: number): boolean;
  revealLocksOnBlowout(): void;
  clearBlowoutLocks(): void;
}

/**
 * Owns the 88-float public state snapshot alongside private closure-only
 * blowout timing and unrevealed lock ticks so INV-8 holds by construction.
 */
export function createLastLightState(): LastLightPrivateState {
  const buffer = new Float32Array(C.stateFloats);
  const privateLockTick = new Int32Array(C.maxPlayers);
  privateLockTick.fill(-1);
  let secretBlowoutTick = 0;

  return {
    buffer,
    privateLockTick,
    getBlowoutTick(): number {
      return secretBlowoutTick;
    },
    setBlowoutTick(ticks: number): void {
      secretBlowoutTick = ticks | 0;
    },
    recordLock(slot: number, tick: number): boolean {
      if (slot < 0 || slot >= C.maxPlayers) return false;
      const base = playerBase(slot);
      const flags = (buffer[base + OFF.flags] ?? 0) | 0;
      if ((flags & LIGHT_FLAG.locked) !== 0) return false;
      privateLockTick[slot] = tick | 0;
      buffer[base + OFF.flags] = flags | LIGHT_FLAG.locked;
      // INV-8: Never expose lockTick while the lamp is LIT.
      buffer[base + OFF.lockTick] = -1;
      return true;
    },
    revealLocksOnBlowout(): void {
      const lampFlags = (buffer[H.lampFlags] ?? 0) | 0;
      buffer[H.lampFlags] = (lampFlags & ~(LAMP_FLAG.lit | LAMP_FLAG.flicker)) | LAMP_FLAG.blown;
      for (let slot = 0; slot < C.maxPlayers; slot += 1) {
        const base = playerBase(slot);
        const flags = (buffer[base + OFF.flags] ?? 0) | 0;
        if ((flags & LIGHT_FLAG.locked) !== 0) {
          buffer[base + OFF.lockTick] = privateLockTick[slot] ?? -1;
        } else {
          buffer[base + OFF.lockTick] = -1;
        }
      }
    },
    clearBlowoutLocks(): void {
      privateLockTick.fill(-1);
      for (let slot = 0; slot < C.maxPlayers; slot += 1) {
        const base = playerBase(slot);
        const flags = (buffer[base + OFF.flags] ?? 0) | 0;
        buffer[base + OFF.flags] = flags & ~(LIGHT_FLAG.locked | LIGHT_FLAG.out);
        buffer[base + OFF.lockTick] = -1;
      }
    },
  };
}
