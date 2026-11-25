import type { Envelope } from '../../../shared/src/types/envelope.ts';
import { hasUniqueWinner } from './scoreboard';

const TICK = 0;
const PHASE = 1;
const HIT = 6;
const PLAYER = 8;
const STRIDE = 10;
const FLAGS = 8;
const SCORE = 9;
const STUN = 7;
const COUNTDOWN = 0;
const ROUND_END = 2;
const SLOTS = 8;

export function eventsFromHeaderDiff(prev: Float32Array, next: Float32Array): Envelope[] {
  const events: Envelope[] = [];
  const prevPhase = prev[PHASE] ?? 0;
  const nextPhase = next[PHASE] ?? 0;
  const alive = aliveCount(next);

  for (let index = 0; index < SLOTS; index += 1) {
    const wasAlive = ((prev[PLAYER + index * STRIDE + FLAGS] ?? 0) & 1) !== 0;
    const isAlive = ((next[PLAYER + index * STRIDE + FLAGS] ?? 0) & 1) !== 0;
    if (!wasAlive || isAlive) continue;
    events.push(envelope('sumo:elimination', {
      playerIndex: index,
      knockedBy: null,
      aliveCount: alive,
    }));
    events.push(envelope('sumo:haptic', { intensity: 'out' }));
  }

  if (impactStarted(prev, next)) {
    events.push(envelope('sumo:haptic', { intensity: 'heavy' }));
  }

  if (nextPhase === ROUND_END && prevPhase !== ROUND_END) {
    events.push(envelope('sumo:round_end', {
      winnerIndex: roundWinner(prev, next),
      scores: scoreList(next),
      matchOver: hasUniqueWinner(next),
    }));
  }

  const prevTick = prev[TICK] ?? 0;
  const nextTick = next[TICK] ?? 0;
  const opened = nextPhase === COUNTDOWN && (prevPhase !== COUNTDOWN || (prevTick === 0 && nextTick > 0));
  if (opened) {
    events.push(envelope('sumo:round_start', {
      roundNumber: scoreSum(next) + 1,
      countdownMs: 3000,
      scores: scoreList(next),
    }));
  }

  return events;
}

function envelope(type: string, payload: unknown): Envelope {
  return { type, roomId: '', payload };
}

function aliveCount(state: Float32Array): number {
  let count = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    if (((state[PLAYER + index * STRIDE + FLAGS] ?? 0) & 1) !== 0) count += 1;
  }
  return count;
}

function impactStarted(prev: Float32Array, next: Float32Array): boolean {
  if ((next[HIT] ?? 0) > (prev[HIT] ?? 0)) return true;
  for (let index = 0; index < SLOTS; index += 1) {
    const nextStun = next[PLAYER + index * STRIDE + STUN] ?? 0;
    const prevStun = prev[PLAYER + index * STRIDE + STUN] ?? 0;
    if (nextStun > prevStun) return true;
  }
  return false;
}

function roundWinner(prev: Float32Array, next: Float32Array): number | null {
  let survivor = -1;
  let alive = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    if (((next[PLAYER + index * STRIDE + FLAGS] ?? 0) & 1) !== 0) {
      survivor = index;
      alive += 1;
    }
  }
  if (alive === 1) return survivor;
  let bestSlot: number | null = null;
  let bestGain = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    const before = prev[PLAYER + index * STRIDE + SCORE] ?? 0;
    const after = next[PLAYER + index * STRIDE + SCORE] ?? 0;
    const gain = after - before;
    if (gain > bestGain) {
      bestGain = gain;
      bestSlot = index;
    }
  }
  return bestSlot;
}

function scoreSum(state: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    sum += state[PLAYER + index * STRIDE + SCORE] ?? 0;
  }
  return sum;
}

function scoreList(state: Float32Array): number[] {
  return [
    state[PLAYER + SCORE] ?? 0,
    state[PLAYER + STRIDE + SCORE] ?? 0,
    state[PLAYER + STRIDE * 2 + SCORE] ?? 0,
    state[PLAYER + STRIDE * 3 + SCORE] ?? 0,
    state[PLAYER + STRIDE * 4 + SCORE] ?? 0,
    state[PLAYER + STRIDE * 5 + SCORE] ?? 0,
    state[PLAYER + STRIDE * 6 + SCORE] ?? 0,
    state[PLAYER + STRIDE * 7 + SCORE] ?? 0,
  ];
}
