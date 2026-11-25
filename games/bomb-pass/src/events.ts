import type { Envelope } from '../../../shared/src/types/envelope.ts';
import {
  BOMB_CONSTANTS as C,
  BOMB_FLAG_ALIVE,
  BOMB_FLAG_DISCONNECTED,
  BOMB_FLAG_EXPLODED,
  BOMB_HEADER as H,
  BOMB_PHASE as P,
  BOMB_PLAYER_BASE as PLAYER,
  BOMB_PLAYER_STRIDE as STRIDE,
} from './constants.ts';
import { hasUniqueWinner, isRoundSuddenDeath, isSuddenDeath } from './scoreboard.ts';

const SLOTS = C.maxPlayers;

export function eventsFromHeaderDiff(prev: Float32Array, next: Float32Array): Envelope[] {
  const events: Envelope[] = [];
  const prevPhase = prev[H.phase] ?? 0;
  const nextPhase = next[H.phase] ?? 0;
  const prevHolder = Math.round(prev[H.bombHolder] ?? -1);
  const nextHolder = Math.round(next[H.bombHolder] ?? -1);
  const alive = aliveCount(next);

  // 1. Detect explosions (players losing ALIVE with EXPLODED_THIS_ROUND set)
  const eliminated: number[] = [];
  for (let index = 0; index < SLOTS; index += 1) {
    const prevFlags = prev[PLAYER + index * STRIDE + 8] ?? 0;
    const nextFlags = next[PLAYER + index * STRIDE + 8] ?? 0;
    const wasAlive = (prevFlags & BOMB_FLAG_ALIVE) !== 0;
    const isAlive = (nextFlags & BOMB_FLAG_ALIVE) !== 0;
    const exploded = (nextFlags & BOMB_FLAG_EXPLODED) !== 0;
    if (wasAlive && !isAlive && exploded) {
      eliminated.push(index);
    }
  }

  if (eliminated.length > 0) {
    const originSlot = prevHolder >= 0 && eliminated.includes(prevHolder)
      ? prevHolder
      : (eliminated[0] ?? 0);
    const originBase = PLAYER + originSlot * STRIDE;
    events.push(envelope('bomb:explosion', {
      eliminatedIndices: eliminated,
      blastX: next[originBase] ?? 0,
      blastY: next[originBase + 1] ?? 0,
      aliveCount: alive,
      suddenDeathTriggered: isRoundSuddenDeath(next) && alive === 0,
    }));
    events.push(envelope('bomb:haptic', { intensity: 'explosion', targetSlot: null }));
    for (const slot of eliminated) {
      events.push(envelope('bomb:haptic', { intensity: 'out', targetSlot: slot }));
    }
  }

  // 2. Detect bomb holder changes (assign, transfer, disconnect, clear)
  if (prevHolder !== nextHolder) {
    let reason: 'assign' | 'transfer' | 'disconnect' | 'clear';
    if (nextHolder < 0) {
      reason = 'clear';
    } else if (prevHolder < 0) {
      reason = 'assign';
    } else if (
      prevHolder < SLOTS
      && (((next[PLAYER + prevHolder * STRIDE + 8] ?? 0) & BOMB_FLAG_DISCONNECTED) !== 0)
    ) {
      reason = 'disconnect';
    } else {
      reason = 'transfer';
    }

    events.push(envelope('bomb:holder', {
      holderIndex: nextHolder,
      previousHolder: prevHolder,
      remainingMs: Math.max(0, Math.round((next[H.bombTimer] ?? 0) * 1000)),
      transferCooldownMs: Math.max(0, Math.round((next[H.transferCooldown] ?? 0) * 1000)),
      reason,
    }));

    if (reason === 'transfer' || reason === 'disconnect') {
      events.push(envelope('bomb:haptic', { intensity: 'transfer', targetSlot: nextHolder }));
    }
  } else if (nextHolder >= 0 && nextPhase === P.active) {
    // 3. Fuse urgency crossing cues
    const prevTimer = prev[H.bombTimer] ?? 0;
    const nextTimer = next[H.bombTimer] ?? 0;
    if (prevTimer > C.warnThreshold && nextTimer <= C.warnThreshold) {
      events.push(envelope('bomb:haptic', { intensity: 'warn', targetSlot: nextHolder }));
    }
    if (prevTimer > C.criticalThreshold && nextTimer <= C.criticalThreshold) {
      events.push(envelope('bomb:haptic', { intensity: 'critical', targetSlot: nextHolder }));
    }
  }

  // 4. Round end
  if (nextPhase === P.roundEnd && prevPhase !== P.roundEnd) {
    events.push(envelope('bomb:round_end', {
      winnerIndex: roundWinner(prev, next),
      scores: scoreList(next),
      matchOver: hasUniqueWinner(next),
      suddenDeath: isSuddenDeath(next),
    }));
  }

  // 5. Round start (entering COUNTDOWN)
  const prevTick = prev[H.tick] ?? 0;
  const nextTick = next[H.tick] ?? 0;
  const opened = nextPhase === P.countdown
    && (prevPhase !== P.countdown || (prevTick === 0 && nextTick > 0));
  if (opened) {
    events.push(envelope('bomb:round_start', {
      roundNumber: scoreSum(next) + 1,
      countdownMs: Math.round(C.countdown * 1000),
      scores: scoreList(next),
      suddenDeath: isSuddenDeath(next),
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
    if (((state[PLAYER + index * STRIDE + 8] ?? 0) & BOMB_FLAG_ALIVE) !== 0) count += 1;
  }
  return count;
}

function roundWinner(prev: Float32Array, next: Float32Array): number | null {
  let survivor = -1;
  let alive = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    if (((next[PLAYER + index * STRIDE + 8] ?? 0) & BOMB_FLAG_ALIVE) !== 0) {
      survivor = index;
      alive += 1;
    }
  }
  if (alive === 1) return survivor;
  if (alive === 0) return null;
  let bestSlot: number | null = null;
  let bestGain = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    const before = prev[PLAYER + index * STRIDE + 9] ?? 0;
    const after = next[PLAYER + index * STRIDE + 9] ?? 0;
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
    sum += state[PLAYER + index * STRIDE + 9] ?? 0;
  }
  return sum;
}

function scoreList(state: Float32Array): number[] {
  return [
    state[PLAYER + 9] ?? 0,
    state[PLAYER + STRIDE + 9] ?? 0,
    state[PLAYER + STRIDE * 2 + 9] ?? 0,
    state[PLAYER + STRIDE * 3 + 9] ?? 0,
    state[PLAYER + STRIDE * 4 + 9] ?? 0,
    state[PLAYER + STRIDE * 5 + 9] ?? 0,
    state[PLAYER + STRIDE * 6 + 9] ?? 0,
    state[PLAYER + STRIDE * 7 + 9] ?? 0,
  ];
}
