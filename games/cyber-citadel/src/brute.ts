import {
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_PLAYER_OFFSET,
  ENEMY_STATE_FLAG,
} from './constants.ts';
import { playerBase } from './state.ts';
import type { CyberWorld } from './world.ts';

/**
 * Pure zero-alloc 120-degree frontal shield check (+-60 deg, cos(60) = 0.5).
 * Avoids Math.acos and Math.sqrt on the hot path.
 */
export function hitsBruteFrontalShield(
  bruteX: number,
  bruteY: number,
  bruteHeading: number,
  shieldUp: boolean,
  spinTimer: number,
  srcX: number,
  srcY: number,
): boolean {
  if (!shieldUp || spinTimer > 0) return false;
  const vx = srcX - bruteX;
  const vy = srcY - bruteY;
  const distSq = vx * vx + vy * vy;
  if (distSq <= 1e-6) return false;
  const dot = vx * Math.cos(bruteHeading) + vy * Math.sin(bruteHeading);
  return dot > 0 && dot * dot >= C.bruteShieldCosHalfSq * distSq;
}

/**
 * Body-check spin: resets spinTimer to 1.0s (never stacks per FR-9.7) and flips heading 180 deg.
 */
export function applyBruteDashSpin(w: CyberWorld, enemyIdx: number): void {
  const alreadySpinning = w.eSpinTimer[enemyIdx]! > 0;
  w.eSpinTimer[enemyIdx] = C.bruteSpinSec;
  w.eStateFlags[enemyIdx] = (w.eStateFlags[enemyIdx]! | ENEMY_STATE_FLAG.SPUN) & 0x3f;
  if (!alreadySpinning) {
    let nextH = w.eHeading[enemyIdx]! + Math.PI;
    if (nextH > Math.PI) nextH -= Math.PI * 2;
    w.eHeading[enemyIdx] = nextH;
  }
}

/**
 * Selects nearest ACTIVE player within bruteAggroRadius (tie-break lowest slot), or 8 (Core).
 */
export function selectBruteTarget(w: CyberWorld, bruteX: number, bruteY: number): number {
  const aggroSq = C.bruteAggroRadius * C.bruteAggroRadius;
  let bestSlot = 8; // Core
  let bestDistSq = aggroSq;
  const state = w.state;

  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const base = playerBase(s);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
    if ((flags & CYBER_FLAG.ACTIVE) === 0) continue;
    const dx = state[base + CYBER_PLAYER_OFFSET.x]! - bruteX;
    const dy = state[base + CYBER_PLAYER_OFFSET.y]! - bruteY;
    const dSq = dx * dx + dy * dy;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestSlot = s;
    }
  }
  return bestSlot;
}
