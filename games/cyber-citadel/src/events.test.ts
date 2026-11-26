import { expect, test } from 'vitest';
import { PAD_STATE_TYPE } from '../../../shared/src/types/game-control.ts';
import {
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PHASE,
  CYBER_PLAYER_OFFSET,
  CYBER_STATE_FLOATS,
} from './constants.ts';
import { buildCyberRehydrateEvents, createCyberEventsDiff } from './events.ts';
import { playerBase } from './state.ts';

function makeState(): Float32Array {
  const s = new Float32Array(CYBER_STATE_FLOATS);
  s[CYBER_HEADER.phaseEnum] = CYBER_PHASE.COUNTDOWN;
  s[CYBER_HEADER.wave] = 1;
  s[CYBER_HEADER.coreHp] = C.coreMaxHp;
  const b0 = playerBase(0);
  s[b0 + CYBER_PLAYER_OFFSET.x] = 200;
  s[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  s[b0 + CYBER_PLAYER_OFFSET.hp] = C.playerMaxHp;
  s[b0 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.JOINED | CYBER_FLAG.ACTIVE;
  const b1 = playerBase(1);
  s[b1 + CYBER_PLAYER_OFFSET.x] = 230;
  s[b1 + CYBER_PLAYER_OFFSET.y] = 0;
  s[b1 + CYBER_PLAYER_OFFSET.hp] = C.playerMaxHp;
  s[b1 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.JOINED | CYBER_FLAG.ACTIVE;
  return s;
}

test('createCyberEventsDiff emits wave, downed/revived, emp, match_end, and edge-only pad:state events', () => {
  const diff = createCyberEventsDiff();
  const prev = makeState();
  const next = new Float32Array(prev);

  // COUNTDOWN -> WAVE_ACTIVE emits cyber:wave_start + initial pad:state
  next[CYBER_HEADER.tickId] = 1;
  next[CYBER_HEADER.phaseEnum] = CYBER_PHASE.WAVE_ACTIVE;
  const ev1 = diff(prev, next);
  expect(ev1.some((e) => e.type === 'cyber:wave_start')).toBe(true);
  expect(ev1.filter((e) => e.type === PAD_STATE_TYPE).length).toBe(2);

  // Identical tick produces ZERO pad:state spam
  prev.set(next);
  next[CYBER_HEADER.tickId] = 2;
  const evIdle = diff(prev, next);
  expect(evIdle).toHaveLength(0);

  // P1 goes DOWNED within revive range of P0 -> cyber:downed + pad:state updates P0 Y label to REVIVE & disables P1 buttons
  prev.set(next);
  next[CYBER_HEADER.tickId] = 3;
  const b1 = playerBase(1);
  next[b1 + CYBER_PLAYER_OFFSET.hp] = 0;
  next[b1 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.JOINED | CYBER_FLAG.DOWNED;
  const evDown = diff(prev, next);
  expect(evDown.some((e) => e.type === 'cyber:downed')).toBe(true);
  const p0Pad = evDown.find(
    (e) => e.type === PAD_STATE_TYPE && (e.payload as { slot: number }).slot === 0,
  );
  expect(p0Pad).toBeDefined();
  expect((p0Pad?.payload as { labels: string[]; disabled: number }).labels[3]).toBe('REVIVE');
  expect((p0Pad?.payload as { disabled: number }).disabled & 0x08).toBe(0);

  // P1 revived -> cyber:revived
  prev.set(next);
  next[CYBER_HEADER.tickId] = 4;
  next[b1 + CYBER_PLAYER_OFFSET.hp] = C.reviveRestoreHp;
  next[b1 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.JOINED | CYBER_FLAG.ACTIVE;
  const evRev = diff(prev, next);
  expect(evRev.some((e) => e.type === 'cyber:revived')).toBe(true);

  // EMP discharge -> cyber:emp
  prev.set(next);
  next[CYBER_HEADER.tickId] = 5;
  next[CYBER_HEADER.empFiredCount] = 1;
  const evEmp = diff(prev, next);
  expect(evEmp.some((e) => e.type === 'cyber:emp')).toBe(true);

  // Wave break -> cyber:wave_end
  prev.set(next);
  next[CYBER_HEADER.tickId] = 6;
  next[CYBER_HEADER.phaseEnum] = CYBER_PHASE.WAVE_BREAK;
  const evBreak = diff(prev, next);
  expect(evBreak.some((e) => e.type === 'cyber:wave_end')).toBe(true);

  // Core lost -> cyber:match_end (won: false)
  prev.set(next);
  next[CYBER_HEADER.tickId] = 7;
  next[CYBER_HEADER.coreHp] = 0;
  next[CYBER_HEADER.phaseEnum] = CYBER_PHASE.MATCH_OVER;
  const evEnd = diff(prev, next);
  const matchEnd = evEnd.find((e) => e.type === 'cyber:match_end');
  expect(matchEnd?.payload).toMatchObject({ won: false, wavesCleared: 0 });
});

test('buildCyberRehydrateEvents emits slot-scoped pad:state with remaining cooldowns for rejoining player', () => {
  const s = makeState();
  s[CYBER_HEADER.phaseEnum] = CYBER_PHASE.WAVE_ACTIVE;
  const b0 = playerBase(0);
  s[b0 + CYBER_PLAYER_OFFSET.x] = 50;
  s[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  s[b0 + CYBER_PLAYER_OFFSET.railCooldown] = 1.5;

  const now = 100000;
  const events = buildCyberRehydrateEvents(s, 0, now);
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe(PAD_STATE_TYPE);
  const payload = events[0]?.payload as {
    slot: number;
    labels: string[];
    disabled: number;
    cooldownEndsAt: number[];
  };
  expect(payload.slot).toBe(0);
  expect(payload.labels[3]).toBe('BOMB');
  expect(payload.disabled & 0x08).toBe(0);
  expect(payload.cooldownEndsAt[0]).toBe(now + 1500);
});
