import { expect, test } from 'vitest';
import { createSumoRoundRanking } from './round-ranking';

const PHASE = 1;
const PLAYER = 8;
const STRIDE = 10;

const PHASE_ACTIVE = 1;
const PHASE_ROUND_END = 2;
const PHASE_PRACTICE = 4;
const ALIVE = 1;

test('Sumo Dash round ranking locks knockouts bottom-up, shares same-frame places, preserves AWAY, and clears on practice', () => {
  const adapter = createSumoRoundRanking();
  const state = new Float32Array(88);
  const names = ['Hudson', 'Dash', 'Ada', 'Bot4', '', '', '', ''];
  const players = [
    { index: 0, connected: true },
    { index: 1, connected: false }, // AWAY
  ];

  // 4 players active and alive
  state[PHASE] = PHASE_ACTIVE;
  for (let slot = 0; slot < 4; slot += 1) {
    const base = PLAYER + slot * STRIDE;
    state[base] = 240;
    state[base + 8] = ALIVE;
    state[base + 9] = 0;
  }

  // All 4 alive: ALIVE, no place, no preview; AWAY player stays ALIVE with AWAY badge
  const initial = adapter.read(state, names, players);
  expect(initial.stage).toBe('live');
  expect(initial.rows).toHaveLength(4);
  for (const row of initial.rows) {
    expect(row.value).toBe('ALIVE');
    expect(row.place).toBeNull();
    expect(row.preview).toBeNull();
    expect(row.finalized).toBe(false);
  }
  expect(initial.rows.find((r) => r.slot === 0)?.status).toBe('LIVE');
  expect(initial.rows.find((r) => r.slot === 1)?.status).toBe('AWAY');
  expect(initial.rows.find((r) => r.slot === 2)?.status).toBeUndefined();

  // Knock out slot 3: locks at 4TH, preview +0, finalized
  state[PLAYER + 3 * STRIDE + 8] = 0;
  const afterFirstKo = adapter.read(state, names, players);
  const slot3 = afterFirstKo.rows.find((r) => r.slot === 3);
  expect(slot3?.value).toBe('OUT');
  expect(slot3?.place).toBe(4);
  expect(slot3?.preview).toBe(0);
  expect(slot3?.finalized).toBe(true);
  expect(afterFirstKo.rows.find((r) => r.slot === 0)?.place).toBeNull();

  // Knock out slots 1 and 2 on the same frame: both lock at 2ND, preview +2
  state[PLAYER + 1 * STRIDE + 8] = 0;
  state[PLAYER + 2 * STRIDE + 8] = 0;
  const afterDoubleKo = adapter.read(state, names, players);
  const slot1 = afterDoubleKo.rows.find((r) => r.slot === 1);
  const slot2 = afterDoubleKo.rows.find((r) => r.slot === 2);
  expect(slot1?.value).toBe('OUT');
  expect(slot1?.place).toBe(2);
  expect(slot1?.preview).toBe(2);
  expect(slot1?.finalized).toBe(true);
  expect(slot1?.status).toBe('AWAY');
  expect(slot2?.value).toBe('OUT');
  expect(slot2?.place).toBe(2);
  expect(slot2?.preview).toBe(2);
  expect(slot2?.finalized).toBe(true);

  // ROUND_END: slot 0 (still alive) is 1ST; locked knockouts keep their places; all previews null
  state[PHASE] = PHASE_ROUND_END;
  const finalView = adapter.read(state, names, players);
  expect(finalView.stage).toBe('final');
  expect(finalView.rows.find((r) => r.slot === 0)).toMatchObject({
    value: 'ALIVE',
    place: 1,
    finalized: true,
    preview: null,
  });
  expect(finalView.rows.find((r) => r.slot === 1)).toMatchObject({
    value: 'OUT',
    place: 2,
    finalized: true,
    preview: null,
    status: 'AWAY',
  });
  expect(finalView.rows.find((r) => r.slot === 2)?.place).toBe(2);
  expect(finalView.rows.find((r) => r.slot === 3)?.place).toBe(4);

  // PRACTICE: memory clears, no places or values
  state[PHASE] = PHASE_PRACTICE;
  const practiceView = adapter.read(state, names, players);
  expect(practiceView.stage).toBe('idle');
  for (const row of practiceView.rows) {
    expect(row.value).toBe('');
    expect(row.place).toBeNull();
    expect(row.preview).toBeNull();
    expect(row.finalized).toBe(false);
  }

  // Sudden death: parked non-contenders are OUT with null place and preview 0
  state[PHASE] = PHASE_ACTIVE;
  state[PLAYER + 0 * STRIDE + 8] = ALIVE;
  state[PLAYER + 0 * STRIDE + 9] = 9;
  state[PLAYER + 1 * STRIDE + 8] = ALIVE;
  state[PLAYER + 1 * STRIDE + 9] = 9;
  state[PLAYER + 2 * STRIDE + 8] = 0; // parked
  state[PLAYER + 2 * STRIDE + 9] = 3;
  state[PLAYER + 3 * STRIDE + 8] = 0; // parked
  state[PLAYER + 3 * STRIDE + 9] = 1;

  const suddenLive = adapter.read(state, names, players);
  expect(suddenLive.rows.find((r) => r.slot === 0)).toMatchObject({
    value: 'ALIVE',
    place: null,
    finalized: false,
    preview: null,
  });
  expect(suddenLive.rows.find((r) => r.slot === 2)).toMatchObject({
    value: 'OUT',
    place: null,
    finalized: true,
    preview: 0,
  });
  expect(suddenLive.rows.find((r) => r.slot === 3)).toMatchObject({
    value: 'OUT',
    place: null,
    finalized: true,
    preview: 0,
  });
});
