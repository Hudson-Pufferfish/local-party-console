import { expect, test } from 'vitest';
import {
  BOMB_CONSTANTS as C,
  BOMB_FLAG_ALIVE,
  BOMB_FLAG_EXPLODED,
  BOMB_FLAG_HOLDING,
  BOMB_FLAG_SD_CONTENDER,
  BOMB_HEADER as H,
  BOMB_PHASE as P,
  BOMB_PLAYER_BASE as PLAYER,
  BOMB_PLAYER_STRIDE as STRIDE,
  BOMB_ROUND_FLAG as RF,
} from './constants.ts';
import { createBombPassRoundRanking } from './round-ranking.ts';

const NAMES = ['Ada', 'Bea', 'Cid', 'Dee', '', '', '', ''];
const PLAYERS = [
  { index: 0, connected: true },
  { index: 1, connected: false },
];

function seatFour(state: Float32Array): void {
  for (let slot = 0; slot < 4; slot += 1) {
    const base = PLAYER + slot * STRIDE;
    state[base] = 240;
    state[base + 1] = 0;
    state[base + 8] = BOMB_FLAG_ALIVE;
    state[base + 9] = 0;
  }
}

test('Bomb Pass round ranking locks same-blast places, marks BOMB and REPLAY, and keeps first-try places through a replay', () => {
  const ranking = createBombPassRoundRanking();
  const state = new Float32Array(C.stateFloats);
  state[H.phase] = P.active;
  seatFour(state);
  state[PLAYER + 8] = BOMB_FLAG_ALIVE | BOMB_FLAG_HOLDING;

  const live = ranking.read(state, NAMES, PLAYERS);
  expect(live.stage).toBe('live');
  expect(live.rows).toHaveLength(4);
  expect(live.rows.find((row) => row.slot === 0)).toMatchObject({
    value: 'ALIVE',
    place: null,
    preview: null,
    finalized: false,
    marker: 'BOMB',
    status: 'LIVE',
  });
  expect(live.rows.find((row) => row.slot === 1)?.status).toBe('AWAY');
  expect(live.rows.find((row) => row.slot === 1)?.value).toBe('ALIVE');

  state[PLAYER + 2 * STRIDE + 8] = BOMB_FLAG_EXPLODED;
  state[PLAYER + 3 * STRIDE + 8] = BOMB_FLAG_EXPLODED;
  const sameBlast = ranking.read(state, NAMES, PLAYERS);
  expect(sameBlast.rows.find((row) => row.slot === 2)).toMatchObject({
    value: 'OUT',
    place: 3,
    preview: 1,
    finalized: true,
  });
  expect(sameBlast.rows.find((row) => row.slot === 3)).toMatchObject({
    value: 'OUT',
    place: 3,
    preview: 1,
    finalized: true,
  });

  state[PLAYER + 1 * STRIDE + 8] = BOMB_FLAG_EXPLODED;
  const nextOut = ranking.read(state, NAMES, PLAYERS);
  expect(nextOut.rows.find((row) => row.slot === 1)).toMatchObject({
    value: 'OUT',
    place: 2,
    preview: 2,
    finalized: true,
    status: 'AWAY',
  });

  state[H.phase] = P.roundEnd;
  state[PLAYER + 8] = BOMB_FLAG_ALIVE;
  const ended = ranking.read(state, NAMES, PLAYERS);
  expect(ended.stage).toBe('final');
  expect(ended.rows.find((row) => row.slot === 0)).toMatchObject({
    value: 'ALIVE',
    place: 1,
    finalized: true,
    preview: null,
  });
  expect(ended.rows.find((row) => row.slot === 0)?.marker).toBeUndefined();
  expect(ended.rows.find((row) => row.slot === 2)?.place).toBe(3);
  expect(ended.rows.find((row) => row.slot === 1)?.preview).toBeNull();

  state[H.phase] = P.countdown;
  state[H.roundFlags] = 0;
  const cleared = ranking.read(state, NAMES, PLAYERS);
  expect(cleared.stage).toBe('idle');
  for (const row of cleared.rows) {
    expect(row.value).toBe('');
    expect(row.place).toBeNull();
    expect(row.preview).toBeNull();
    expect(row.finalized).toBe(false);
  }
  state[H.phase] = P.active;
  seatFour(state);
  state[PLAYER + 8] = BOMB_FLAG_ALIVE | BOMB_FLAG_HOLDING;
  const fresh = ranking.read(state, NAMES, PLAYERS);
  for (const row of fresh.rows) {
    expect(row.value).toBe('ALIVE');
    expect(row.place).toBeNull();
    expect(row.finalized).toBe(false);
  }
  expect(fresh.rows.find((row) => row.slot === 0)?.marker).toBe('BOMB');

  const replay = createBombPassRoundRanking();
  const again = new Float32Array(C.stateFloats);
  again[H.phase] = P.active;
  seatFour(again);
  replay.read(again, NAMES, PLAYERS);
  again[PLAYER + 2 * STRIDE + 8] = BOMB_FLAG_EXPLODED;
  again[PLAYER + 3 * STRIDE + 8] = BOMB_FLAG_EXPLODED;
  replay.read(again, NAMES, PLAYERS);

  again[PLAYER + 0 * STRIDE + 8] = BOMB_FLAG_EXPLODED | BOMB_FLAG_SD_CONTENDER;
  again[PLAYER + 1 * STRIDE + 8] = BOMB_FLAG_EXPLODED | BOMB_FLAG_SD_CONTENDER;
  again[H.phase] = P.roundEnd;
  again[H.roundFlags] = RF.roundSuddenDeath;
  const wiped = replay.read(again, NAMES, PLAYERS);
  expect(wiped.stage).toBe('final');
  expect(wiped.rows.find((row) => row.slot === 0)).toMatchObject({
    value: 'OUT',
    place: null,
    preview: null,
    marker: 'REPLAY',
  });
  expect(wiped.rows.find((row) => row.slot === 1)).toMatchObject({
    value: 'OUT',
    place: null,
    preview: null,
    marker: 'REPLAY',
    status: 'AWAY',
  });
  expect(wiped.rows.find((row) => row.slot === 2)?.place).toBe(3);
  expect(wiped.rows.find((row) => row.slot === 3)?.place).toBe(3);

  again[H.phase] = P.countdown;
  const replayIdle = replay.read(again, NAMES, PLAYERS);
  expect(replayIdle.stage).toBe('idle');
  for (const row of replayIdle.rows) {
    expect(row.place).toBeNull();
    expect(row.value).toBe('');
  }

  again[H.phase] = P.active;
  again[PLAYER + 0 * STRIDE + 8] = BOMB_FLAG_ALIVE | BOMB_FLAG_SD_CONTENDER;
  again[PLAYER + 1 * STRIDE + 8] = BOMB_FLAG_ALIVE | BOMB_FLAG_SD_CONTENDER;
  again[PLAYER + 2 * STRIDE + 8] = 0;
  again[PLAYER + 3 * STRIDE + 8] = 0;
  again[PLAYER + 2 * STRIDE] = 900;
  again[PLAYER + 3 * STRIDE] = 900;
  const replayLive = replay.read(again, NAMES, PLAYERS);
  expect(replayLive.stage).toBe('live');
  expect(replayLive.rows.find((row) => row.slot === 0)).toMatchObject({
    value: 'ALIVE',
    place: null,
    preview: null,
    finalized: false,
  });
  expect(replayLive.rows.find((row) => row.slot === 2)).toMatchObject({
    value: 'OUT',
    place: 3,
    preview: 0,
    finalized: true,
  });
  expect(replayLive.rows.find((row) => row.slot === 3)).toMatchObject({
    value: 'OUT',
    place: 3,
    preview: 0,
    finalized: true,
  });
});
