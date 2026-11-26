import { describe, expect, test } from 'vitest';
import { createRoundPanelModel, ROUND_FREEZE_MS } from '../../../screen/src/round-panel-model.ts';
import {
  LAMP_FLAG,
  LIGHT_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
  LIGHT_PLAYER_OFFSET as OFF,
} from './constants.ts';
import { createLastLightRoundRanking } from './round-ranking.ts';
import { scoreboardRows } from './scoreboard.ts';
import { playerBase } from './state.ts';

function buildLiveState(
  phase: number,
  slots: Array<{ slot: number; flags: number; lockTick?: number; score?: number; lastPts?: number }>,
  lampFlags: number = LAMP_FLAG.lit,
  winnerSlot = -1,
): Float32Array {
  const state = new Float32Array(88);
  state[H.phase] = phase;
  state[H.lampFlags] = lampFlags;
  state[H.winnerSlot] = winnerSlot;
  for (const s of slots) {
    const base = playerBase(s.slot);
    state[base + OFF.flags] = s.flags;
    state[base + OFF.lockTick] = s.lockTick ?? -1;
    state[base + OFF.score] = s.score ?? 0;
    state[base + OFF.lastRoundPoints] = s.lastPts ?? 0;
  }
  return state;
}

describe('Last Light blind round ranking and RoundPanelModel integration', () => {
  test('INV-8: live stage emits IN/LOCKED/WATCHING sorted by slot without leaking lock order or timestamps', () => {
    const adapter = createLastLightRoundRanking();
    const model = createRoundPanelModel();
    const names = ['Ada', 'Beau', 'Cam'];

    // Even if a rogue lockTick were present in state during ROUND_ACTIVE, live adapter must ignore it.
    const liveState = buildLiveState(P.active, [
      { slot: 0, flags: LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender | LIGHT_FLAG.locked, lockTick: 960, score: 2 },
      { slot: 1, flags: LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender, lockTick: -1, score: 2 },
      { slot: 2, flags: LIGHT_FLAG.joined, lockTick: -1, score: 1 },
    ]);

    const view = adapter.read(liveState, names);
    expect(view.stage).toBe('live');
    expect(view.rows.map((r) => ({ slot: r.slot, value: r.value, place: r.place, finalized: r.finalized }))).toEqual([
      { slot: 0, value: 'LOCKED', place: null, finalized: false },
      { slot: 1, value: 'IN', place: null, finalized: false },
      { slot: 2, value: 'WATCHING', place: null, finalized: false },
    ]);

    const liveOut = model.update(view, scoreboardRows(liveState, names), 1000);
    expect(liveOut.mode).toBe('live');
    expect(liveOut.rankRows.map((r) => r.slot)).toEqual([0, 1, 2]);
  });

  test('reveals places, lock times, OUT, REPLAY marker, and freezes totals for ROUND_FREEZE_MS via createRoundPanelModel', () => {
    const adapter = createLastLightRoundRanking();
    const model = createRoundPanelModel();
    const names = ['Ada', 'Beau', 'Cam'];

    const liveState = buildLiveState(P.active, [
      { slot: 0, flags: LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender | LIGHT_FLAG.locked, score: 1 },
      { slot: 1, flags: LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender | LIGHT_FLAG.locked, score: 2 },
      { slot: 2, flags: LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender, score: 0 },
    ]);
    model.update(adapter.read(liveState, names), scoreboardRows(liveState, names), 1000);

    // Blowout reveals lockTicks: slot 1 @ 864 (7.2s) -> 1ST (+2), slot 0 @ 720 (6.0s) -> 2ND (+1), slot 2 OUT (+0).
    const finalState = buildLiveState(
      P.roundEnd,
      [
        { slot: 0, flags: LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender | LIGHT_FLAG.locked, lockTick: 720, score: 2, lastPts: 1 },
        { slot: 1, flags: LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender | LIGHT_FLAG.locked, lockTick: 864, score: 4, lastPts: 2 },
        { slot: 2, flags: LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender | LIGHT_FLAG.out, lockTick: -1, score: 0, lastPts: 0 },
      ],
      LAMP_FLAG.blown,
    );

    const frozen = model.update(adapter.read(finalState, names), scoreboardRows(finalState, names), 2000);
    expect(frozen.mode).toBe('frozen');
    expect(frozen.rankRows.map((r) => ({ slot: r.slot, place: r.place, value: r.value, earned: r.earned }))).toEqual([
      { slot: 1, place: 1, value: '7.2s', earned: 2 },
      { slot: 0, place: 2, value: '6.0s', earned: 1 },
      { slot: 2, place: null, value: 'OUT', earned: 0 },
    ]);
    // Totals stay at baseline scores during the 2000ms freeze.
    expect(frozen.totalRows.find((r) => r.slot === 1)?.score).toBe(2);

    // After ROUND_FREEZE_MS, totals update to new scores.
    const revealed = model.update(
      adapter.read(finalState, names),
      scoreboardRows(finalState, names),
      2000 + ROUND_FREEZE_MS,
    );
    expect(revealed.mode).toBe('result');
    expect(revealed.totalRows.find((r) => r.slot === 1)?.score).toBe(4);

    // Sudden death same-tick tie adds REPLAY marker and shares place 1.
    const sdTie = buildLiveState(
      P.roundEnd,
      [
        { slot: 0, flags: LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender | LIGHT_FLAG.locked, lockTick: 600, score: 6, lastPts: 0 },
        { slot: 1, flags: LIGHT_FLAG.joined | LIGHT_FLAG.active | LIGHT_FLAG.contender | LIGHT_FLAG.locked, lockTick: 600, score: 6, lastPts: 0 },
        { slot: 2, flags: LIGHT_FLAG.joined, lockTick: -1, score: 3, lastPts: 0 },
      ],
      LAMP_FLAG.blown | LAMP_FLAG.suddenDeath,
    );
    const tieView = adapter.read(sdTie, names);
    expect(tieView.rows[0]?.place).toBe(1);
    expect(tieView.rows[1]?.place).toBe(1);
    expect(tieView.rows[0]?.marker).toBe('REPLAY');
    expect(tieView.rows[1]?.marker).toBe('REPLAY');
    expect(tieView.rows[2]?.value).toBe('WATCHING');
  });
});
