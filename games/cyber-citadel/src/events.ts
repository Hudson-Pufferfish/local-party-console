import type { Envelope } from '../../../shared/src/types/envelope.ts';
import { PAD_STATE_TYPE, type PadStatePayload } from '../../../shared/src/types/game-control.ts';
import {
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PHASE,
  CYBER_PLAYER_OFFSET,
} from './constants.ts';
import { playerBase } from './state.ts';

const REVIVE_RANGE_SQ = C.reviveRange * C.reviveRange;
const EMP_RING_SQ = C.empRingRadius * C.empRingRadius;

function envelope(type: string, payload: unknown): Envelope {
  return { type, roomId: '', payload };
}

function hasDownedAllyInRange(state: Float32Array, slot: number): boolean {
  const base = playerBase(slot);
  const px = state[base + CYBER_PLAYER_OFFSET.x] ?? 0;
  const py = state[base + CYBER_PLAYER_OFFSET.y] ?? 0;

  for (let other = 0; other < C.maxPlayers; other += 1) {
    if (other === slot) continue;
    const oBase = playerBase(other);
    const oFlags = state[oBase + CYBER_PLAYER_OFFSET.flags] ?? 0;
    if ((oFlags & CYBER_FLAG.JOINED) === 0 || (oFlags & CYBER_FLAG.DOWNED) === 0) continue;
    const dx = (state[oBase + CYBER_PLAYER_OFFSET.x] ?? 0) - px;
    const dy = (state[oBase + CYBER_PLAYER_OFFSET.y] ?? 0) - py;
    if (dx * dx + dy * dy <= REVIVE_RANGE_SQ) return true;
  }
  return false;
}

function computeSlotPadContext(
  state: Float32Array,
  slot: number,
  empFiredThisWave: boolean,
): { yLabel: string; disabled: number } {
  const base = playerBase(slot);
  const flags = state[base + CYBER_PLAYER_OFFSET.flags] ?? 0;

  if ((flags & CYBER_FLAG.ACTIVE) === 0) {
    // Downed or respawning: dim all 4 action buttons
    return { yLabel: 'REVIVE', disabled: 0x0f };
  }

  let disabled = 0;
  const barricades = state[base + CYBER_PLAYER_OFFSET.barricades] ?? 0;
  if (barricades >= C.barricadeMaxPerPlayer) {
    disabled |= 0x04; // X SHIELD at cap
  }

  if (hasDownedAllyInRange(state, slot)) {
    return { yLabel: 'REVIVE', disabled };
  }
  if ((flags & CYBER_FLAG.EMP_JOINED) !== 0) {
    return { yLabel: 'JOINED', disabled };
  }
  const x = state[base + CYBER_PLAYER_OFFSET.x] ?? 0;
  const y = state[base + CYBER_PLAYER_OFFSET.y] ?? 0;
  if (!empFiredThisWave && x * x + y * y <= EMP_RING_SQ) {
    return { yLabel: 'BOMB', disabled };
  }
  return { yLabel: 'REVIVE', disabled: disabled | 0x08 };
}

export function buildCyberRehydrateEvents(
  state: Float32Array,
  slot: number,
  nowMs: number = Date.now(),
): Envelope[] {
  if (slot < 0 || slot >= C.maxPlayers) return [];
  const base = playerBase(slot);
  const flags = state[base + CYBER_PLAYER_OFFSET.flags] ?? 0;
  if ((flags & CYBER_FLAG.JOINED) === 0) return [];

  const wave = Math.trunc(state[CYBER_HEADER.wave] ?? 1);
  const empFired = (state[CYBER_HEADER.empFiredCount] ?? 0) > 0;
  const ctx = computeSlotPadContext(state, slot, empFired);
  const railCd = state[base + CYBER_PLAYER_OFFSET.railCooldown] ?? 0;
  const dashCd = state[base + CYBER_PLAYER_OFFSET.dashCooldown] ?? 0;
  const payload: PadStatePayload = {
    slot,
    labels: ['LASER', 'DASH', 'WALL', ctx.yLabel],
    disabled: ctx.disabled,
    cooldownEndsAt: [
      railCd > 0 ? Math.round(nowMs + railCd * 1000) : 0,
      dashCd > 0 ? Math.round(nowMs + dashCd * 1000) : 0,
      0,
      0,
    ],
  };
  const events: Envelope[] = [envelope(PAD_STATE_TYPE, payload)];
  events.push(envelope('cyber:wave_start', { wave }));
  if ((flags & CYBER_FLAG.DOWNED) !== 0) {
    events.push(envelope('cyber:downed', { slot }));
  }
  return events;
}

export function createCyberEventsDiff(): (prev: Float32Array, next: Float32Array) => Envelope[] {
  const lastYLabel = ['', '', '', '', '', '', '', ''];
  const lastDisabled = new Int16Array(C.maxPlayers).fill(-1);
  let empFiredThisWave = false;
  let lastWaveSeen = 0;

  return (prev: Float32Array, next: Float32Array): Envelope[] => {
    const prevTick = prev[CYBER_HEADER.tickId] ?? 0;
    const nextTick = next[CYBER_HEADER.tickId] ?? 0;
    const events: Envelope[] = [];
    const prevPhase = prev[CYBER_HEADER.phaseEnum] ?? 0;
    const nextPhase = next[CYBER_HEADER.phaseEnum] ?? 0;
    const prevWave = Math.trunc(prev[CYBER_HEADER.wave] ?? 1);
    const nextWave = Math.trunc(next[CYBER_HEADER.wave] ?? 1);
    const prevEmp = Math.trunc(prev[CYBER_HEADER.empFiredCount] ?? 0);
    const nextEmp = Math.trunc(next[CYBER_HEADER.empFiredCount] ?? 0);

    // Reset per-match / per-wave cache when a fresh match or wave starts or simulation resets
    if (
      prevTick === 0 ||
      nextTick <= prevTick ||
      (nextPhase === CYBER_PHASE.COUNTDOWN && prevPhase !== CYBER_PHASE.COUNTDOWN)
    ) {
      empFiredThisWave = false;
      lastWaveSeen = nextWave;
      lastDisabled.fill(-1);
      for (let i = 0; i < C.maxPlayers; i += 1) lastYLabel[i] = '';
    }
    if (nextWave !== lastWaveSeen) {
      empFiredThisWave = false;
      lastWaveSeen = nextWave;
    }
    if (nextEmp > prevEmp) {
      empFiredThisWave = true;
      events.push(envelope('cyber:emp', { wave: nextWave }));
    }

    if (nextPhase === CYBER_PHASE.WAVE_ACTIVE && prevPhase !== CYBER_PHASE.WAVE_ACTIVE) {
      events.push(envelope('cyber:wave_start', { wave: nextWave }));
    }
    if (nextPhase === CYBER_PHASE.WAVE_BREAK && prevPhase !== CYBER_PHASE.WAVE_BREAK) {
      events.push(
        envelope('cyber:wave_end', {
          wave: prevWave,
          coreHp: Math.round(next[CYBER_HEADER.coreHp] ?? 0),
        }),
      );
    }
    if (nextPhase === CYBER_PHASE.MATCH_OVER && prevPhase !== CYBER_PHASE.MATCH_OVER) {
      const coreHp = next[CYBER_HEADER.coreHp] ?? 0;
      const won = coreHp > 0 && nextWave >= C.totalWaves;
      const wavesCleared = won ? C.totalWaves : Math.max(0, nextWave - 1);
      events.push(envelope('cyber:match_end', { won, wavesCleared }));
    }

    const nowMs = Date.now();
    for (let s = 0; s < C.maxPlayers; s += 1) {
      const base = playerBase(s);
      const prevFlags = prev[base + CYBER_PLAYER_OFFSET.flags] ?? 0;
      const nextFlags = next[base + CYBER_PLAYER_OFFSET.flags] ?? 0;
      if ((nextFlags & CYBER_FLAG.JOINED) === 0) continue;

      const wasDowned = (prevFlags & CYBER_FLAG.DOWNED) !== 0;
      const wasRespawning = (prevFlags & CYBER_FLAG.RESPAWNING) !== 0;
      const isDowned = (nextFlags & CYBER_FLAG.DOWNED) !== 0;
      const isActive = (nextFlags & CYBER_FLAG.ACTIVE) !== 0;

      if (!wasDowned && isDowned) {
        events.push(envelope('cyber:downed', { slot: s }));
      } else if ((wasDowned || wasRespawning) && !isDowned && isActive) {
        events.push(envelope('cyber:revived', { slot: s }));
      }

      // Edge-triggered pad:state: emit ONLY on label, disabled mask, or cooldown trigger/clear
      const ctx = computeSlotPadContext(next, s, empFiredThisWave);
      const prevRail = prev[base + CYBER_PLAYER_OFFSET.railCooldown] ?? 0;
      const nextRail = next[base + CYBER_PLAYER_OFFSET.railCooldown] ?? 0;
      const prevDash = prev[base + CYBER_PLAYER_OFFSET.dashCooldown] ?? 0;
      const nextDash = next[base + CYBER_PLAYER_OFFSET.dashCooldown] ?? 0;

      const railChanged = nextRail > prevRail + 0.05 || (prevRail > 0 && nextRail === 0);
      const dashChanged = nextDash > prevDash + 0.05 || (prevDash > 0 && nextDash === 0);
      const ctxChanged = lastYLabel[s] !== ctx.yLabel || lastDisabled[s] !== ctx.disabled;

      if (ctxChanged || railChanged || dashChanged) {
        lastYLabel[s] = ctx.yLabel;
        lastDisabled[s] = ctx.disabled;
        const payload: PadStatePayload = {
          slot: s,
          labels: ['LASER', 'DASH', 'WALL', ctx.yLabel],
          disabled: ctx.disabled,
          ...(railChanged || dashChanged
            ? {
                cooldownEndsAt: [
                  nextRail > 0 ? Math.round(nowMs + nextRail * 1000) : 0,
                  nextDash > 0 ? Math.round(nowMs + nextDash * 1000) : 0,
                  0,
                  0,
                ],
              }
            : {}),
        };
        events.push(envelope(PAD_STATE_TYPE, payload));
      }
    }

    return events;
  };
}
