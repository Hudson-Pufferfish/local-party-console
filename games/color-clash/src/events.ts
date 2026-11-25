import type { Envelope } from '../../../shared/src/types/envelope.ts';
import {
  COLOR_CLASH_CONSTANTS as C,
  FLAG_CONTENDER,
  PHASE_COUNTDOWN,
  PHASE_FINAL_REVEAL,
  PHASE_OVERTIME,
  PHASE_ROUND_ACTIVE,
} from './constants.ts';

const TICK = 0;
const PHASE = 1;
const GOLDEN = 4;
const HIT = 6;
const WINNER = 7;
const PLAYER = 8;
const STRIDE = 10;
const BOOST_ACTIVE = 6;
const PAINT_PCT = 7;
const FLAGS = 8;
const PAINT_CELLS = 9;
const SLOTS = 8;
const SCORE_THROTTLE_TICKS = 30; // 120Hz / 30 = 4Hz max

export function eventsFromHeaderDiff(prev: Float32Array, next: Float32Array): Envelope[] {
  const events: Envelope[] = [];
  const prevTick = prev[TICK] ?? 0;
  const nextTick = next[TICK] ?? 0;
  const prevPhase = prev[PHASE] ?? 0;
  const nextPhase = next[PHASE] ?? 0;

  const opened =
    nextPhase === PHASE_COUNTDOWN && (prevPhase !== PHASE_COUNTDOWN || (prevTick === 0 && nextTick > 0));
  if (opened) {
    events.push(envelope('color:match_start', {
      durationMs: C.matchDuration * 1000,
      countdownMs: C.countdown * 1000,
    }));
  }

  for (let index = 0; index < SLOTS; index += 1) {
    const base = PLAYER + index * STRIDE;
    const prevActive = prev[base + BOOST_ACTIVE] ?? 0;
    const nextActive = next[base + BOOST_ACTIVE] ?? 0;
    if (nextActive > prevActive && nextActive > 0) {
      events.push(envelope('color:boost', {
        playerIndex: index,
        activeMs: C.boostActive * 1000,
        cooldownMs: C.boostCooldown * 1000,
      }));
      events.push(envelope('color:haptic', {
        playerIndex: index,
        intensity: 'light',
      }));
    }
  }

  if (nextPhase === PHASE_OVERTIME && prevPhase !== PHASE_OVERTIME) {
    let contenderMask = 0;
    for (let index = 0; index < SLOTS; index += 1) {
      if (((next[PLAYER + index * STRIDE + FLAGS] ?? 0) & FLAG_CONTENDER) !== 0) {
        contenderMask |= 1 << index;
      }
    }
    events.push(envelope('color:overtime', {
      contenderMask,
      goldenCell: next[GOLDEN] ?? -1,
      durationMs: C.overtimeDuration * 1000,
    }));
  }

  if ((next[HIT] ?? 0) > (prev[HIT] ?? 0)) {
    const goldenCapture =
      prevPhase === PHASE_OVERTIME
      && nextPhase === PHASE_FINAL_REVEAL
      && (prev[GOLDEN] ?? -1) >= 0;
    events.push(envelope('color:haptic', {
      intensity: goldenCapture ? 'golden' : 'heavy',
    }));
  }

  if (nextPhase === PHASE_FINAL_REVEAL && prevPhase !== PHASE_FINAL_REVEAL) {
    events.push(envelope('color:match_end', {
      winnerIndex: Math.trunc(next[WINNER] ?? -1),
      percents: percentList(next),
      cells: cellList(next),
      overtime: prevPhase === PHASE_OVERTIME,
    }));
  }

  const activeScoring = nextPhase === PHASE_ROUND_ACTIVE || nextPhase === PHASE_OVERTIME;
  const throttleTick =
    Math.floor(nextTick / SCORE_THROTTLE_TICKS) > Math.floor(prevTick / SCORE_THROTTLE_TICKS);
  if (activeScoring && (throttleTick || prevPhase !== nextPhase)) {
    events.push(envelope('color:scores', {
      percents: percentList(next),
    }));
  }

  return events;
}

function envelope(type: string, payload: unknown): Envelope {
  return { type, roomId: '', payload };
}

function percentList(state: Float32Array): number[] {
  const list: number[] = [];
  for (let index = 0; index < SLOTS; index += 1) {
    const raw = state[PLAYER + index * STRIDE + PAINT_PCT] ?? 0;
    list.push(Math.round(raw * 10) / 10);
  }
  return list;
}

function cellList(state: Float32Array): number[] {
  const list: number[] = [];
  for (let index = 0; index < SLOTS; index += 1) {
    list.push(Math.trunc(state[PLAYER + index * STRIDE + PAINT_CELLS] ?? 0));
  }
  return list;
}
