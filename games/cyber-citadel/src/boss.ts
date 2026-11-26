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
import { pointToSegmentDistSq } from './rail.ts';
import { playerBase } from './state.ts';
import { spawnEnemyImmediate } from './waves.ts';
import { spawnTracer, type CyberWorld } from './world.ts';

export function resetBossState(w: CyberWorld): void {
  w.bossEnemyIdx = -1;
  w.bossLaserAngle = 0;
  w.bossLaserTimer = 3.0;
  w.bossLaserActive = false;
  w.bossCarrierTimer = C.bossCarrierCooldownSec;
  w.bossFirstDashSlot = -1;
  w.bossFirstDashAngle = 0;
  w.bossDualDashTimer = 0;
  w.bossVulnerableTimer = 0;
  w.bossWeakMask = 0;
  w.pBossThreat.fill(0);
  w.state[CYBER_HEADER.bossPhase] = 0;
}

/**
 * Called from dash.ts when a player dashes into the Dreadnought.
 * Opposite-flank dashes by two different players within 1.0s expose weak points.
 */
export function onBossDashHit(w: CyberWorld, slot: number, px: number, py: number): void {
  const bIdx = w.bossEnemyIdx;
  if (bIdx < 0 || !w.enemyPool.isActive(bIdx)) return;

  w.pBossThreat[slot] = w.pBossThreat[slot]! + 80;
  const bx = w.eX[bIdx]!;
  const by = w.eY[bIdx]!;
  const hitAngle = Math.atan2(py - by, px - bx);

  if (w.bossVulnerableTimer > 0) return;

  if (w.bossDualDashTimer > 0 && w.bossFirstDashSlot >= 0 && w.bossFirstDashSlot !== slot) {
    // Opposite flank check: cos(angleDiff) <= -0.35 (~110+ deg apart)
    const cosDiff = Math.cos(hitAngle - w.bossFirstDashAngle);
    if (cosDiff <= -0.35) {
      w.bossWeakMask =
        BOSS_WEAK_FLAG.FLANK_A_HIT | BOSS_WEAK_FLAG.FLANK_B_HIT | BOSS_WEAK_FLAG.VULNERABLE;
      w.bossVulnerableTimer = C.bossVulnerableSec;
      w.bossDualDashTimer = 0;
      w.bossFirstDashSlot = -1;
      return;
    }
  }

  // Record first flank hit and start 1.0s dual-dash coordination window
  w.bossFirstDashSlot = slot;
  w.bossFirstDashAngle = hitAngle;
  w.bossDualDashTimer = C.bossDualDashWindowSec;
  w.bossWeakMask = BOSS_WEAK_FLAG.FLANK_A_HIT;
}

/**
 * Composite threat aggro: accumulated damage + dash hits + proximity bonus.
 */
export function selectBossThreatTarget(w: CyberWorld, bx: number, by: number): number {
  const state = w.state;
  let bestSlot = 8; // Core fallback
  let bestScore = -1;

  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const base = playerBase(s);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags]!;
    if ((flags & CYBER_FLAG.ACTIVE) === 0) continue;
    const dx = state[base + CYBER_PLAYER_OFFSET.x]! - bx;
    const dy = state[base + CYBER_PLAYER_OFFSET.y]! - by;
    const dist = Math.hypot(dx, dy);
    const proximityBonus = dist < 350 ? (350 - dist) * 0.4 : 0;
    const score = w.pBossThreat[s]! + proximityBonus;
    if (score > bestScore) {
      bestScore = score;
      bestSlot = s;
    }
  }
  return bestSlot;
}

export function updateBossFsm(w: CyberWorld, dt: number): void {
  const bIdx = w.bossEnemyIdx;
  if (bIdx < 0 || !w.enemyPool.isActive(bIdx) || w.eHp[bIdx]! <= 0) {
    w.bossEnemyIdx = -1;
    w.state[CYBER_HEADER.bossPhase] = 0;
    w.bossWeakMask = 0;
    return;
  }

  // Tick dual-dash & vulnerability timers
  if (w.bossDualDashTimer > 0) {
    w.bossDualDashTimer -= dt;
    if (w.bossDualDashTimer <= 0) {
      w.bossDualDashTimer = 0;
      w.bossFirstDashSlot = -1;
      if (w.bossVulnerableTimer <= 0) {
        w.bossWeakMask = 0;
      }
    }
  }
  if (w.bossVulnerableTimer > 0) {
    w.bossVulnerableTimer -= dt;
    if (w.bossVulnerableTimer <= 0) {
      w.bossVulnerableTimer = 0;
      w.bossWeakMask = 0;
    }
  }

  const hpRatio = w.eHp[bIdx]! / w.eMaxHp[bIdx]!;
  let phase = 1;
  if (hpRatio <= C.bossPhase3Threshold) phase = 3;
  else if (hpRatio <= C.bossPhase2Threshold) phase = 2;

  const prevPhase = w.state[CYBER_HEADER.bossPhase]!;
  w.state[CYBER_HEADER.bossPhase] = phase;

  const bx = w.eX[bIdx]!;
  const by = w.eY[bIdx]!;

  // Entering Phase 2 immediately deploys a Drone Carrier escort
  if (phase >= 2 && prevPhase < 2) {
    spawnEnemyImmediate(w, ENEMY_TYPE.CARRIER, bx * 0.85, by * 0.85, 0);
  }

  // Phase 2+: periodic drone carrier deployment
  if (phase >= 2) {
    w.bossCarrierTimer -= dt;
    if (w.bossCarrierTimer <= 0) {
      w.bossCarrierTimer = C.bossCarrierCooldownSec;
      spawnEnemyImmediate(w, ENEMY_TYPE.CARRIER, bx, by, 0);
    }
  }

  // Phase 3: Enraged directly toward Core
  if (phase === 3) {
    w.eStateFlags[bIdx] = (w.eStateFlags[bIdx]! | ENEMY_STATE_FLAG.ENRAGED) & 0x3f;
    w.eSpeed[bIdx] = C.bossEnrageSpeed;
    w.eTarget[bIdx] = 8; // Core
  } else {
    w.eSpeed[bIdx] = C.bossSpeed;
    w.eTarget[bIdx] = selectBossThreatTarget(w, bx, by);
  }

  // Sweeping laser barrage state
  if (w.eStunTimer[bIdx]! <= 0) {
    w.bossLaserTimer -= dt;
    if (!w.bossLaserActive && w.bossLaserTimer <= 0) {
      w.bossLaserActive = true;
      w.bossLaserTimer = phase === 3 ? 2.4 : 1.8;
      w.bossLaserAngle = w.eHeading[bIdx]! - 0.7;
      w.eStateFlags[bIdx] = (w.eStateFlags[bIdx]! | ENEMY_STATE_FLAG.LASER_SWEEP) & 0x3f;
    } else if (w.bossLaserActive) {
      const sweepSpeed = phase === 3 ? C.bossLaserSweepSpeed * 1.35 : C.bossLaserSweepSpeed;
      w.bossLaserAngle += sweepSpeed * dt;
      const tipX = bx + Math.cos(w.bossLaserAngle) * C.bossLaserRange;
      const tipY = by + Math.sin(w.bossLaserAngle) * C.bossLaserRange;

      // Apply laser damage to players intersecting beam
      const state = w.state;
      const hitR = C.playerRadius + C.bossLaserHalfWidth;
      const hitRSq = hitR * hitR;
      for (let s = 0; s < C.maxPlayers; s += 1) {
        if (w.pJoined[s] === 0) continue;
        const pb = playerBase(s);
        if ((state[pb + CYBER_PLAYER_OFFSET.flags]! & CYBER_FLAG.ACTIVE) === 0) continue;
        const dSq = pointToSegmentDistSq(
          state[pb + CYBER_PLAYER_OFFSET.x]!,
          state[pb + CYBER_PLAYER_OFFSET.y]!,
          bx,
          by,
          tipX,
          tipY,
        );
        if (dSq <= hitRSq) {
          w.pPendingDamage[s] = w.pPendingDamage[s]! + C.bossLaserDps * dt;
        }
      }

      // Emit boss laser visual tracer every 4 ticks
      if (((w.state[CYBER_HEADER.tickId]! | 0) & 3) === 0) {
        spawnTracer(
          w,
          tipX,
          tipY,
          0,
          PROJECTILE_FLAG.ACTIVE | PROJECTILE_FLAG.BOSS_LASER,
          5,
        );
      }

      if (w.bossLaserTimer <= 0) {
        w.bossLaserActive = false;
        w.bossLaserTimer = phase === 3 ? 3.0 : 4.2;
        w.eStateFlags[bIdx] = (w.eStateFlags[bIdx]! & ~ENEMY_STATE_FLAG.LASER_SWEEP) & 0x3f;
      }
    }
  }

  // Slight threat decay over time so recent damage/dashes steer aggro
  for (let s = 0; s < C.maxPlayers; s += 1) {
    const cur = w.pBossThreat[s]!;
    if (cur > 0) {
      const dec = cur - 10 * dt;
      w.pBossThreat[s] = dec > 0 ? dec : 0;
    }
  }
}
