import {
  BOSS_WEAK_FLAG,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PLAYER_OFFSET,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
  PROJECTILE_FLAG,
} from './constants.ts';
import { computeRayArenaMaxDist, pointToSegmentDistSq } from './rail.ts';
import { raycastBarricades } from './shield.ts';
import { playerBase } from './state.ts';
import { spawnEnemyImmediate } from './waves.ts';
import { clearBossSlot, spawnTracer, type CyberWorld } from './world.ts';

export function findBossSlotByEnemyIdx(w: CyberWorld, enemyIdx: number): number {
  for (let b = 0; b < C.maxBosses; b += 1) {
    if (w.bossEnemyIdx[b] === enemyIdx) return b;
  }
  return -1;
}

export function isBossVulnerable(w: CyberWorld, enemyIdx: number): boolean {
  const b = findBossSlotByEnemyIdx(w, enemyIdx);
  return b >= 0 && w.bossVulnerableTimer[b]! > 0;
}

export function syncBossHeaderPhase(w: CyberWorld): void {
  let maxPhase = 0;
  for (let b = 0; b < C.maxBosses; b += 1) {
    const bIdx = w.bossEnemyIdx[b]!;
    if (bIdx < 0 || !w.enemyPool.isActive(bIdx) || w.eHp[bIdx]! <= 0) continue;
    const p = w.bossPhase[b]!;
    if (p > maxPhase) maxPhase = p;
  }
  w.state[CYBER_HEADER.bossPhase] = maxPhase;
}

export function releaseBossByEnemyIdx(w: CyberWorld, enemyIdx: number): void {
  const b = findBossSlotByEnemyIdx(w, enemyIdx);
  if (b >= 0) {
    clearBossSlot(w, b);
  }
  syncBossHeaderPhase(w);
}

export function resetBossState(w: CyberWorld): void {
  for (let b = 0; b < C.maxBosses; b += 1) {
    clearBossSlot(w, b);
  }
  w.bossThreat.fill(0);
  w.state[CYBER_HEADER.bossPhase] = 0;
}

/**
 * Called from dash.ts when a player dashes into a Dreadnought.
 * Finds the targeted active boss slot and applies
 * opposite-flank dual-dash coordination independently per boss instance.
 */
export function onBossDashHit(w: CyberWorld, slot: number, enemyIdx: number, px: number, py: number): void {
  const targetBossSlot = findBossSlotByEnemyIdx(w, enemyIdx);
  if (targetBossSlot < 0) return;

  const bIdx = enemyIdx;
  const threatOff = targetBossSlot * C.maxPlayers + slot;
  w.bossThreat[threatOff] = w.bossThreat[threatOff]! + 80;
  const bx = w.eX[bIdx]!;
  const by = w.eY[bIdx]!;
  const hitAngle = Math.atan2(py - by, px - bx);

  if (w.bossVulnerableTimer[targetBossSlot]! > 0) return;

  const firstSlot = w.bossFirstDashSlot[targetBossSlot]!;
  if (w.bossDualDashTimer[targetBossSlot]! > 0 && firstSlot >= 0 && firstSlot !== slot) {
    // Opposite flank check: cos(angleDiff) <= -0.35 (~110+ deg apart)
    const cosDiff = Math.cos(hitAngle - w.bossFirstDashAngle[targetBossSlot]!);
    if (cosDiff <= -0.35) {
      w.bossWeakMask[targetBossSlot] =
        BOSS_WEAK_FLAG.FLANK_A_HIT | BOSS_WEAK_FLAG.FLANK_B_HIT | BOSS_WEAK_FLAG.VULNERABLE;
      w.bossVulnerableTimer[targetBossSlot] = C.bossVulnerableSec;
      w.bossDualDashTimer[targetBossSlot] = 0;
      w.bossFirstDashSlot[targetBossSlot] = -1;
      return;
    }
  }

  // Record first flank hit and start 1.0s dual-dash coordination window for this boss slot
  w.bossFirstDashSlot[targetBossSlot] = slot;
  w.bossFirstDashAngle[targetBossSlot] = hitAngle;
  w.bossDualDashTimer[targetBossSlot] = C.bossDualDashWindowSec;
  w.bossWeakMask[targetBossSlot] = BOSS_WEAK_FLAG.FLANK_A_HIT;
}

/**
 * Composite threat aggro: accumulated damage + dash hits + proximity bonus.
 */
export function selectBossThreatTarget(w: CyberWorld, bossSlot: number, bx: number, by: number): number {
  const state = w.state;
  let bestSlot = 8; // Core fallback
  let bestScore = 0; // Threat / proximity must be strictly positive to draw aggro off the Core

  const threatOffset = bossSlot * C.maxPlayers;
  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const base = playerBase(s);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
    if ((flags & CYBER_FLAG.ACTIVE) === 0) continue;
    const dx = state[base + CYBER_PLAYER_OFFSET.x]! - bx;
    const dy = state[base + CYBER_PLAYER_OFFSET.y]! - by;
    const dist = Math.hypot(dx, dy);
    const proximityBonus = dist < 350 ? (350 - dist) * 0.4 : 0;
    const score = w.bossThreat[threatOffset + s]! + proximityBonus;
    if (score > bestScore) {
      bestScore = score;
      bestSlot = s;
    }
  }
  return bestSlot;
}

export function updateBossFsm(w: CyberWorld, dt: number): void {
  let maxPhase = 0;
  let anyActiveBoss = false;

  for (let b = 0; b < C.maxBosses; b += 1) {
    const bIdx = w.bossEnemyIdx[b]!;
    if (bIdx < 0) continue;

    if (!w.enemyPool.isActive(bIdx) || w.eHp[bIdx]! <= 0 || w.eType[bIdx] !== ENEMY_TYPE.BOSS) {
      clearBossSlot(w, b);
      continue;
    }

    anyActiveBoss = true;

    // Tick dual-dash & vulnerability timers for this boss instance
    if (w.bossDualDashTimer[b]! > 0) {
      const nextDual = w.bossDualDashTimer[b]! - dt;
      if (nextDual <= 0) {
        w.bossDualDashTimer[b] = 0;
        w.bossFirstDashSlot[b] = -1;
        if (w.bossVulnerableTimer[b]! <= 0) {
          w.bossWeakMask[b] = 0;
        }
      } else {
        w.bossDualDashTimer[b] = nextDual;
      }
    }
    if (w.bossVulnerableTimer[b]! > 0) {
      const nextVuln = w.bossVulnerableTimer[b]! - dt;
      if (nextVuln <= 0) {
        w.bossVulnerableTimer[b] = 0;
        w.bossWeakMask[b] = 0;
      } else {
        w.bossVulnerableTimer[b] = nextVuln;
      }
    }

    const hpRatio = w.eHp[bIdx]! / w.eMaxHp[bIdx]!;
    let phase = 1;
    if (hpRatio <= C.bossPhase3Threshold) phase = 3;
    else if (hpRatio <= C.bossPhase2Threshold) phase = 2;

    const prevPhase = w.bossPhase[b]!;
    w.bossPhase[b] = phase;
    if (phase > maxPhase) maxPhase = phase;

    const bx = w.eX[bIdx]!;
    const by = w.eY[bIdx]!;
    const flank = w.eFlank[bIdx]!;

    // Entering Phase 2 immediately deploys a Drone Carrier escort
    if (phase >= 2 && prevPhase < 2) {
      spawnEnemyImmediate(w, ENEMY_TYPE.CARRIER, bx * 0.85, by * 0.85, flank);
    }

    // Phase 2+: periodic drone carrier deployment
    if (phase >= 2) {
      const nextCarrier = w.bossCarrierTimer[b]! - dt;
      if (nextCarrier <= 0) {
        w.bossCarrierTimer[b] = C.bossCarrierCooldownSec;
        spawnEnemyImmediate(w, ENEMY_TYPE.CARRIER, bx, by, flank);
      } else {
        w.bossCarrierTimer[b] = nextCarrier;
      }
    }

    // Phase 3: Enraged directly toward Core
    if (phase === 3) {
      w.eStateFlags[bIdx] = (w.eStateFlags[bIdx]! | ENEMY_STATE_FLAG.ENRAGED) & 0x3f;
      w.eSpeed[bIdx] = C.bossEnrageSpeed;
      w.eTarget[bIdx] = 8; // Core
    } else {
      w.eSpeed[bIdx] = C.bossSpeed;
      w.eTarget[bIdx] = selectBossThreatTarget(w, b, bx, by);
    }

    // Sweeping laser barrage state (independent per boss slot)
    if (w.eStunTimer[bIdx]! <= 0) {
      const nextLaserTimer = w.bossLaserTimer[b]! - dt;
      w.bossLaserTimer[b] = nextLaserTimer;

      if (w.bossLaserActive[b] === 0 && nextLaserTimer <= 0) {
        const initAngle = w.eHeading[bIdx]! - 0.7;
        w.bossLaserActive[b] = 1;
        w.bossLaserTimer[b] = phase === 3 ? 2.4 : 1.8;
        w.bossLaserAngle[b] = initAngle;
        const initCos = Math.cos(initAngle);
        const initSin = Math.sin(initAngle);
        const initArenaMax = computeRayArenaMaxDist(bx, by, initCos, initSin, C.bossLaserRange);
        raycastBarricades(w, bx, by, initCos, initSin, initArenaMax, w.scratchRayHit);
        w.bossLaserLen[b] = w.scratchRayHit.dist;
        w.eStateFlags[bIdx] = (w.eStateFlags[bIdx]! | ENEMY_STATE_FLAG.LASER_SWEEP) & 0x3f;
      } else if (w.bossLaserActive[b] !== 0) {
        const sweepSpeed = phase === 3 ? C.bossLaserSweepSpeed * 1.35 : C.bossLaserSweepSpeed;
        const angle = w.bossLaserAngle[b]! + sweepSpeed * dt;
        w.bossLaserAngle[b] = angle;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const arenaMaxLen = computeRayArenaMaxDist(bx, by, cos, sin, C.bossLaserRange);
        raycastBarricades(w, bx, by, cos, sin, arenaMaxLen, w.scratchRayHit);
        const hitDist = w.scratchRayHit.dist;
        const hitBarIdx = w.scratchRayHit.barIdx;
        w.bossLaserLen[b] = hitDist;

        const tipX = bx + cos * hitDist;
        const tipY = by + sin * hitDist;

        if (hitBarIdx >= 0) {
          w.bPendingDamage[hitBarIdx] = w.bPendingDamage[hitBarIdx]! + C.bossLaserDps * dt;
        }

        // Apply laser damage to players intersecting beam (skipping players behind blocking barricade)
        const state = w.state;
        const hitR = C.playerRadius + C.bossLaserHalfWidth;
        const hitRSq = hitR * hitR;
        for (let s = 0; s < C.maxPlayers; s += 1) {
          if (w.pJoined[s] === 0) continue;
          const pb = playerBase(s);
          if ((state[pb + CYBER_PLAYER_OFFSET.flags]! & CYBER_FLAG.ACTIVE) === 0) continue;
          const px = state[pb + CYBER_PLAYER_OFFSET.x]!;
          const py = state[pb + CYBER_PLAYER_OFFSET.y]!;
          if (hitBarIdx >= 0 && (px - bx) * cos + (py - by) * sin > hitDist) continue;
          const dSq = pointToSegmentDistSq(px, py, bx, by, tipX, tipY);
          if (dSq <= hitRSq) {
            w.pPendingDamage[s] = w.pPendingDamage[s]! + C.bossLaserDps * dt;
          }
        }

        // Emit boss laser visual tracer every 4 ticks at the clipped endpoint
        if (((w.state[CYBER_HEADER.tickId]! | 0) & 3) === 0) {
          spawnTracer(
            w,
            tipX,
            tipY,
            b & 0x07,
            PROJECTILE_FLAG.ACTIVE | PROJECTILE_FLAG.BOSS_LASER,
            5,
          );
        }

        if (w.bossLaserTimer[b]! <= 0) {
          w.bossLaserActive[b] = 0;
          w.bossLaserLen[b] = 0;
          w.bossLaserTimer[b] = phase === 3 ? 3.0 : 4.2;
          w.eStateFlags[bIdx] = (w.eStateFlags[bIdx]! & ~ENEMY_STATE_FLAG.LASER_SWEEP) & 0x3f;
        }
      }
    }
  }

  w.state[CYBER_HEADER.bossPhase] = maxPhase;

  if (!anyActiveBoss) return;

  // Slight threat decay over time so recent damage/dashes steer aggro
  for (let i = 0; i < C.maxBosses * C.maxPlayers; i += 1) {
    const cur = w.bossThreat[i]!;
    if (cur > 0) {
      const dec = cur - 10 * dt;
      w.bossThreat[i] = dec > 0 ? dec : 0;
    }
  }
}
