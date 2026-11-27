import { clampBoxBoundary } from '../../../shared/src/physics-2d/boundary.ts';
import { onBossDashHit } from './boss.ts';
import { applyBruteDashSpin } from './brute.ts';
import {
  AUX_LAYOUT,
  BUTTON_BIT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_PLAYER_OFFSET,
  ENEMY_TYPE,
} from './constants.ts';
import { cellCenter } from './flow-field.ts';
import { playerBase } from './state.ts';
import type { CyberWorld } from './world.ts';

export function processDashStage(w: CyberWorld, dt: number): void {
  const state = w.state;

  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const base = playerBase(s);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
    if ((flags & CYBER_FLAG.ACTIVE) === 0) {
      w.pDashTimer[s] = 0;
      continue;
    }

    // Trigger new dash on rising edge of Button B when off cooldown
    if ((w.pInputEdge[s]! & BUTTON_BIT.DASH) !== 0 && state[base + CYBER_PLAYER_OFFSET.dashCooldown]! <= 0) {
      let dirX = w.pInputAxisX[s]! / 127;
      let dirY = w.pInputAxisY[s]! / 127;
      const len = Math.hypot(dirX, dirY);
      if (len > 0.15) {
        dirX /= len;
        dirY /= len;
        state[base + CYBER_PLAYER_OFFSET.heading] = Math.atan2(dirY, dirX);
      } else {
        const heading = state[base + CYBER_PLAYER_OFFSET.heading]!;
        dirX = Math.cos(heading);
        dirY = Math.sin(heading);
      }
      w.pDashDirX[s] = dirX;
      w.pDashDirY[s] = dirY;
      w.pDashTimer[s] = C.dashDurationSec;
      state[base + CYBER_PLAYER_OFFSET.dashCooldown] = C.dashCooldownSec;
    }

    const timer = w.pDashTimer[s]!;
    if (timer <= 0) continue;

    const prevX = state[base + CYBER_PLAYER_OFFSET.x]!;
    const prevY = state[base + CYBER_PLAYER_OFFSET.y]!;
    const dirX = w.pDashDirX[s]!;
    const dirY = w.pDashDirY[s]!;

    const nextX = prevX + dirX * C.dashSpeed * dt;
    const nextY = prevY + dirY * C.dashSpeed * dt;

    // Resolve stops on walls/Core/barricades with 0 damage
    const minCore = C.coreRadius + C.playerRadius;
    let x = nextX;
    let y = nextY;
    let stopped = false;

    const coreDistSq = x * x + y * y;
    if (coreDistSq < minCore * minCore) {
      const dist = Math.sqrt(coreDistSq);
      if (dist > 1e-4) {
        x = (x / dist) * minCore;
        y = (y / dist) * minCore;
      } else {
        x = minCore;
        y = 0;
      }
      stopped = true;
    }

    const halfCell = C.cellSize * 0.5;
    const maxB = AUX_LAYOUT.MAX_BARRICADES;
    for (let i = 0; i < maxB; i += 1) {
      if (w.bActive[i] === 0) continue;
      const bx = cellCenter(w.bCellX[i]!);
      const by = cellCenter(w.bCellY[i]!);
      const dx = x - bx;
      const dy = y - by;
      const clampedDx = dx < -halfCell ? -halfCell : dx > halfCell ? halfCell : dx;
      const clampedDy = dy < -halfCell ? -halfCell : dy > halfCell ? halfCell : dy;
      const rx = dx - clampedDx;
      const ry = dy - clampedDy;
      if (rx * rx + ry * ry < C.playerRadius * C.playerRadius) {
        x = prevX;
        y = prevY;
        stopped = true;
        break;
      }
    }

    const body = w.scratchBody;
    body.x = x;
    body.y = y;
    body.vx = dirX * C.dashSpeed;
    body.vy = dirY * C.dashSpeed;
    if (clampBoxBoundary(body, C.arenaSize, C.arenaSize, C.playerRadius, 0)) {
      x = body.x;
      y = body.y;
      stopped = true;
    }

    state[base + CYBER_PLAYER_OFFSET.x] = x;
    state[base + CYBER_PLAYER_OFFSET.y] = y;

    // Check enemy interactions: crowd stagger drones, spin brutes (1.0s reset, no shield pierce), dual-dash boss
    const hitCount = w.gridHash.queryRadius(x, y, C.dashStaggerRadius + C.bossRadius, w.queryBuf);
    for (let i = 0; i < hitCount; i += 1) {
      const eid = w.queryBuf[i]!;
      if (!w.enemyPool.isActive(eid) || w.eHp[eid]! <= 0) continue;
      const ex = w.eX[eid]!;
      const ey = w.eY[eid]!;
      const dx = ex - x;
      const dy = ey - y;
      const minDist = C.playerRadius + w.eRadius[eid]! + 6;
      const distSq = dx * dx + dy * dy;
      const type = w.eType[eid]!;

      if (type === ENEMY_TYPE.BRUTE) {
        if (distSq <= minDist * minDist) {
          applyBruteDashSpin(w, eid);
          stopped = true;
        }
      } else if (type === ENEMY_TYPE.BOSS) {
        if (distSq <= minDist * minDist) {
          onBossDashHit(w, s, eid, x, y);
          stopped = true;
        }
      } else if (distSq <= (C.dashStaggerRadius + w.eRadius[eid]!) * (C.dashStaggerRadius + w.eRadius[eid]!)) {
        const dist = Math.sqrt(distSq);
        const ux = dist > 1e-4 ? dx / dist : dirX;
        const uy = dist > 1e-4 ? dy / dist : dirY;
        w.eKnockX[eid] = w.eKnockX[eid]! + ux * C.dashStaggerImpulse;
        w.eKnockY[eid] = w.eKnockY[eid]! + uy * C.dashStaggerImpulse;
      }
    }

    const nextTimer = stopped ? 0 : timer - dt;
    w.pDashTimer[s] = nextTimer > 0 ? nextTimer : 0;
  }
}
