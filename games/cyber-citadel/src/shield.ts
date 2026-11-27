import {
  AUX_LAYOUT,
  BARRICADE_FLAG,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_PLAYER_OFFSET,
} from './constants.ts';
import { cellCenter, worldToCell } from './flow-field.ts';
import { playerBase } from './state.ts';
import type { BarricadeRayHitOut, Vec2Out } from './types.ts';
import type { CyberWorld } from './world.ts';

/**
 * Raycasts from `(ox, oy)` along unit direction `(dx, dy)` up to `maxDist` against all
 * active barricade AABBs using the zero-allocation slab method.
 */
export function raycastBarricades(
  w: CyberWorld,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  out: BarricadeRayHitOut,
): void {
  let bestDist = maxDist > 0 ? maxDist : 0;
  let bestIdx = -1;

  if (w.barPool.activeCount() === 0 || bestDist <= 0) {
    out.dist = bestDist;
    out.barIdx = -1;
    return;
  }

  const halfCell = C.cellSize * 0.5;
  const maxB = AUX_LAYOUT.MAX_BARRICADES;
  const hasDx = Math.abs(dx) > 1e-8;
  const hasDy = Math.abs(dy) > 1e-8;
  const invDx = hasDx ? 1 / dx : 0;
  const invDy = hasDy ? 1 / dy : 0;

  for (let bi = 0; bi < maxB; bi += 1) {
    if (w.bActive[bi] === 0) continue;
    const bx = cellCenter(w.bCellX[bi]!);
    const by = cellCenter(w.bCellY[bi]!);
    const minX = bx - halfCell;
    const maxX = bx + halfCell;
    const minY = by - halfCell;
    const maxY = by + halfCell;

    let tMin = 0;
    let tMax = bestDist;

    if (!hasDx) {
      if (ox < minX || ox > maxX) continue;
    } else {
      let tx1 = (minX - ox) * invDx;
      let tx2 = (maxX - ox) * invDx;
      if (tx1 > tx2) {
        const tmp = tx1;
        tx1 = tx2;
        tx2 = tmp;
      }
      if (tx1 > tMin) tMin = tx1;
      if (tx2 < tMax) tMax = tx2;
      if (tMin > tMax) continue;
    }

    if (!hasDy) {
      if (oy < minY || oy > maxY) continue;
    } else {
      let ty1 = (minY - oy) * invDy;
      let ty2 = (maxY - oy) * invDy;
      if (ty1 > ty2) {
        const tmp = ty1;
        ty1 = ty2;
        ty2 = tmp;
      }
      if (ty1 > tMin) tMin = ty1;
      if (ty2 < tMax) tMax = ty2;
      if (tMin > tMax) continue;
    }

    if (tMin < bestDist) {
      bestDist = tMin;
      bestIdx = bi;
    }
  }

  out.dist = bestDist;
  out.barIdx = bestIdx;
}

export function circleOverlapsCellAabb(
  x: number,
  y: number,
  radius: number,
  bx: number,
  by: number,
): boolean {
  const halfCell = C.cellSize * 0.5;
  const dx = x - bx;
  const dy = y - by;
  const clampedDx = dx < -halfCell ? -halfCell : dx > halfCell ? halfCell : dx;
  const clampedDy = dy < -halfCell ? -halfCell : dy > halfCell ? halfCell : dy;
  const rx = dx - clampedDx;
  const ry = dy - clampedDy;
  return rx * rx + ry * ry < radius * radius;
}

export function circleOverlapsAnyBarricade(
  w: CyberWorld,
  x: number,
  y: number,
  radius: number,
): boolean {
  if (w.barPool.activeCount() === 0) return false;
  const maxB = AUX_LAYOUT.MAX_BARRICADES;
  for (let bi = 0; bi < maxB; bi += 1) {
    if (w.bActive[bi] === 0) continue;
    if (
      circleOverlapsCellAabb(x, y, radius, cellCenter(w.bCellX[bi]!), cellCenter(w.bCellY[bi]!))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves circle-vs-AABB collisions against active barricades with zero heap allocations.
 * Writes the clamped position to `out` and returns the closest barricade index that motion
 * `(moveX, moveY)` pushes into, or `-1` when none is pushed into.
 */
export function resolveBarricadeCollision(
  w: CyberWorld,
  x: number,
  y: number,
  prevX: number,
  prevY: number,
  radius: number,
  out: Vec2Out,
  moveX = 0,
  moveY = 0,
): number {
  if (w.barPool.activeCount() === 0) {
    out.x = x;
    out.y = y;
    return -1;
  }

  const halfCell = C.cellSize * 0.5;
  const radiusSq = radius * radius;
  const maxB = AUX_LAYOUT.MAX_BARRICADES;
  const origX = x;
  const origY = y;
  const checkDamage = moveX !== 0 || moveY !== 0;

  let curX = x;
  let curY = y;
  let closestBarIdx = -1;
  let closestBarDistSq = Number.POSITIVE_INFINITY;

  // Run up to two passes so multi-barricade corners and narrow gaps settle cleanly.
  for (let pass = 0; pass < 2; pass += 1) {
    let anyHit = false;
    for (let bi = 0; bi < maxB; bi += 1) {
      if (w.bActive[bi] === 0) continue;
      const bx = cellCenter(w.bCellX[bi]!);
      const by = cellCenter(w.bCellY[bi]!);
      const dx = curX - bx;
      const dy = curY - by;
      const clampedDx = dx < -halfCell ? -halfCell : dx > halfCell ? halfCell : dx;
      const clampedDy = dy < -halfCell ? -halfCell : dy > halfCell ? halfCell : dy;
      const rx = dx - clampedDx;
      const ry = dy - clampedDy;
      const distSq = rx * rx + ry * ry;
      if (distSq >= radiusSq) continue;

      anyHit = true;
      let nx = rx;
      let ny = ry;

      if (distSq > 1e-6) {
        const d = Math.sqrt(distSq);
        const push = radius - d;
        curX += (rx / d) * push;
        curY += (ry / d) * push;
      } else {
        // Center embedded inside AABB: clamp to entry side when prev was outside,
        // else push out along the minimum-penetration axis.
        const pdx = prevX - bx;
        const pdy = prevY - by;
        const pClampedDx = pdx < -halfCell ? -halfCell : pdx > halfCell ? halfCell : pdx;
        const pClampedDy = pdy < -halfCell ? -halfCell : pdy > halfCell ? halfCell : pdy;
        const prx = pdx - pClampedDx;
        const pry = pdy - pClampedDy;
        const pDistSq = prx * prx + pry * pry;
        if (pDistSq > 1e-6) {
          const pd = Math.sqrt(pDistSq);
          curX = bx + pClampedDx + (prx / pd) * radius;
          curY = by + pClampedDy + (pry / pd) * radius;
          nx = prx;
          ny = pry;
        } else {
          const penX = halfCell - Math.abs(dx);
          const penY = halfCell - Math.abs(dy);
          if (penX <= penY) {
            const signX = dx >= 0 ? 1 : -1;
            curX = bx + signX * (halfCell + radius);
            nx = signX;
            ny = 0;
          } else {
            const signY = dy >= 0 ? 1 : -1;
            curY = by + signY * (halfCell + radius);
            nx = 0;
            ny = signY;
          }
        }
      }

      if (checkDamage && moveX * nx + moveY * ny < 0) {
        const odx = origX - bx;
        const ody = origY - by;
        const oClampedDx = odx < -halfCell ? -halfCell : odx > halfCell ? halfCell : odx;
        const oClampedDy = ody < -halfCell ? -halfCell : ody > halfCell ? halfCell : ody;
        const orx = odx - oClampedDx;
        const ory = ody - oClampedDy;
        const oDistSq = orx * orx + ory * ory;
        if (oDistSq < closestBarDistSq) {
          closestBarDistSq = oDistSq;
          closestBarIdx = bi;
        }
      }
    }
    if (!anyHit) break;
  }

  out.x = curX;
  out.y = curY;
  return closestBarIdx;
}

function isCellValidForBarricade(w: CyberWorld, cx: number, cy: number): boolean {
  if (cx < 1 || cx >= C.gridCols - 1 || cy < 1 || cy >= C.gridRows - 1) return false;
  if (w.flowField.isBlocked(cx, cy)) return false;

  const xc = cellCenter(cx);
  const yc = cellCenter(cy);

  // FR-9.15: disallow placement on the Core ring (inside empRingRadius)
  if (xc * xc + yc * yc <= C.empRingRadius * C.empRingRadius) {
    return false;
  }

  // FR-9.15: disallow placement over living players (exact circle-vs-AABB)
  const state = w.state;
  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const base = playerBase(s);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
    if ((flags & (CYBER_FLAG.ACTIVE | CYBER_FLAG.DOWNED)) === 0) continue;
    if (
      circleOverlapsCellAabb(
        state[base + CYBER_PLAYER_OFFSET.x]!,
        state[base + CYBER_PLAYER_OFFSET.y]!,
        C.playerRadius,
        xc,
        yc,
      )
    ) {
      return false;
    }
  }

  // FR-9.15: disallow placement over living enemies (exact circle-vs-AABB)
  const enemyHitCount = w.gridHash.queryRadius(xc, yc, C.bossRadius + C.cellSize, w.queryBuf);
  for (let i = 0; i < enemyHitCount; i += 1) {
    const eid = w.queryBuf[i]!;
    if (!w.enemyPool.isActive(eid) || w.eHp[eid]! <= 0) continue;
    if (circleOverlapsCellAabb(w.eX[eid]!, w.eY[eid]!, w.eRadius[eid]!, xc, yc)) {
      return false;
    }
  }

  return true;
}

export function tryPlaceBarricade(w: CyberWorld, slot: number): boolean {
  const state = w.state;
  const base = playerBase(slot);
  const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
  if ((flags & CYBER_FLAG.ACTIVE) === 0) return false;
  if (w.pShieldCooldown[slot]! > 0) return false;

  const activeForPlayer = state[base + CYBER_PLAYER_OFFSET.barricades]!;
  if (activeForPlayer >= C.barricadeMaxPerPlayer) return false;

  const px = state[base + CYBER_PLAYER_OFFSET.x]!;
  const py = state[base + CYBER_PLAYER_OFFSET.y]!;
  const heading = state[base + CYBER_PLAYER_OFFSET.heading]!;
  const dist = C.playerRadius + C.cellSize * 1.1;
  const tx = px + Math.cos(heading) * dist;
  const ty = py + Math.sin(heading) * dist;
  const cx = worldToCell(tx);
  const cy = worldToCell(ty);

  if (!isCellValidForBarricade(w, cx, cy)) return false;

  const barIdx = w.barPool.acquire();
  if (barIdx < 0) return false;

  w.bActive[barIdx] = 1;
  w.bCellX[barIdx] = cx;
  w.bCellY[barIdx] = cy;
  w.bOwner[barIdx] = slot;
  w.bHp[barIdx] = C.barricadeHp;
  w.bMaxHp[barIdx] = C.barricadeHp;
  w.bTtl[barIdx] = C.barricadeTtlSec;
  w.bPendingDamage[barIdx] = 0;
  const orientVert = Math.abs(Math.cos(heading)) >= Math.abs(Math.sin(heading)) ? BARRICADE_FLAG.ORIENT_VERT : 0;
  w.bFlags[barIdx] = BARRICADE_FLAG.ACTIVE | orientVert;

  w.flowField.setBlocked(cx, cy, true);
  state[base + CYBER_PLAYER_OFFSET.barricades] = activeForPlayer + 1;
  w.pShieldCooldown[slot] = C.shieldCooldownSec;
  return true;
}

export function destroyBarricade(w: CyberWorld, barIdx: number): void {
  if (w.bActive[barIdx] === 0) return;
  const cx = w.bCellX[barIdx]!;
  const cy = w.bCellY[barIdx]!;
  const owner = w.bOwner[barIdx]!;
  w.bActive[barIdx] = 0;
  w.bHp[barIdx] = 0;
  w.bTtl[barIdx] = 0;
  w.bFlags[barIdx] = 0;
  w.bPendingDamage[barIdx] = 0;
  w.barPool.release(barIdx);
  w.flowField.setBlocked(cx, cy, false);

  if (owner >= 0 && owner < C.maxPlayers) {
    const base = playerBase(owner);
    const cur = w.state[base + CYBER_PLAYER_OFFSET.barricades]!;
    w.state[base + CYBER_PLAYER_OFFSET.barricades] = cur > 1 ? cur - 1 : 0;
  }
}

export function tickBarricades(w: CyberWorld, dt: number): void {
  const maxB = AUX_LAYOUT.MAX_BARRICADES;
  for (let i = 0; i < maxB; i += 1) {
    if (w.bActive[i] === 0) continue;
    const dmg = w.bPendingDamage[i]!;
    w.bPendingDamage[i] = 0;
    if (dmg > 0) {
      w.bHp[i] = w.bHp[i]! - dmg;
      w.bFlags[i] = w.bFlags[i]! | BARRICADE_FLAG.UNDER_ATTACK;
    } else {
      w.bFlags[i] = w.bFlags[i]! & ~BARRICADE_FLAG.UNDER_ATTACK;
    }
    w.bTtl[i] = w.bTtl[i]! - dt;
    if (w.bHp[i]! <= 0 || w.bTtl[i]! <= 0) {
      destroyBarricade(w, i);
    }
  }
}
