import { expect, test } from 'vitest';
import {
  FLAG_ACTIVE,
  FLAG_CONTENDER,
  PHASE_COUNTDOWN,
  PHASE_OVERTIME,
  PHASE_ROUND_ACTIVE,
  PHASE_ROUND_END,
} from './constants';
import { colorClashRoundRanking } from './round-ranking';

const PHASE = 1;
const WINNER = 7;
const PLAYER = 8;
const STRIDE = 10;

test('Color Clash round ranking: live places by pct, final by winner then pct, overtime TIE marker', () => {
  const state = new Float32Array(88);
  const names = ['Hudson', 'Dash', 'Bot1', '', '', '', '', ''];

  // 3 players active
  state[PHASE] = PHASE_ROUND_ACTIVE;

  // Slot 0: 34.2%
  state[PLAYER + 0 * STRIDE + 0] = 10; // x
  state[PLAYER + 0 * STRIDE + 7] = 34.2; // pct
  state[PLAYER + 0 * STRIDE + 8] = FLAG_ACTIVE; // flags
  state[PLAYER + 0 * STRIDE + 9] = 2; // match points

  // Slot 1: 22.0%
  state[PLAYER + 1 * STRIDE + 0] = -10;
  state[PLAYER + 1 * STRIDE + 7] = 22.0;
  state[PLAYER + 1 * STRIDE + 8] = FLAG_ACTIVE;
  state[PLAYER + 1 * STRIDE + 9] = 3;

  // Slot 2: 22.0% (tied with slot 1)
  state[PLAYER + 2 * STRIDE + 0] = 20;
  state[PLAYER + 2 * STRIDE + 7] = 22.0;
  state[PLAYER + 2 * STRIDE + 8] = FLAG_ACTIVE;
  state[PLAYER + 2 * STRIDE + 9] = 1;

  const players = [
    { index: 0, connected: true },
    { index: 1, connected: false }, // AWAY
    { index: 2, connected: true },
  ];

  const liveView = colorClashRoundRanking(state, names, players);
  expect(liveView.stage).toBe('live');
  expect(liveView.rows).toHaveLength(3);

  const slot0 = liveView.rows.find((r) => r.slot === 0);
  expect(slot0?.place).toBe(1);
  expect(slot0?.value).toBe('34.2%');
  expect(slot0?.preview).toBe(2); // 3 players, 1st place gets +2
  expect(slot0?.finalized).toBe(false);
  expect(slot0?.status).toBe('LIVE');

  const slot1 = liveView.rows.find((r) => r.slot === 1);
  expect(slot1?.place).toBe(2); // tied at 22%, both get place 2
  expect(slot1?.value).toBe('22.0%');
  expect(slot1?.preview).toBe(1); // 2nd place gets +1
  expect(slot1?.finalized).toBe(false);
  expect(slot1?.status).toBe('AWAY');

  const slot2 = liveView.rows.find((r) => r.slot === 2);
  expect(slot2?.place).toBe(2); // tied with slot 1
  expect(slot2?.value).toBe('22.0%');
  expect(slot2?.preview).toBe(1);
  expect(slot2?.status).toBe('LIVE');

  // ROUND_END with winner slot 0
  state[PHASE] = PHASE_ROUND_END;
  state[WINNER] = 0;

  const finalView = colorClashRoundRanking(state, names, players);
  expect(finalView.stage).toBe('final');
  expect(finalView.rows).toHaveLength(3);

  const finalSlot0 = finalView.rows.find((r) => r.slot === 0);
  expect(finalSlot0?.place).toBe(1); // winner always gets place 1
  expect(finalSlot0?.finalized).toBe(true);
  expect(finalSlot0?.preview).toBeNull();

  const finalSlot1 = finalView.rows.find((r) => r.slot === 1);
  expect(finalSlot1?.place).toBe(2); // tied at 22%, both get place 2
  expect(finalSlot1?.finalized).toBe(true);
  expect(finalSlot1?.preview).toBeNull();

  const finalSlot2 = finalView.rows.find((r) => r.slot === 2);
  expect(finalSlot2?.place).toBe(2); // tied with slot 1
  expect(finalSlot2?.finalized).toBe(true);
  expect(finalSlot2?.preview).toBeNull();

  // OVERTIME with contenders
  state[PHASE] = PHASE_OVERTIME;
  state[PLAYER + 0 * STRIDE + 8] = FLAG_ACTIVE | FLAG_CONTENDER;
  state[PLAYER + 1 * STRIDE + 8] = FLAG_ACTIVE | FLAG_CONTENDER;
  state[PLAYER + 2 * STRIDE + 8] = 0; // parked

  const overtimeView = colorClashRoundRanking(state, names, players);
  expect(overtimeView.stage).toBe('live');

  const otSlot0 = overtimeView.rows.find((r) => r.slot === 0);
  expect(otSlot0?.marker).toBe('TIE');
  expect(otSlot0?.preview).toBeNull();

  const otSlot1 = overtimeView.rows.find((r) => r.slot === 1);
  expect(otSlot1?.marker).toBe('TIE');
  expect(otSlot1?.preview).toBeNull();

  const otSlot2 = overtimeView.rows.find((r) => r.slot === 2);
  expect(otSlot2?.place).not.toBeNull(); // parked but keeps place
  expect(otSlot2?.marker).toBeUndefined();
});
