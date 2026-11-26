import { hitsBruteFrontalShield } from './brute.ts';
import {
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_PLAYER_OFFSET,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
  PROJECTILE_FLAG,
} from './constants.ts';
import { playerBase } from './state.ts';
import { spawnTracer, type CyberWorld } from './world.ts';

const AUTO_RANGE_SQ = C.autoFireRange * C.autoFireRange;

function isEnemyInAutoCone(
  w: CyberWorld,
  enemyIdx: number,
  px: number,
  py: number,
  hx: number,
  hy: number,
): number {
  if (!w.enemyPool.isActive(enemyIdx) || w.eHp[enemyIdx]! <= 0) return -1;
  const dx = w.eX[enemyIdx]! - px;
  const dy = w.eY[enemyIdx]! - py;
  const dSq = dx * dx + dy * dy;
  if (dSq > AUTO_RANGE_SQ) return -1;
  if (dSq <= 1e-6) return 0;
  const dot = dx * hx + dy * hy;
  if (dot <= 0) return -1;
  if (dot * dot < C.autoFireCosHalfSq * dSq) return -1;
  return dSq;
}

export function selectAutoFireTarget(
  w: CyberWorld,
  slot: number,
  px: number,
  py: number,
  heading: number,
): number {
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  const count = w.gridHash.queryRadius(px, py, C.autoFireRange, w.queryBuf);

  let bestId = -1;
  let bestCoreSq = Number.POSITIVE_INFINITY;
  let bestPlayerSq = Number.POSITIVE_INFINITY;

  for (let i = 0; i < count; i += 1) {
    const eid = w.queryBuf[i]!;
    const playerSq = isEnemyInAutoCone(w, eid, px, py, hx, hy);
    if (playerSq < 0) continue;
    const ex = w.eX[eid]!;
    const ey = w.eY[eid]!;
    const coreSq = ex * ex + ey * ey;

    // INV-7 deterministic tie-break: Core distSq -> player distSq -> lowest pool index
    if (
      coreSq < bestCoreSq ||
      (coreSq === bestCoreSq &&
        (playerSq < bestPlayerSq || (playerSq === bestPlayerSq && eid < bestId)))
    ) {
      bestCoreSq = coreSq;
      bestPlayerSq = playerSq;
      bestId = eid;
    }
  }

  const prevId = w.pAutoFireTarget[slot]!;
  if (prevId >= 0 && bestId >= 0 && prevId !== bestId) {
    const prevPlayerSq = isEnemyInAutoCone(w, prevId, px, py, hx, hy);
    if (prevPlayerSq >= 0) {
      const pex = w.eX[prevId]!;
      const pey = w.eY[prevId]!;
      const prevCoreSq = pex * pex + pey * pey;
      // FR-9.6: keep previous target unless bestId is at least 10% closer to Core (0.9^2 = 0.81)
      if (bestCoreSq > C.autoFireStickinessRatioSq * prevCoreSq) {
        return prevId;
      }
    }
  }

  return bestId;
}

export function processAutoFireStage(w: CyberWorld, dt: number): void {
  const state = w.state;
  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const base = playerBase(s);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
    if ((flags & CYBER_FLAG.ACTIVE) === 0) {
      w.pAutoFireTarget[s] = -1;
      continue;
    }

    let timer = w.pAutoFireTimer[s]! - dt;
    if (timer > 0) {
      w.pAutoFireTimer[s] = timer;
      continue;
    }

    const px = state[base + CYBER_PLAYER_OFFSET.x]!;
    const py = state[base + CYBER_PLAYER_OFFSET.y]!;
    const heading = state[base + CYBER_PLAYER_OFFSET.heading]!;
    const targetId = selectAutoFireTarget(w, s, px, py, heading);
    w.pAutoFireTarget[s] = targetId;
    if (targetId < 0) {
      w.pAutoFireTimer[s] = 0;
      continue;
    }

    w.pAutoFireTimer[s] = C.autoFireCadenceSec;
    const ex = w.eX[targetId]!;
    const ey = w.eY[targetId]!;
    const type = w.eType[targetId]!;

    // Check Brute 120-degree frontal shield deflection
    if (type === ENEMY_TYPE.BRUTE) {
      const shieldUp = (w.eStateFlags[targetId]! & ENEMY_STATE_FLAG.SHIELD_UP) !== 0;
      if (hitsBruteFrontalShield(ex, ey, w.eHeading[targetId]!, shieldUp, w.eSpinTimer[targetId]!, px, py)) {
        spawnTracer(
          w,
          ex,
          ey,
          s,
          PROJECTILE_FLAG.ACTIVE | PROJECTILE_FLAG.SHIELD_SPARK,
          C.autoFireTracerTicks,
        );
        continue;
      }
    }

    let dmg = C.autoFireDamage;
    if (type === ENEMY_TYPE.BOSS && w.bossVulnerableTimer <= 0) {
      dmg *= C.bossArmorDamageScale;
    }
    w.ePendingDamage[targetId] = w.ePendingDamage[targetId]! + dmg;
    w.squadDamageDealt += dmg;
    if (type === ENEMY_TYPE.BOSS) {
      w.pBossThreat[s] = w.pBossThreat[s]! + dmg;
    }
    spawnTracer(w, ex, ey, s, PROJECTILE_FLAG.ACTIVE, C.autoFireTracerTicks);
  }
}
