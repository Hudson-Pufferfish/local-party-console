import { expect, test } from 'vitest';
import {
  BOMB_CONSTANTS as C,
  BOMB_FLAG_ALIVE,
  BOMB_FLAG_DISCONNECTED,
  BOMB_FLAG_EXPLODED,
  BOMB_FLAG_HOLDING,
  BOMB_HEADER as H,
  BOMB_PHASE as P,
  BOMB_PLAYER_BASE as PLAYER,
  BOMB_PLAYER_STRIDE as STRIDE,
  BOMB_ROUND_FLAG as RF,
} from './constants.ts';
import { eventsFromHeaderDiff } from './events.ts';

function blankState(): Float32Array {
  const s = new Float32Array(C.stateFloats);
  s[H.arenaRadius] = C.arenaRadius;
  s[H.bombHolder] = -1;
  return s;
}

function setPuck(
  s: Float32Array,
  slot: number,
  x: number,
  y: number,
  flags: number,
  score = 0,
): void {
  const base = PLAYER + slot * STRIDE;
  s[base] = x;
  s[base + 1] = y;
  s[base + 8] = flags;
  s[base + 9] = score;
}

test('eventsFromHeaderDiff emits bomb:round_start, bomb:holder, bomb:haptic, bomb:explosion, and bomb:round_end', () => {
  // 1. PRACTICE -> COUNTDOWN emits bomb:round_start
  const p1 = blankState();
  p1[H.phase] = P.practice;
  setPuck(p1, 0, 240, 0, BOMB_FLAG_ALIVE, 0);
  setPuck(p1, 1, -240, 0, BOMB_FLAG_ALIVE, 0);
  const n1 = new Float32Array(p1);
  n1[H.tick] = 10;
  n1[H.phase] = P.countdown;
  n1[H.phaseTimer] = 3.0;
  const e1 = eventsFromHeaderDiff(p1, n1);
  expect(e1.some((ev) => ev.type === 'bomb:round_start')).toBe(true);

  // 2. Transfer from slot 0 to slot 1 emits bomb:holder (reason 'transfer') + bomb:haptic ('transfer')
  const p2 = blankState();
  p2[H.phase] = P.active;
  p2[H.bombHolder] = 0;
  p2[H.bombTimer] = 8.5;
  setPuck(p2, 0, 0, 0, BOMB_FLAG_ALIVE | BOMB_FLAG_HOLDING, 0);
  setPuck(p2, 1, 40, 0, BOMB_FLAG_ALIVE, 0);
  const n2 = new Float32Array(p2);
  n2[H.bombHolder] = 1;
  n2[H.transferCooldown] = 0.5;
  setPuck(n2, 0, -20, 0, BOMB_FLAG_ALIVE, 0);
  setPuck(n2, 1, 60, 0, BOMB_FLAG_ALIVE | BOMB_FLAG_HOLDING, 0);
  const e2 = eventsFromHeaderDiff(p2, n2);
  const holderEv = e2.find((ev) => ev.type === 'bomb:holder');
  expect(holderEv?.payload).toMatchObject({
    holderIndex: 1,
    previousHolder: 0,
    reason: 'transfer',
    transferCooldownMs: 500,
  });
  expect(e2.some((ev) => ev.type === 'bomb:haptic' && (ev.payload as { intensity: string }).intensity === 'transfer')).toBe(true);

  // 3. Disconnect auto-pass sets reason 'disconnect'
  const n2d = new Float32Array(n2);
  n2d[PLAYER + 0 * STRIDE + 8] = BOMB_FLAG_ALIVE | BOMB_FLAG_DISCONNECTED;
  const e2d = eventsFromHeaderDiff(p2, n2d);
  expect((e2d.find((ev) => ev.type === 'bomb:holder')?.payload as { reason: string }).reason).toBe('disconnect');

  // 4. Fuse crossing 5.0s and 2.0s emits warn and critical haptics
  const p3 = blankState();
  p3[H.phase] = P.active;
  p3[H.bombHolder] = 1;
  p3[H.bombTimer] = 5.05;
  const n3 = new Float32Array(p3);
  n3[H.bombTimer] = 4.95;
  const e3 = eventsFromHeaderDiff(p3, n3);
  expect(e3).toContainEqual({
    type: 'bomb:haptic',
    roomId: '',
    payload: { intensity: 'warn', targetSlot: 1 },
  });

  const p4 = new Float32Array(n3);
  p4[H.bombTimer] = 2.02;
  const n4 = new Float32Array(p4);
  n4[H.bombTimer] = 1.98;
  const e4 = eventsFromHeaderDiff(p4, n4);
  expect(e4).toContainEqual({
    type: 'bomb:haptic',
    roomId: '',
    payload: { intensity: 'critical', targetSlot: 1 },
  });

  // 5. Simultaneous explosion + round end emits bomb:explosion + bomb:round_end
  const p5 = blankState();
  p5[H.phase] = P.active;
  p5[H.bombHolder] = 0;
  p5[H.bombTimer] = 0.01;
  setPuck(p5, 0, 10, 20, BOMB_FLAG_ALIVE | BOMB_FLAG_HOLDING, 0);
  setPuck(p5, 1, 50, 20, BOMB_FLAG_ALIVE, 0);
  const n5 = new Float32Array(p5);
  n5[H.phase] = P.roundEnd;
  n5[H.bombHolder] = -1;
  n5[H.bombTimer] = 0;
  n5[H.roundFlags] = RF.roundSuddenDeath;
  setPuck(n5, 0, 10, 20, BOMB_FLAG_EXPLODED, 0);
  setPuck(n5, 1, 50, 20, BOMB_FLAG_EXPLODED, 0);
  const e5 = eventsFromHeaderDiff(p5, n5);
  const exp = e5.find((ev) => ev.type === 'bomb:explosion');
  expect(exp?.payload).toEqual({
    eliminatedIndices: [0, 1],
    blastX: 10,
    blastY: 20,
    aliveCount: 0,
    suddenDeathTriggered: true,
  });
  const endEv = e5.find((ev) => ev.type === 'bomb:round_end');
  expect(endEv?.payload).toMatchObject({
    winnerIndex: null,
    matchOver: false,
    suddenDeath: true,
  });
});
