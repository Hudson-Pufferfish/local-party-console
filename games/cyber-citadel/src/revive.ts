import {
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PLAYER_OFFSET,
} from './constants.ts';
import { bleedOutDurationForWeight, respawnDurationForWeight } from './scaling.ts';
import { playerBase } from './state.ts';
import type { CyberWorld } from './world.ts';

const REVIVE_RANGE_SQ = C.reviveRange * C.reviveRange;

export function spawnPlayerNearCore(w: CyberWorld, slot: number): void {
  const angle = (slot / C.maxPlayers) * Math.PI * 2 - Math.PI * 0.5;
  const r = C.coreRadius + C.playerRadius + 16;
  const base = playerBase(slot);
  w.state[base + CYBER_PLAYER_OFFSET.x] = Math.cos(angle) * r;
  w.state[base + CYBER_PLAYER_OFFSET.y] = Math.sin(angle) * r;
  w.state[base + CYBER_PLAYER_OFFSET.heading] = angle;
}

export function cancelReviveChannelForReviver(w: CyberWorld, reviverSlot: number): void {
  const target = w.pReviveTarget[reviverSlot]!;
  if (target < 0) return;
  w.pReviveTarget[reviverSlot] = -1;
  w.state[playerBase(reviverSlot) + CYBER_PLAYER_OFFSET.reviveChannel] = 0;
  if (target < C.maxPlayers && w.pReviveOwner[target] === reviverSlot) {
    w.pReviveOwner[target] = -1;
    w.state[playerBase(target) + CYBER_PLAYER_OFFSET.reviveChannel] = 0;
  }
}

export function transitionPlayerToDowned(w: CyberWorld, slot: number): void {
  const state = w.state;
  const base = playerBase(slot);
  let flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
  if ((flags & CYBER_FLAG.DOWNED) !== 0 || (flags & CYBER_FLAG.RESPAWNING) !== 0) return;

  cancelReviveChannelForReviver(w, slot);
  flags = (flags & ~(CYBER_FLAG.ACTIVE | CYBER_FLAG.EMP_JOINED)) | CYBER_FLAG.DOWNED;
  state[base + CYBER_PLAYER_OFFSET.flags] = flags;
  state[base + CYBER_PLAYER_OFFSET.hp] = 0;
  state[base + CYBER_PLAYER_OFFSET.downTimer] = bleedOutDurationForWeight(w.squadWeight);
  state[base + CYBER_PLAYER_OFFSET.reviveChannel] = 0;
  w.pReviveOwner[slot] = -1;
  w.pDashTimer[slot] = 0;
}

/**
 * Button Y priority (a): returns true if a revive channel was started or already owned by this reviver.
 * Per FR-9.4, if another player already owns the revive channel for the downed ally, returns false
 * so this player can fall through to Core EMP join.
 */
export function tryStartReviveChannel(w: CyberWorld, reviverSlot: number): boolean {
  const state = w.state;
  const rBase = playerBase(reviverSlot);
  const rFlags = state[rBase + CYBER_PLAYER_OFFSET.flags]!;
  if ((rFlags & CYBER_FLAG.ACTIVE) === 0) return false;
  if ((rFlags & CYBER_FLAG.DISCONNECTED) !== 0 && (rFlags & CYBER_FLAG.STANDBY_BOT) === 0) {
    return false;
  }

  // Already channeling a valid downed ally
  if (w.pReviveTarget[reviverSlot]! >= 0) return true;

  const rx = state[rBase + CYBER_PLAYER_OFFSET.x]!;
  const ry = state[rBase + CYBER_PLAYER_OFFSET.y]!;

  let bestTarget = -1;
  let bestDistSq = REVIVE_RANGE_SQ;

  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (s === reviverSlot || w.pJoined[s] === 0) continue;
    const tBase = playerBase(s);
    const tFlags = state[tBase + CYBER_PLAYER_OFFSET.flags]!;
    if ((tFlags & CYBER_FLAG.DOWNED) === 0) continue;
    // FR-9.4: another player already owns this revive channel
    if (w.pReviveOwner[s]! >= 0 && w.pReviveOwner[s] !== reviverSlot) continue;

    const dx = state[tBase + CYBER_PLAYER_OFFSET.x]! - rx;
    const dy = state[tBase + CYBER_PLAYER_OFFSET.y]! - ry;
    const dSq = dx * dx + dy * dy;
    if (dSq <= bestDistSq) {
      bestDistSq = dSq;
      bestTarget = s;
    }
  }

  if (bestTarget < 0) return false;
  w.pReviveOwner[bestTarget] = reviverSlot;
  w.pReviveTarget[reviverSlot] = bestTarget;
  state[rBase + CYBER_PLAYER_OFFSET.reviveChannel] = 0;
  state[playerBase(bestTarget) + CYBER_PLAYER_OFFSET.reviveChannel] = 0;
  return true;
}

export function tickDownedReviveAndRespawn(w: CyberWorld, dt: number): void {
  const state = w.state;

  // 1. Advance active revive channels
  for (let r = 0; r < C.maxPlayers; r += 1) {
    const t = w.pReviveTarget[r]!;
    if (t < 0) continue;
    const rBase = playerBase(r);
    const tBase = playerBase(t);
    const rFlags = state[rBase + CYBER_PLAYER_OFFSET.flags]!;
    const tFlags = state[tBase + CYBER_PLAYER_OFFSET.flags]!;

    const reviverInvalid =
      (rFlags & CYBER_FLAG.ACTIVE) === 0 ||
      ((rFlags & CYBER_FLAG.DISCONNECTED) !== 0 && (rFlags & CYBER_FLAG.STANDBY_BOT) === 0);
    const targetInvalid = (tFlags & CYBER_FLAG.DOWNED) === 0;
    const dx = state[tBase + CYBER_PLAYER_OFFSET.x]! - state[rBase + CYBER_PLAYER_OFFSET.x]!;
    const dy = state[tBase + CYBER_PLAYER_OFFSET.y]! - state[rBase + CYBER_PLAYER_OFFSET.y]!;

    if (reviverInvalid || targetInvalid || dx * dx + dy * dy > REVIVE_RANGE_SQ) {
      cancelReviveChannelForReviver(w, r);
      continue;
    }

    const nextChannel = state[tBase + CYBER_PLAYER_OFFSET.reviveChannel]! + dt;
    if (nextChannel >= C.reviveChannelSec) {
      // Complete revive
      state[tBase + CYBER_PLAYER_OFFSET.flags] =
        (tFlags & ~CYBER_FLAG.DOWNED) | CYBER_FLAG.ACTIVE;
      state[tBase + CYBER_PLAYER_OFFSET.hp] = C.reviveRestoreHp;
      state[tBase + CYBER_PLAYER_OFFSET.downTimer] = 0;
      state[tBase + CYBER_PLAYER_OFFSET.reviveChannel] = 0;
      state[rBase + CYBER_PLAYER_OFFSET.reviveChannel] = 0;
      w.pReviveOwner[t] = -1;
      w.pReviveTarget[r] = -1;
    } else {
      state[tBase + CYBER_PLAYER_OFFSET.reviveChannel] = nextChannel;
      state[rBase + CYBER_PLAYER_OFFSET.reviveChannel] = nextChannel;
    }
  }

  // 2. Tick bleed-out & respawn timers
  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const base = playerBase(s);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;

    if ((flags & CYBER_FLAG.DOWNED) !== 0) {
      // FR-6 / FR-9.10: bleed-out pauses while downed player is DISCONNECTED (AWAY)
      if ((flags & CYBER_FLAG.DISCONNECTED) !== 0) continue;
      // Also pause bleed-out while actively being revived
      if (w.pReviveOwner[s]! >= 0) continue;

      const nextTimer = state[base + CYBER_PLAYER_OFFSET.downTimer]! - dt;
      if (nextTimer <= 0) {
        // Transition DOWNED -> RESPAWNING with 3% Core cost, 12% wave cap, and 1 HP floor (INV-5)
        const rawCost = C.coreMaxHp * C.respawnCoreCostPct;
        const capMax = C.coreMaxHp * C.respawnWaveCapPct;
        const capRem = capMax > w.waveRespawnSpent ? capMax - w.waveRespawnSpent : 0;
        const applied = rawCost < capRem ? rawCost : capRem;
        w.waveRespawnSpent += applied;
        const curCore = state[CYBER_HEADER.coreHp]!;
        if (curCore > 0) {
          const reduced = curCore - applied;
          state[CYBER_HEADER.coreHp] = reduced >= 1 ? reduced : 1;
        }

        state[base + CYBER_PLAYER_OFFSET.flags] =
          (flags & ~CYBER_FLAG.DOWNED) | CYBER_FLAG.RESPAWNING;
        state[base + CYBER_PLAYER_OFFSET.downTimer] = respawnDurationForWeight(w.squadWeight);
        state[base + CYBER_PLAYER_OFFSET.reviveChannel] = 0;
        w.pReviveOwner[s] = -1;
      } else {
        state[base + CYBER_PLAYER_OFFSET.downTimer] = nextTimer;
      }
    } else if ((flags & CYBER_FLAG.RESPAWNING) !== 0) {
      const nextTimer = state[base + CYBER_PLAYER_OFFSET.downTimer]! - dt;
      if (nextTimer <= 0) {
        state[base + CYBER_PLAYER_OFFSET.flags] =
          (flags & ~CYBER_FLAG.RESPAWNING) | CYBER_FLAG.ACTIVE;
        state[base + CYBER_PLAYER_OFFSET.hp] = C.playerMaxHp;
        state[base + CYBER_PLAYER_OFFSET.downTimer] = 0;
        spawnPlayerNearCore(w, s);
      } else {
        state[base + CYBER_PLAYER_OFFSET.downTimer] = nextTimer;
      }
    }
  }
}

export function respawnAllPlayersForWaveBreak(w: CyberWorld): void {
  const state = w.state;
  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    cancelReviveChannelForReviver(w, s);
    w.pReviveOwner[s] = -1;
    const base = playerBase(s);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
    const wasOut = (flags & (CYBER_FLAG.DOWNED | CYBER_FLAG.RESPAWNING)) !== 0;
    state[base + CYBER_PLAYER_OFFSET.flags] =
      (flags & ~(CYBER_FLAG.DOWNED | CYBER_FLAG.RESPAWNING | CYBER_FLAG.EMP_JOINED)) |
      CYBER_FLAG.ACTIVE;
    state[base + CYBER_PLAYER_OFFSET.hp] = C.playerMaxHp;
    state[base + CYBER_PLAYER_OFFSET.downTimer] = 0;
    state[base + CYBER_PLAYER_OFFSET.reviveChannel] = 0;
    if (wasOut) {
      spawnPlayerNearCore(w, s);
    }
  }
}
