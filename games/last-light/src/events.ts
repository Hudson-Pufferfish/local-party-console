import type { Envelope } from '../../../shared/src/types/envelope.ts';
import {
  LAMP_FLAG,
  LAST_LIGHT_CONSTANTS as C,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
} from './constants.ts';
import { hasUniqueWinner, isSuddenDeath } from './scoreboard.ts';
import {
  readContenderMask,
  readLockedMask,
  readOutMask,
  readPlayerLastRoundPoints,
  readScoresArray,
} from './state.ts';
import type { LightPhase } from './types.ts';

function envelope(type: string, payload: unknown): Envelope {
  return { type, roomId: '', payload };
}

function roundWinnerIndex(state: Float32Array): number | null {
  if ((((state[H.lampFlags] ?? 0) | 0) & LAMP_FLAG.voidRound) !== 0) return null;
  let bestSlot: number | null = null;
  let bestPts = 0;
  let ties = 0;
  for (let slot = 0; slot < C.maxPlayers; slot += 1) {
    const pts = readPlayerLastRoundPoints(state, slot);
    if (pts > bestPts) {
      bestPts = pts;
      bestSlot = slot;
      ties = 1;
    } else if (pts === bestPts && pts > 0) {
      ties += 1;
    }
  }
  return ties === 1 ? bestSlot : null;
}

export function buildLightStateEnvelope(state: Float32Array): Envelope {
  const phase = (state[H.phase] ?? P.countdown) as LightPhase;
  return envelope('light:state', {
    phase,
    lockedMask: readLockedMask(state),
    contenderMask: readContenderMask(state),
    scores: readScoresArray(state),
  });
}

export function createLastLightEventsDiff(): (
  prev: Float32Array,
  next: Float32Array,
  matchTarget?: number,
) => Envelope[] {
  let breakNumber = 0;
  let roundNumber = 0;

  return function eventsFromHeaderDiff(
    prev: Float32Array,
    next: Float32Array,
    matchTarget?: number,
  ): Envelope[] {
    const prevTick = prev[H.tick] ?? 0;
    const nextTick = next[H.tick] ?? 0;
    if (nextTick <= prevTick) {
      breakNumber = 0;
      roundNumber = 0;
    }

    const events: Envelope[] = [];
    const prevPhase = prev[H.phase] ?? P.countdown;
    const nextPhase = next[H.phase] ?? P.countdown;
    const firstTick = prevTick === 0 && nextTick > 0;

    // 1. Entering PRACTICE
    if (nextPhase === P.practice && (prevPhase !== P.practice || firstTick)) {
      breakNumber += 1;
      const durationMs: 30000 | 20000 = (next[H.phaseTimer] ?? 0) > 25 ? 30000 : 20000;
      events.push(
        envelope('light:practice_start', {
          durationMs,
          breakNumber,
        }),
      );
    }

    // 2. Entering COUNTDOWN (round start)
    if (nextPhase === P.countdown && (prevPhase !== P.countdown || firstTick)) {
      roundNumber += 1;
      events.push(
        envelope('light:round_start', {
          roundNumber,
          countdownMs: Math.round(C.countdown * 1000),
          scores: readScoresArray(next),
          suddenDeath: isSuddenDeath(next, matchTarget),
          contenderMask: readContenderMask(next),
        }),
      );
    }

    // 3. New locks during active blowout (scored or practice) — INV-8: mask only, zero timestamps.
    const prevLockedMask = readLockedMask(prev);
    const nextLockedMask = readLockedMask(next);
    if (
      (nextPhase === P.active || nextPhase === P.practice)
      && (nextLockedMask & ~prevLockedMask) !== 0
    ) {
      events.push(
        envelope('light:lock', {
          lockedMask: nextLockedMask,
        }),
      );
    }

    // 4. Blowout beat (scored or practice) — drives synced controller flash + haptics.
    const prevBlowouts = prev[H.blowoutCount] ?? 0;
    const nextBlowouts = next[H.blowoutCount] ?? 0;
    if (nextBlowouts > prevBlowouts) {
      const lampFlags = (next[H.lampFlags] ?? 0) | 0;
      events.push(
        envelope('light:blowout', {
          lockedMask: nextLockedMask,
          outMask: readOutMask(next),
          practice: (lampFlags & LAMP_FLAG.practiceBlowout) !== 0,
        }),
      );
    }

    // 5. Entering ROUND_END
    if (nextPhase === P.roundEnd && prevPhase !== P.roundEnd) {
      const lampFlags = (next[H.lampFlags] ?? 0) | 0;
      events.push(
        envelope('light:round_end', {
          winnerIndex: roundWinnerIndex(next),
          scores: readScoresArray(next),
          matchOver: hasUniqueWinner(next, matchTarget),
          suddenDeath: isSuddenDeath(next, matchTarget),
          void: (lampFlags & LAMP_FLAG.voidRound) !== 0,
        }),
      );
    }

    // 6. Entering MATCH_OVER
    if (nextPhase === P.matchOver && prevPhase !== P.matchOver) {
      const winner = Math.round(next[H.winnerSlot] ?? -1);
      events.push(
        envelope('light:match_end', {
          winnerIndex: winner,
          scores: readScoresArray(next),
        }),
      );
    }

    return events;
  };
}
