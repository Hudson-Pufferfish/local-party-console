import { isBossVulnerable } from './boss.ts';
import {
  AUX_LAYOUT,
  BUTTON_BIT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PLAYER_OFFSET,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
  PROJECTILE_FLAG,
} from './constants.ts';
import { playerBase } from './state.ts';
import type { Vec2Out } from './types.ts';
import { spawnTracer, type CyberWorld } from './world.ts';

/**
 * Selects the 15-degree priority snap direction onto shielded brutes / armored boss
 * using INV-7 tie-breaks (Core distSq -> player distSq -> lowest pool index).
 */
export function selectRailSnapDirection(
  w: CyberWorld,
  px: number,
  py: number,
  heading: number,
  outDir: Vec2Out,
): void {
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  let bestId = -1;
  let bestCoreSq = Number.POSITIVE_INFINITY;
  let bestPlayerSq = Number.POSITIVE_INFINITY;

  const maxE = AUX_LAYOUT.MAX_ENEMIES;
  for (let i = 0; i < maxE; i += 1) {
    if (!w.enemyPool.isActive(i) || w.eHp[i]! <= 0) continue;
    const type = w.eType[i]!;
    const isShielded =
      (type === ENEMY_TYPE.BRUTE && (w.eStateFlags[i]! & ENEMY_STATE_FLAG.SHIELD_UP) !== 0) ||
      type === ENEMY_TYPE.BOSS;
    if (!isShielded) continue;

    const dx = w.eX[i]! - px;
    const dy = w.eY[i]! - py;
    const dSq = dx * dx + dy * dy;
    if (dSq <= 1e-6) continue;
    const dot = dx * hx + dy * hy;
    if (dot <= 0) continue;
    if (dot * dot < C.railSnapCosHalfSq * dSq) continue;

    const ex = w.eX[i]!;
    const ey = w.eY[i]!;
    const coreSq = ex * ex + ey * ey;
    if (
      coreSq < bestCoreSq ||
      (coreSq === bestCoreSq &&
        (dSq < bestPlayerSq || (dSq === bestPlayerSq && i < bestId)))
    ) {
      bestCoreSq = coreSq;
      bestPlayerSq = dSq;
      bestId = i;
    }
  }

  if (bestId >= 0) {
    const dx = w.eX[bestId]! - px;
    const dy = w.eY[bestId]! - py;
    const len = Math.hypot(dx, dy);
    if (len > 1e-5) {
      outDir.x = dx / len;
      outDir.y = dy / len;
      return;
    }
  }
  outDir.x = hx;
  outDir.y = hy;
}

export function computeRayToArenaEdge(
  px: number,
  py: number,
  dx: number,
  dy: number,
  outEnd: Vec2Out,
): void {
  const half = C.halfArena;
  let tMax = 1200;
  if (dx > 1e-6) {
    const t = (half - px) / dx;
    if (t < tMax) tMax = t;
  } else if (dx < -1e-6) {
    const t = (-half - px) / dx;
    if (t < tMax) tMax = t;
  }
  if (dy > 1e-6) {
    const t = (half - py) / dy;
    if (t < tMax) tMax = t;
  } else if (dy < -1e-6) {
    const t = (-half - py) / dy;
    if (t < tMax) tMax = t;
  }
  if (tMax < 0) tMax = 0;
  outEnd.x = px + dx * tMax;
  outEnd.y = py + dy * tMax;
}

export function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 1e-6) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

export function processRailStage(w: CyberWorld): void {
  const state = w.state;
  const dir = w.scratchDir;
  const end = w.scratchEnd;

  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    if ((w.pInputEdge[s]! & BUTTON_BIT.RAIL) === 0) continue;

    const base = playerBase(s);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
    if ((flags & CYBER_FLAG.ACTIVE) === 0) continue;
    if (state[base + CYBER_PLAYER_OFFSET.railCooldown]! > 0) continue;

    const px = state[base + CYBER_PLAYER_OFFSET.x]!;
    const py = state[base + CYBER_PLAYER_OFFSET.y]!;
    const heading = state[base + CYBER_PLAYER_OFFSET.heading]!;

    selectRailSnapDirection(w, px, py, heading, dir);
    const baseAngle = Math.atan2(dir.y, dir.x);
    const spreadAngle = C.railFanHalfAngle;

    // V-shape spread: left wing (-spread), center (0), right wing (+spread)
    const angles = [baseAngle, baseAngle - spreadAngle, baseAngle + spreadAngle];

    for (let r = 0; r < angles.length; r += 1) {
      const ang = angles[r]!;
      const rdx = Math.cos(ang);
      const rdy = Math.sin(ang);
      computeRayToArenaEdge(px, py, rdx, rdy, end);

      const hitPad = C.bossRadius + C.railHalfWidth;
      const count = w.gridHash.queryRay(px, py, end.x, end.y, w.queryBuf, hitPad);

      for (let i = 0; i < count; i += 1) {
        const eid = w.queryBuf[i]!;
        if (!w.enemyPool.isActive(eid) || w.eHp[eid]! <= 0) continue;
        const hitRadius = w.eRadius[eid]! + C.railHalfWidth;
        const distSq = pointToSegmentDistSq(w.eX[eid]!, w.eY[eid]!, px, py, end.x, end.y);
        if (distSq > hitRadius * hitRadius) continue;

        // Prevent multi-hit on same enemy in a single V-beam shot
        const curTick = (w.state[CYBER_HEADER.tickId]! | 0) + 1;
        if (w.eHitRailTick[eid] === curTick) continue;
        w.eHitRailTick[eid] = curTick;

        // RAIL unconditionally pierces brute frontal shields, breaks SHIELD_UP, and applies knockback
        const type = w.eType[eid]!;
        let dmg = C.railDamage;
        if (type === ENEMY_TYPE.BRUTE) {
          w.eStateFlags[eid] = (w.eStateFlags[eid]! & ~ENEMY_STATE_FLAG.SHIELD_UP) & 0x3f;
          w.eShieldBreakTimer[eid] = C.bruteShieldBreakSec;
        } else if (type === ENEMY_TYPE.BOSS && !isBossVulnerable(w, eid)) {
          dmg *= 0.6; // Rail deals stronger damage even vs boss armor
        }

        w.ePendingDamage[eid] = w.ePendingDamage[eid]! + dmg;
        w.squadDamageDealt += dmg;
        if (type === ENEMY_TYPE.BOSS) {
          w.pBossThreat[s] = w.pBossThreat[s]! + dmg;
        } else {
          w.eKnockX[eid] = w.eKnockX[eid]! + rdx * C.railKnockback;
          w.eKnockY[eid] = w.eKnockY[eid]! + rdy * C.railKnockback;
        }
      }

      spawnTracer(
        w,
        end.x,
        end.y,
        s,
        PROJECTILE_FLAG.ACTIVE | PROJECTILE_FLAG.RAIL_BEAM,
        C.railTracerTicks,
      );
    }

    state[base + CYBER_PLAYER_OFFSET.railCooldown] = C.railCooldownSec;
  }
}
