import {
  AUX_LAYOUT,
  BARRICADE_FLAG,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_PLAYER_OFFSET,
} from './constants.ts';
import { cellCenter, worldToCell } from './flow-field.ts';
import { playerBase } from './state.ts';
import type { CyberWorld } from './world.ts';

function isCellValidForBarricade(w: CyberWorld, cx: number, cy: number): boolean {
  if (cx < 1 || cx >= C.gridCols - 1 || cy < 1 || cy >= C.gridRows - 1) return false;
  if (w.flowField.isBlocked(cx, cy)) return false;

  const xc = cellCenter(cx);
  const yc = cellCenter(cy);

  // FR-9.15: disallow placement on the Core ring (inside empRingRadius)
  if (xc * xc + yc * yc <= C.empRingRadius * C.empRingRadius) {
    return false;
  }

  // FR-9.15: disallow placement over living players
  const state = w.state;
  const playerClearSq = (C.playerRadius + C.cellSize * 0.5) * (C.playerRadius + C.cellSize * 0.5);
  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const base = playerBase(s);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
    if ((flags & (CYBER_FLAG.ACTIVE | CYBER_FLAG.DOWNED)) === 0) continue;
    const dx = state[base + CYBER_PLAYER_OFFSET.x]! - xc;
    const dy = state[base + CYBER_PLAYER_OFFSET.y]! - yc;
    if (dx * dx + dy * dy < playerClearSq) return false;
  }

  // FR-9.15: disallow placement over living enemies
  const enemyHitCount = w.gridHash.queryRadius(xc, yc, C.bossRadius + C.cellSize, w.queryBuf);
  for (let i = 0; i < enemyHitCount; i += 1) {
    const eid = w.queryBuf[i]!;
    if (!w.enemyPool.isActive(eid) || w.eHp[eid]! <= 0) continue;
    const dx = w.eX[eid]! - xc;
    const dy = w.eY[eid]! - yc;
    const minR = w.eRadius[eid]! + C.cellSize * 0.5;
    if (dx * dx + dy * dy < minR * minR) return false;
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
