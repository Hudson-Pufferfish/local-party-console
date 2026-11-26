import { expect, test } from 'vitest';
import {
  createRoundPanelModel,
  type RoundRankingView,
  type RoundPanelRankRow,
} from './round-panel-model.ts';
import type { ScoreRow } from './register-games.ts';

test('round panel walks through live, freeze, result, and reset on new match', () => {
  const model = createRoundPanelModel();

  const liveRows: readonly RoundPanelRankRow[] = [
    { slot: 0, color: '#FF4D00', name: 'P1', value: '34.2%', place: 1, finalized: false, preview: 3 },
    { slot: 1, color: '#00C853', name: 'P2', value: '22.0%', place: 2, finalized: false, preview: 2 },
  ];

  const liveView: RoundRankingView = { stage: 'live', rows: liveRows };

  const totalsBefore: readonly ScoreRow[] = [
    { slot: 0, color: '#FF4D00', name: 'P1', score: 6 },
    { slot: 1, color: '#00C853', name: 'P2', score: 8 },
  ];

  // Feed live frames
  const liveOutput = model.update(liveView, totalsBefore, 500);
  expect(liveOutput.mode).toBe('live');
  expect(liveOutput.rankRows).toHaveLength(2);
  expect(liveOutput.rankRows[0]?.slot).toBe(0);
  expect(liveOutput.rankRows[0]?.earned).toBeUndefined();
  expect(liveOutput.totalRows).toHaveLength(2);
  expect(liveOutput.totalRows[0]?.slot).toBe(1); // P2 with 8 is first
  expect(liveOutput.totalRows[0]?.score).toBe(8);
  expect(liveOutput.totalRows[1]?.slot).toBe(0); // P1 with 6 is second

  const finalRows: readonly RoundPanelRankRow[] = [
    { slot: 0, color: '#FF4D00', name: 'P1', value: '34.2%', place: 1, finalized: true, preview: null },
    { slot: 1, color: '#00C853', name: 'P2', value: '22.0%', place: 2, finalized: true, preview: null },
  ];

  const finalView: RoundRankingView = { stage: 'final', rows: finalRows };

  const totalsAfter: readonly ScoreRow[] = [
    { slot: 0, color: '#FF4D00', name: 'P1', score: 9 },
    { slot: 1, color: '#00C853', name: 'P2', score: 9 },
  ];

  // First final frame at t=1000
  const frozenOutput1 = model.update(finalView, totalsAfter, 1000);
  expect(frozenOutput1.mode).toBe('frozen');
  expect(frozenOutput1.rankRows).toHaveLength(2);
  expect(frozenOutput1.rankRows[0]?.earned).toBe(3); // P1: 9 - 6 = 3
  expect(frozenOutput1.rankRows[1]?.earned).toBe(1); // P2: 9 - 8 = 1
  expect(frozenOutput1.totalRows).toHaveLength(2);
  expect(frozenOutput1.totalRows[0]?.slot).toBe(1); // old order: P2 first
  expect(frozenOutput1.totalRows[0]?.score).toBe(8); // old score
  expect(frozenOutput1.totalRows[1]?.slot).toBe(0); // P1 second
  expect(frozenOutput1.totalRows[1]?.score).toBe(6); // old score

  // Still frozen at t=2900 (within 2000ms freeze)
  const frozenOutput2 = model.update(finalView, totalsAfter, 2900);
  expect(frozenOutput2.mode).toBe('frozen');
  expect(frozenOutput2.totalRows[0]?.score).toBe(8); // still old score
  expect(frozenOutput2.totalRows[1]?.score).toBe(6);

  // Result at t=3100 (freeze ended at 3000) with stage still final
  const resultOutput1 = model.update(finalView, totalsAfter, 3100);
  expect(resultOutput1.mode).toBe('result');
  expect(resultOutput1.rankRows).toHaveLength(2);
  expect(resultOutput1.rankRows[0]?.earned).toBe(3);
  expect(resultOutput1.rankRows[1]?.earned).toBe(1);
  expect(resultOutput1.totalRows).toHaveLength(2);
  expect(resultOutput1.totalRows[0]?.slot).toBe(0); // sorted by score, ties by slot
  expect(resultOutput1.totalRows[0]?.score).toBe(9);
  expect(resultOutput1.totalRows[1]?.slot).toBe(1);
  expect(resultOutput1.totalRows[1]?.score).toBe(9);

  // Stage becomes idle but still in result
  const idleView: RoundRankingView = { stage: 'idle', rows: [] };
  const resultOutput2 = model.update(idleView, totalsAfter, 4000);
  expect(resultOutput2.mode).toBe('result');
  expect(resultOutput2.rankRows).toHaveLength(2); // frozen rows still shown

  // New match starts: totals drop to 0
  const newMatchTotals: readonly ScoreRow[] = [
    { slot: 0, color: '#FF4D00', name: 'P1', score: 0 },
    { slot: 1, color: '#00C853', name: 'P2', score: 0 },
  ];
  const emptyOutput = model.update(idleView, newMatchTotals, 5000);
  expect(emptyOutput.mode).toBe('empty');
  expect(emptyOutput.rankRows).toHaveLength(0);
  expect(emptyOutput.totalRows).toHaveLength(2);
  expect(emptyOutput.totalRows[0]?.score).toBe(0);
});
