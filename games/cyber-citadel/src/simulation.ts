import { clampBoxBoundary } from '../../../shared/src/physics-2d/boundary.ts';
import {
  cancelReviveChannelForReviver,
  processAutoFireStage,
  processDashStage,
  processRailStage,
  respawnAllPlayersForWaveBreak,
  spawnPlayerNearCore,
  tickBarricades,
  tickDownedReviveAndRespawn,
  tickEmpSystem,
  transitionPlayerToDowned,
  tryJoinEmp,
  tryPlaceBarricade,
  tryStartReviveChannel,
} from './abilities.ts';
import { resetBossState, updateBossFsm } from './boss.ts';
import { selectBruteTarget } from './brute.ts';
import {
  AUX_LAYOUT,
  BUTTON_BIT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PHASE,
  CYBER_PLAYER_OFFSET,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
} from './constants.ts';
import { cellCenter, findNearestBarricadeCell, worldToCell } from './flow-field.ts';
import { computeSquadWeight } from './scaling.ts';
import { playerBase } from './state.ts';
import type { CyberCitadelSimulation, CyberRosterMeta, CyberSimOptions } from './types.ts';
import { clearSpawnQueue, populateWaveSpawns, spawnEnemyImmediate, tickWaveSpawns } from './waves.ts';
import {
  createCyberWorld,
  rebuildEnemyGrid,
  tickAndSyncAuxState,
  type CyberWorld,
} from './world.ts';

function resetAllPools(w: CyberWorld): void {
  w.enemyPool.reset();
  w.eType.fill(0);
  w.eHp.fill(0);
  w.eMaxHp.fill(0);
  w.ePendingDamage.fill(0);
  w.eStateFlags.fill(0);
  w.eSpinTimer.fill(0);
  w.eStunTimer.fill(0);
  w.eShieldBreakTimer.fill(0);
  w.eKnockX.fill(0);
  w.eKnockY.fill(0);

  w.projTtl.fill(0);
  w.projCursor = 0;

  w.barPool.reset();
  w.bActive.fill(0);
  w.bHp.fill(0);
  w.bTtl.fill(0);
  w.bFlags.fill(0);
  w.bPendingDamage.fill(0);

  w.flowField.reset();
  w.gridHash.clear();
  clearSpawnQueue(w);
  resetBossState(w);
}

function processStage1Inputs(w: CyberWorld, dt: number): void {
  const state = w.state;
  const minCore = C.coreRadius + C.playerRadius;
  const halfCell = C.cellSize * 0.5;
  const maxB = AUX_LAYOUT.MAX_BARRICADES;

  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const base = playerBase(s);
    let flags = state[base + CYBER_PLAYER_OFFSET.flags]!;

    // While disconnected (AWAY), ship sits idle with zero inputs; never taken over by a standby bot
    w.pDisconnectTimer[s] = 0;

    // Decrement cooldowns strictly >= 0 (INV-4)
    const nextRail = state[base + CYBER_PLAYER_OFFSET.railCooldown]! - dt;
    state[base + CYBER_PLAYER_OFFSET.railCooldown] = nextRail > 0 ? nextRail : 0;
    const nextDash = state[base + CYBER_PLAYER_OFFSET.dashCooldown]! - dt;
    state[base + CYBER_PLAYER_OFFSET.dashCooldown] = nextDash > 0 ? nextDash : 0;
    const nextShield = w.pShieldCooldown[s]! - dt;
    w.pShieldCooldown[s] = nextShield > 0 ? nextShield : 0;

    // Movement (skip normal movement if RESPAWNING or currently dashing)
    const isActive = (flags & CYBER_FLAG.ACTIVE) !== 0;
    const isDowned = (flags & CYBER_FLAG.DOWNED) !== 0;
    if ((isActive || isDowned) && w.pDashTimer[s]! <= 0) {
      let ax = w.pInputAxisX[s]! / 127;
      let ay = w.pInputAxisY[s]! / 127;
      const mag = Math.hypot(ax, ay);
      if (mag > 1) {
        ax /= mag;
        ay /= mag;
      }

      const maxSpeed = isDowned ? C.playerSpeed * C.downedCrawlFactor : C.playerSpeed;
      const vx = mag > 0.08 ? ax * maxSpeed : 0;
      const vy = mag > 0.08 ? ay * maxSpeed : 0;
      w.pVx[s] = vx;
      w.pVy[s] = vy;

      if (mag > 0.12) {
        state[base + CYBER_PLAYER_OFFSET.heading] = Math.atan2(ay, ax);
      }

      const prevX = state[base + CYBER_PLAYER_OFFSET.x]!;
      const prevY = state[base + CYBER_PLAYER_OFFSET.y]!;
      let x = prevX + vx * dt;
      let y = prevY + vy * dt;

      // Solid Core collision
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
      }

      // Barricade collision (players cannot walk through solid kinetic barricades)
      for (let bi = 0; bi < maxB; bi += 1) {
        if (w.bActive[bi] === 0) continue;
        const bx = cellCenter(w.bCellX[bi]!);
        const by = cellCenter(w.bCellY[bi]!);
        const dx = x - bx;
        const dy = y - by;
        const clampedDx = dx < -halfCell ? -halfCell : dx > halfCell ? halfCell : dx;
        const clampedDy = dy < -halfCell ? -halfCell : dy > halfCell ? halfCell : dy;
        const rx = dx - clampedDx;
        const ry = dy - clampedDy;
        const distSq = rx * rx + ry * ry;
        if (distSq < C.playerRadius * C.playerRadius) {
          if (distSq > 1e-6) {
            const d = Math.sqrt(distSq);
            const push = C.playerRadius - d;
            x += (rx / d) * push;
            y += (ry / d) * push;
          } else {
            x = prevX;
            y = prevY;
          }
        }
      }

      // Outer box containment (INV-2)
      const body = w.scratchBody;
      body.x = x;
      body.y = y;
      body.vx = vx;
      body.vy = vy;
      clampBoxBoundary(body, C.arenaSize, C.arenaSize, C.playerRadius, 0);
      state[base + CYBER_PLAYER_OFFSET.x] = body.x;
      state[base + CYBER_PLAYER_OFFSET.y] = body.y;
    }

    // Button X: SHIELD barricade placement
    if ((w.pInputEdge[s]! & BUTTON_BIT.SHIELD) !== 0) {
      tryPlaceBarricade(w, s);
    }

    // Button Y: context priority (a) REVIVE downed ally in reach, else (b) EMP join inside Core ring (FR-9.4)
    if ((w.pInputEdge[s]! & BUTTON_BIT.REVIVE_EMP) !== 0) {
      if (!tryStartReviveChannel(w, s)) {
        tryJoinEmp(w, s);
      }
    }
  }
}

function processStage5Enemies(w: CyberWorld, dt: number): void {
  // Rebuild 40x40 flow field at most once per tick if barricades changed
  w.flowField.rebuildIfDirty();

  tickWaveSpawns(w, dt);
  updateBossFsm(w, dt);

  const state = w.state;
  const maxE = AUX_LAYOUT.MAX_ENEMIES;
  const maxB = AUX_LAYOUT.MAX_BARRICADES;
  const vec = w.scratchVec;

  for (let i = 0; i < maxE; i += 1) {
    if (!w.enemyPool.isActive(i) || w.eHp[i]! <= 0) continue;

    // Tick enemy status timers
    if (w.eSpinTimer[i]! > 0) {
      const nextSpin = w.eSpinTimer[i]! - dt;
      if (nextSpin <= 0) {
        w.eSpinTimer[i] = 0;
        w.eStateFlags[i] = (w.eStateFlags[i]! & ~ENEMY_STATE_FLAG.SPUN) & 0x3f;
      } else {
        w.eSpinTimer[i] = nextSpin;
      }
    }
    if (w.eStunTimer[i]! > 0) {
      const nextStun = w.eStunTimer[i]! - dt;
      if (nextStun <= 0) {
        w.eStunTimer[i] = 0;
        w.eStateFlags[i] = (w.eStateFlags[i]! & ~ENEMY_STATE_FLAG.STUNNED) & 0x3f;
      } else {
        w.eStunTimer[i] = nextStun;
      }
    }
    const type = w.eType[i]!;
    if (type === ENEMY_TYPE.BRUTE && w.eShieldBreakTimer[i]! > 0) {
      const nextBreak = w.eShieldBreakTimer[i]! - dt;
      if (nextBreak <= 0) {
        w.eShieldBreakTimer[i] = 0;
        w.eStateFlags[i] = (w.eStateFlags[i]! | ENEMY_STATE_FLAG.SHIELD_UP) & 0x3f;
      } else {
        w.eShieldBreakTimer[i] = nextBreak;
      }
    }

    // Apply knockback decay
    let ex = w.eX[i]!;
    let ey = w.eY[i]!;
    const kx = w.eKnockX[i]!;
    const ky = w.eKnockY[i]!;
    if (kx !== 0 || ky !== 0) {
      ex += kx * dt;
      ey += ky * dt;
      const damp = Math.exp(-8 * dt);
      const nkx = kx * damp;
      const nky = ky * damp;
      w.eKnockX[i] = Math.abs(nkx) < 1 ? 0 : nkx;
      w.eKnockY[i] = Math.abs(nky) < 1 ? 0 : nky;
    }

    if (w.eStunTimer[i]! > 0) {
      w.eX[i] = ex;
      w.eY[i] = ey;
      continue;
    }

    // Carrier periodically deploys escort drones
    if (type === ENEMY_TYPE.CARRIER) {
      const nextCt = w.eCarrierTimer[i]! - dt;
      if (nextCt <= 0) {
        w.eCarrierTimer[i] = C.carrierSpawnIntervalSec;
        spawnEnemyImmediate(w, ENEMY_TYPE.DRONE, ex, ey, w.eFlank[i]!);
      } else {
        w.eCarrierTimer[i] = nextCt;
      }
    }

    const radius = w.eRadius[i]!;
    const speed = w.eSpeed[i]!;
    const dps = w.eDps[i]!;
    let moveX = 0;
    let moveY = 0;
    let attackingBarricade = -1;

    // FR-9.15: If sealed corridor makes Core unreachable, attack nearest blocking barricade
    if (w.flowField.isUnreachable(ex, ey)) {
      const barIdx = findNearestBarricadeCell(ex, ey, w.bCellX, w.bCellY, w.bActive, maxB);
      if (barIdx >= 0) {
        w.eTarget[i] = 9; // barricade
        const bx = cellCenter(w.bCellX[barIdx]!);
        const by = cellCenter(w.bCellY[barIdx]!);
        const dx = bx - ex;
        const dy = by - ey;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius + C.cellSize * 0.75) {
          attackingBarricade = barIdx;
        } else if (dist > 1e-4) {
          moveX = dx / dist;
          moveY = dy / dist;
        }
      }
    } else if (type === ENEMY_TYPE.BRUTE || type === ENEMY_TYPE.BOSS) {
      const targetSlot = type === ENEMY_TYPE.BRUTE ? selectBruteTarget(w, ex, ey) : w.eTarget[i]!;
      w.eTarget[i] = targetSlot;
      if (targetSlot < C.maxPlayers) {
        const pb = playerBase(targetSlot);
        const px = state[pb + CYBER_PLAYER_OFFSET.x]!;
        const py = state[pb + CYBER_PLAYER_OFFSET.y]!;
        const dx = px - ex;
        const dy = py - ey;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius + C.playerRadius + 10) {
          w.pPendingDamage[targetSlot] = w.pPendingDamage[targetSlot]! + dps * dt;
        } else if (dist > 1e-4) {
          moveX = dx / dist;
          moveY = dy / dist;
        }
        if (w.eSpinTimer[i]! <= 0 && dist > 1e-4) {
          w.eHeading[i] = Math.atan2(dy, dx);
        }
      } else {
        w.flowField.sample(ex, ey, vec);
        moveX = vec.x;
        moveY = vec.y;
        if (w.eSpinTimer[i]! <= 0 && (moveX !== 0 || moveY !== 0)) {
          w.eHeading[i] = Math.atan2(moveY, moveX);
        }
      }
    } else {
      // Drones / Fast Drones / Carriers navigate along flow field directly toward Core
      w.eTarget[i] = 8;
      w.flowField.sample(ex, ey, vec);
      moveX = vec.x;
      moveY = vec.y;
      if (moveX !== 0 || moveY !== 0) {
        w.eHeading[i] = Math.atan2(moveY, moveX);
      }
    }

    if (attackingBarricade >= 0) {
      w.bPendingDamage[attackingBarricade] = w.bPendingDamage[attackingBarricade]! + dps * dt;
    } else if (moveX !== 0 || moveY !== 0) {
      const candX = ex + moveX * speed * dt;
      const candY = ey + moveY * speed * dt;
      const ccx = worldToCell(candX);
      const ccy = worldToCell(candY);
      if (w.flowField.isBlocked(ccx, ccy)) {
        // Blocked by barricade directly ahead -> attack it
        const barIdx = findNearestBarricadeCell(candX, candY, w.bCellX, w.bCellY, w.bActive, maxB);
        if (barIdx >= 0) {
          w.bPendingDamage[barIdx] = w.bPendingDamage[barIdx]! + dps * dt;
        }
      } else {
        ex = candX;
        ey = candY;
      }
    }

    // Core melee damage & contact stop
    const coreStopR = C.coreRadius + radius;
    const coreDistSq = ex * ex + ey * ey;
    if (coreDistSq <= (coreStopR + C.droneAttackRange) * (coreStopR + C.droneAttackRange)) {
      w.corePendingDamage += dps * dt;
    }
    if (coreDistSq < coreStopR * coreStopR) {
      const dist = Math.sqrt(coreDistSq);
      if (dist > 1e-4) {
        ex = (ex / dist) * coreStopR;
        ey = (ey / dist) * coreStopR;
      } else {
        ex = coreStopR;
        ey = 0;
      }
    }

    // Contact melee against overlapping active players for drones
    if (type !== ENEMY_TYPE.BRUTE && type !== ENEMY_TYPE.BOSS) {
      const hitR = radius + C.playerRadius;
      const hitRSq = hitR * hitR;
      for (let s = 0; s < C.maxPlayers; s += 1) {
        if (w.pJoined[s] === 0) continue;
        const pb = playerBase(s);
        if ((state[pb + CYBER_PLAYER_OFFSET.flags]! & CYBER_FLAG.ACTIVE) === 0) continue;
        const dx = state[pb + CYBER_PLAYER_OFFSET.x]! - ex;
        const dy = state[pb + CYBER_PLAYER_OFFSET.y]! - ey;
        if (dx * dx + dy * dy <= hitRSq) {
          w.pPendingDamage[s] = w.pPendingDamage[s]! + dps * dt;
        }
      }
    }

    const body = w.scratchBody;
    body.x = ex;
    body.y = ey;
    body.vx = 0;
    body.vy = 0;
    clampBoxBoundary(body, C.arenaSize, C.arenaSize, radius, 0);
    w.eX[i] = body.x;
    w.eY[i] = body.y;
  }

  rebuildEnemyGrid(w);
}

function processStage6DamageAndLifecycle(w: CyberWorld, dt: number): void {
  const state = w.state;
  const maxE = AUX_LAYOUT.MAX_ENEMIES;

  // 1. Apply enemy damage & release dead enemies
  for (let i = 0; i < maxE; i += 1) {
    if (!w.enemyPool.isActive(i)) continue;
    const dmg = w.ePendingDamage[i]!;
    w.ePendingDamage[i] = 0;
    if (dmg > 0) {
      w.eHp[i] = w.eHp[i]! - dmg;
      if (w.eHp[i]! <= 0) {
        w.eHp[i] = 0;
        w.eType[i] = ENEMY_TYPE.EMPTY;
        w.eStateFlags[i] = 0;
        if (w.bossEnemyIdx === i) {
          resetBossState(w);
        }
        w.enemyPool.release(i);
      } else if (w.bossEnemyIdx === i) {
        const hpRatio = w.eHp[i]! / w.eMaxHp[i]!;
        let nextBossPhase = 1;
        if (hpRatio <= C.bossPhase3Threshold) nextBossPhase = 3;
        else if (hpRatio <= C.bossPhase2Threshold) nextBossPhase = 2;
        if (nextBossPhase > state[CYBER_HEADER.bossPhase]!) {
          state[CYBER_HEADER.bossPhase] = nextBossPhase;
        }
      }
    }
  }

  // 2. Barricade damage & TTL expiry
  tickBarricades(w, dt);

  // 3. Apply player damage -> DOWNED transition
  for (let s = 0; s < C.maxPlayers; s += 1) {
    if (w.pJoined[s] === 0) continue;
    const dmg = w.pPendingDamage[s]!;
    w.pPendingDamage[s] = 0;
    if (dmg <= 0) continue;
    const pb = playerBase(s);
    if ((state[pb + CYBER_PLAYER_OFFSET.flags]! & CYBER_FLAG.ACTIVE) === 0) continue;
    const nextHp = state[pb + CYBER_PLAYER_OFFSET.hp]! - dmg;
    if (nextHp <= 0) {
      transitionPlayerToDowned(w, s);
    } else {
      state[pb + CYBER_PLAYER_OFFSET.hp] = nextHp;
    }
  }

  // 4. Revives, bleed-outs, respawns (with 3% Core cost, 12% cap, 1 HP floor)
  tickDownedReviveAndRespawn(w, dt);

  // 5. Squad EMP gather / decay / blast
  tickEmpSystem(w, dt);

  // 6. Core enemy damage & defeat check
  if (w.corePendingDamage > 0) {
    const nextCore = state[CYBER_HEADER.coreHp]! - w.corePendingDamage;
    w.corePendingDamage = 0;
    state[CYBER_HEADER.coreHp] = nextCore > 0 ? nextCore : 0;
  }

  if (state[CYBER_HEADER.coreHp]! <= 0) {
    state[CYBER_HEADER.coreHp] = 0;
    state[CYBER_HEADER.phaseEnum] = CYBER_PHASE.MATCH_OVER;
    state[CYBER_HEADER.phaseTimer] = 0;
    w.matchWon = false;
    return;
  }

  // 7. Wave completion check
  if (
    state[CYBER_HEADER.phaseEnum] === CYBER_PHASE.WAVE_ACTIVE &&
    w.enemyPool.activeCount() === 0 &&
    w.spawnCount === 0
  ) {
    const wave = Math.trunc(state[CYBER_HEADER.wave]!);
    if (wave >= C.totalWaves) {
      state[CYBER_HEADER.phaseEnum] = CYBER_PHASE.MATCH_OVER;
      state[CYBER_HEADER.phaseTimer] = 0;
      w.matchWon = true;
    } else {
      state[CYBER_HEADER.phaseEnum] = CYBER_PHASE.WAVE_BREAK;
      state[CYBER_HEADER.phaseTimer] = C.waveBreakSec;
      respawnAllPlayersForWaveBreak(w);
      const healed = state[CYBER_HEADER.coreHp]! + C.coreMaxHp * C.waveBreakCoreHealPct;
      state[CYBER_HEADER.coreHp] = healed > C.coreMaxHp ? C.coreMaxHp : healed;
    }
  }
}

export function createCyberCitadelSimulation(
  options: CyberSimOptions = {},
): CyberCitadelSimulation {
  const w = createCyberWorld(options.debugFlowField === true);

  function startMatch(slots: number[], seed?: number, roster?: CyberRosterMeta): void {
    w.rngState = (seed ?? C.defaultSeed) >>> 0;
    w.state.fill(0);
    w.auxState.fill(0);
    w.pJoined.fill(0);
    w.pIsBot.fill(0);
    w.pBotLevel.fill(0);
    w.pInputAxisX.fill(0);
    w.pInputAxisY.fill(0);
    w.pInputButtons.fill(0);
    w.pInputPrevButtons.fill(0);
    w.pInputEdge.fill(0);
    w.pVx.fill(0);
    w.pVy.fill(0);
    w.pDashTimer.fill(0);
    w.pDashDirX.fill(0);
    w.pDashDirY.fill(0);
    w.pShieldCooldown.fill(0);
    w.pAutoFireTimer.fill(0);
    w.pAutoFireTarget.fill(-1);
    w.pReviveOwner.fill(-1);
    w.pReviveTarget.fill(-1);
    w.pDisconnectTimer.fill(0);
    w.pPendingDamage.fill(0);
    w.pBossThreat.fill(0);
    resetAllPools(w);

    w.squadDamageDealt = 0;
    w.corePendingDamage = 0;
    w.waveRespawnSpent = 0;
    w.empFiredThisWave = false;
    w.matchWon = false;

    let initialConnected = 0;
    let humanCount = 0;
    const botLevelList: number[] = [];

    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      if (slot === undefined || slot !== (slot | 0) || slot < 0 || slot >= C.maxPlayers) continue;
      if (w.pJoined[slot] === 1) continue;
      w.pJoined[slot] = 1;
      initialConnected |= 1 << slot;

      const isBot = roster?.botMask?.[slot] === 1;
      w.pIsBot[slot] = isBot ? 1 : 0;
      const lvl = roster?.botLevels?.[slot] ?? C.standbyBotLevel;
      w.pBotLevel[slot] = isBot ? lvl : 0;
      if (isBot) {
        botLevelList.push(lvl);
      } else {
        humanCount += 1;
      }

      const pb = playerBase(slot);
      w.state[pb + CYBER_PLAYER_OFFSET.hp] = C.playerMaxHp;
      w.state[pb + CYBER_PLAYER_OFFSET.flags] =
        CYBER_FLAG.JOINED | CYBER_FLAG.ACTIVE | (isBot ? CYBER_FLAG.IS_BOT : 0);
      spawnPlayerNearCore(w, slot);
    }

    w.connectedMask = initialConnected;
    w.squadWeight = computeSquadWeight(humanCount, botLevelList);

    w.state[CYBER_HEADER.tickId] = 0;
    w.state[CYBER_HEADER.phaseEnum] = CYBER_PHASE.COUNTDOWN;
    w.state[CYBER_HEADER.phaseTimer] = C.countdownSec;
    w.state[CYBER_HEADER.wave] = 1;
    w.state[CYBER_HEADER.coreHp] = C.coreMaxHp;
    w.state[CYBER_HEADER.empCharge] = 0;
    w.state[CYBER_HEADER.empFiredCount] = 0;
    w.state[CYBER_HEADER.bossPhase] = 0;

    tickAndSyncAuxState(w);
  }

  function applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void {
    if (playerIndex !== (playerIndex | 0) || playerIndex < 0 || playerIndex >= C.maxPlayers) {
      return;
    }
    const cleanBtn = buttons & 0x0f;
    const prev = w.pInputPrevButtons[playerIndex]!;
    // Latch rising edge bits so fast taps are never missed before step()
    w.pInputEdge[playerIndex] = (w.pInputEdge[playerIndex]! | (cleanBtn & ~prev)) & 0x0f;
    w.pInputButtons[playerIndex] = cleanBtn;
    w.pInputPrevButtons[playerIndex] = cleanBtn;
    w.pInputAxisX[playerIndex] = axisX > 127 ? 127 : axisX < -127 ? -127 : axisX | 0;
    w.pInputAxisY[playerIndex] = axisY > 127 ? 127 : axisY < -127 ? -127 : axisY | 0;
  }

  function setConnectedMask(mask: number): void {
    const cleanMask = mask & 0xff;
    w.connectedMask = cleanMask;
    const state = w.state;

    for (let s = 0; s < C.maxPlayers; s += 1) {
      if (w.pJoined[s] === 0 || w.pIsBot[s] === 1) continue;
      const pb = playerBase(s);
      let flags = state[pb + CYBER_PLAYER_OFFSET.flags]!;
      const nowConnected = (cleanMask & (1 << s)) !== 0;
      const wasDisconnected = (flags & CYBER_FLAG.DISCONNECTED) !== 0;

      if (!nowConnected && !wasDisconnected) {
        // Human just went AWAY: cancel revive channel (FR-9.10) & leave EMP immediately (FR-9.11)
        flags = (flags | CYBER_FLAG.DISCONNECTED) & ~CYBER_FLAG.EMP_JOINED;
        cancelReviveChannelForReviver(w, s);
        w.pDisconnectTimer[s] = 0;
        state[pb + CYBER_PLAYER_OFFSET.flags] = flags;
      } else if (nowConnected && wasDisconnected) {
        // Human rejoined: hand back immediately from standby bot (FR-6 / FR-9.14)
        const wasStandby = (flags & CYBER_FLAG.STANDBY_BOT) !== 0;
        flags &= ~(CYBER_FLAG.DISCONNECTED | CYBER_FLAG.STANDBY_BOT);
        w.pDisconnectTimer[s] = 0;
        if (wasStandby) {
          cancelReviveChannelForReviver(w, s);
        }
        // If dead (RESPAWNING) during extended AWAY, respawn at Core without penalty (FR-9.14)
        if ((flags & CYBER_FLAG.RESPAWNING) !== 0) {
          flags = (flags & ~CYBER_FLAG.RESPAWNING) | CYBER_FLAG.ACTIVE;
          state[pb + CYBER_PLAYER_OFFSET.hp] = C.playerMaxHp;
          state[pb + CYBER_PLAYER_OFFSET.downTimer] = 0;
          spawnPlayerNearCore(w, s);
        }
        state[pb + CYBER_PLAYER_OFFSET.flags] = flags;
      }
    }
  }

  function step(dt: number): void {
    const stepDt = Number.isFinite(dt) && dt > 0 ? dt : C.dt;
    const state = w.state;
    state[CYBER_HEADER.tickId] = state[CYBER_HEADER.tickId]! + 1;

    const phase = state[CYBER_HEADER.phaseEnum]!;
    if (phase === CYBER_PHASE.MATCH_OVER) {
      w.pInputEdge.fill(0);
      tickAndSyncAuxState(w);
      return;
    }

    if (phase === CYBER_PHASE.COUNTDOWN) {
      const nextT = state[CYBER_HEADER.phaseTimer]! - stepDt;
      if (nextT <= 0) {
        state[CYBER_HEADER.phaseEnum] = CYBER_PHASE.WAVE_ACTIVE;
        state[CYBER_HEADER.phaseTimer] = 0;
        populateWaveSpawns(w, Math.trunc(state[CYBER_HEADER.wave]!));
      } else {
        state[CYBER_HEADER.phaseTimer] = nextT;
      }
      w.pInputEdge.fill(0);
      tickAndSyncAuxState(w);
      return;
    }

    if (phase === CYBER_PHASE.WAVE_BREAK) {
      // Allow players to move and position during breather break
      processStage1Inputs(w, stepDt);
      processDashStage(w, stepDt);
      tickBarricades(w, stepDt);
      w.flowField.rebuildIfDirty();
      const nextT = state[CYBER_HEADER.phaseTimer]! - stepDt;
      if (nextT <= 0) {
        const nextWave = Math.min(C.totalWaves, Math.trunc(state[CYBER_HEADER.wave]!) + 1);
        state[CYBER_HEADER.wave] = nextWave;
        state[CYBER_HEADER.phaseEnum] = CYBER_PHASE.WAVE_ACTIVE;
        state[CYBER_HEADER.phaseTimer] = 0;
        populateWaveSpawns(w, nextWave);
      } else {
        state[CYBER_HEADER.phaseTimer] = nextT;
      }
      w.pInputEdge.fill(0);
      tickAndSyncAuxState(w);
      return;
    }

    // WAVE_ACTIVE: Strict 6-stage fixed-step execution order (FR-4)
    // 1. Process inputs
    processStage1Inputs(w, stepDt);
    // 2. Apply dashes
    processDashStage(w, stepDt);
    // 3. Resolve rail beams
    processRailStage(w);
    // 4. Process auto-fire
    processAutoFireStage(w, stepDt);
    // 5. Update enemy movement & spawns
    processStage5Enemies(w, stepDt);
    // 6. Resolve damage, health & phase transitions
    processStage6DamageAndLifecycle(w, stepDt);

    w.pInputEdge.fill(0);
    tickAndSyncAuxState(w);
  }

  return {
    state: w.state,
    auxState: w.auxState,
    startMatch,
    applyInput,
    setConnectedMask,
    step,
    getSquadWeight: () => w.squadWeight,
    getMatchWon: () => w.matchWon,
    getDebugStats: () => ({
      activeEnemies: w.enemyPool.activeCount(),
      queuedEnemies: w.spawnCount,
      activeBarricades: w.barPool.activeCount(),
      squadDamage: Math.floor(w.squadDamageDealt),
      waveRespawnSpent: w.waveRespawnSpent,
      flowRebuildCount: w.flowField.rebuildCount,
    }),
    jumpToWave(wave: number): void {
      resetAllPools(w);
      const clamped = Math.max(1, Math.min(C.totalWaves, Math.trunc(wave)));
      w.state[CYBER_HEADER.wave] = clamped;
      w.state[CYBER_HEADER.phaseEnum] = CYBER_PHASE.WAVE_ACTIVE;
      w.state[CYBER_HEADER.phaseTimer] = 0;
      populateWaveSpawns(w, clamped);
      tickAndSyncAuxState(w);
    },
    clearSpawnQueueForTest(): void {
      clearSpawnQueue(w);
    },
    spawnEnemyForTest(
      type: number,
      x: number,
      y: number,
      heading?: number,
      hpOverride?: number,
    ): number {
      const id = spawnEnemyImmediate(w, type, x, y, 0, heading, hpOverride);
      if (id >= 0) {
        rebuildEnemyGrid(w);
        tickAndSyncAuxState(w);
      }
      return id;
    },
    damageEnemyForTest(enemyIdx: number, damage: number): void {
      if (!w.enemyPool.isActive(enemyIdx)) return;
      w.ePendingDamage[enemyIdx] = w.ePendingDamage[enemyIdx]! + damage;
      w.squadDamageDealt += damage;
    },
    clearAllEnemiesForTest(): void {
      clearSpawnQueue(w);
      for (let i = 0; i < AUX_LAYOUT.MAX_ENEMIES; i += 1) {
        if (w.enemyPool.isActive(i)) {
          w.eHp[i] = 0;
          w.eType[i] = ENEMY_TYPE.EMPTY;
          w.eStateFlags[i] = 0;
          w.enemyPool.release(i);
        }
      }
      resetBossState(w);
      rebuildEnemyGrid(w);
    },
    downPlayerForTest(slot: number): void {
      if (slot < 0 || slot >= C.maxPlayers) return;
      transitionPlayerToDowned(w, slot);
    },
  };
}
