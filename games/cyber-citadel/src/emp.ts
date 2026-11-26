import {
  AUX_LAYOUT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PLAYER_OFFSET,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
} from './constants.ts';
import { playerBase } from './state.ts';
import type { CyberWorld } from './world.ts';

const EMP_RING_SQ = C.empRingRadius * C.empRingRadius;
const EMP_BLAST_SQ = C.empBlastRadius * C.empBlastRadius;

export function isInsideEmpRing(x: number, y: number): boolean {
  return x * x + y * y <= EMP_RING_SQ;
}

export function tryJoinEmp(w: CyberWorld, slot: number): boolean {
  if (w.empFiredThisWave) return false;
  const state = w.state;
  const base = playerBase(slot);
  const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
  if ((flags & CYBER_FLAG.ACTIVE) === 0) return false;
  if ((flags & CYBER_FLAG.DISCONNECTED) !== 0 && (flags & CYBER_FLAG.STANDBY_BOT) === 0) {
    return false;
  }
  const x = state[base + CYBER_PLAYER_OFFSET.x]!;
  const y = state[base + CYBER_PLAYER_OFFSET.y]!;
  if (!isInsideEmpRing(x, y)) return false;

  // FR-9.12: a bot or standby bot may only join if at least one active human already joined
  const isBotSlot = (flags & (CYBER_FLAG.IS_BOT | CYBER_FLAG.STANDBY_BOT)) !== 0;
  if (isBotSlot) {
    let humanJoined = false;
    for (let s = 0; s < C.maxPlayers; s += 1) {
      if (w.pJoined[s] === 0) continue;
      const sf = state[playerBase(s) + CYBER_PLAYER_OFFSET.flags]!;
      if (
        (sf & CYBER_FLAG.EMP_JOINED) !== 0 &&
        (sf & CYBER_FLAG.ACTIVE) !== 0 &&
        (sf & (CYBER_FLAG.IS_BOT | CYBER_FLAG.STANDBY_BOT | CYBER_FLAG.DISCONNECTED)) === 0
      ) {
        humanJoined = true;
        break;
      }
    }
    if (!humanJoined) return false;
  }

  state[base + CYBER_PLAYER_OFFSET.flags] = flags | CYBER_FLAG.EMP_JOINED;
  return true;
}

export function tickEmpSystem(w: CyberWorld, dt: number): void {
  const state = w.state;
  let livingCount = 0;
  let joinedCount = 0;
  let humanJoinedCount = 0;

  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const base = playerBase(s);
    let flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
    const isLiving = (flags & CYBER_FLAG.ACTIVE) !== 0;
    if (isLiving) livingCount += 1;

    if ((flags & CYBER_FLAG.EMP_JOINED) !== 0) {
      const x = state[base + CYBER_PLAYER_OFFSET.x]!;
      const y = state[base + CYBER_PLAYER_OFFSET.y]!;
      const awayHuman =
        (flags & CYBER_FLAG.DISCONNECTED) !== 0 && (flags & CYBER_FLAG.STANDBY_BOT) === 0;

      if (!isLiving || awayHuman || !isInsideEmpRing(x, y) || w.empFiredThisWave) {
        flags &= ~CYBER_FLAG.EMP_JOINED;
        state[base + CYBER_PLAYER_OFFSET.flags] = flags;
      } else {
        joinedCount += 1;
        if ((flags & (CYBER_FLAG.IS_BOT | CYBER_FLAG.STANDBY_BOT | CYBER_FLAG.DISCONNECTED)) === 0) {
          humanJoinedCount += 1;
        }
      }
    }
  }

  const required = Math.max(1, Math.ceil(0.5 * livingCount));
  w.empJoinedCount = joinedCount;
  w.empRequiredCount = required;

  if (w.empFiredThisWave) {
    state[CYBER_HEADER.empCharge] = 0;
    return;
  }

  const canCharge = livingCount > 0 && joinedCount >= required && humanJoinedCount >= 1;
  let charge = state[CYBER_HEADER.empCharge]!;

  if (canCharge) {
    charge += dt / C.empChargeSec;
    if (charge >= 1.0) {
      // Discharge EMP!
      state[CYBER_HEADER.empCharge] = 0;
      state[CYBER_HEADER.empFiredCount] = state[CYBER_HEADER.empFiredCount]! + 1;
      w.empFiredThisWave = true;

      for (let s = 0; s < C.maxPlayers; s += 1) {
        if (w.pJoined[s] === 0) continue;
        const base = playerBase(s);
        state[base + CYBER_PLAYER_OFFSET.flags] =
          state[base + CYBER_PLAYER_OFFSET.flags]! & ~CYBER_FLAG.EMP_JOINED;
      }

      const maxE = AUX_LAYOUT.MAX_ENEMIES;
      for (let i = 0; i < maxE; i += 1) {
        if (!w.enemyPool.isActive(i) || w.eHp[i]! <= 0) continue;
        const ex = w.eX[i]!;
        const ey = w.eY[i]!;
        if (ex * ex + ey * ey > EMP_BLAST_SQ) continue;
        const type = w.eType[i]!;
        if (type === ENEMY_TYPE.BRUTE) {
          w.ePendingDamage[i] = w.ePendingDamage[i]! + C.empDroneDamage * 0.5;
          w.squadDamageDealt += C.empDroneDamage * 0.5;
          w.eStunTimer[i] = C.empBruteStunSec;
          w.eShieldBreakTimer[i] = C.empBruteStunSec;
          w.eStateFlags[i] =
            ((w.eStateFlags[i]! & ~ENEMY_STATE_FLAG.SHIELD_UP) | ENEMY_STATE_FLAG.STUNNED) & 0x3f;
        } else if (type === ENEMY_TYPE.BOSS) {
          w.ePendingDamage[i] = w.ePendingDamage[i]! + C.empDroneDamage;
          w.squadDamageDealt += C.empDroneDamage;
          w.eStunTimer[i] = 1.5;
          w.eStateFlags[i] = (w.eStateFlags[i]! | ENEMY_STATE_FLAG.STUNNED) & 0x3f;
        } else {
          w.ePendingDamage[i] = w.ePendingDamage[i]! + C.empDroneDamage;
          w.squadDamageDealt += C.empDroneDamage;
        }
      }
      return;
    }
    state[CYBER_HEADER.empCharge] = charge;
  } else if (charge > 0) {
    // FR-9.11: pause & decay at 10% per second when dropping below threshold
    charge -= C.empDecayRatePerSec * dt;
    state[CYBER_HEADER.empCharge] = charge > 0 ? charge : 0;
  }
}
