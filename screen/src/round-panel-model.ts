import type { RoundRankRow, RoundRankingView, RoundStage, ScoreRow } from './register-games.ts';

export const ROUND_FREEZE_MS = 2000;

export type RoundPanelMode = 'empty' | 'live' | 'frozen' | 'result';

export interface RoundPanelRankRow extends RoundRankRow {
  readonly earned?: number;
}

export type { RoundRankingView };

export interface RoundPanelOutput {
  readonly mode: RoundPanelMode;
  readonly rankRows: readonly RoundPanelRankRow[];
  readonly totalRows: readonly ScoreRow[];
}

export interface RoundPanelModel {
  update(view: RoundRankingView | null, totals: readonly ScoreRow[], nowMs: number): RoundPanelOutput;
  reset(): void;
}

interface SavedBaseline {
  [slot: number]: number;
}

export function createRoundPanelModel(): RoundPanelModel {
  let baseline: SavedBaseline | null = null;
  let frozenRows: readonly RoundPanelRankRow[] = [];
  let t0 = 0;
  let previousStage: RoundStage | null = null;
  let savedScores: SavedBaseline = {};

  function sortTotalRows(rows: readonly ScoreRow[]): ScoreRow[] {
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      const aScore = typeof a.score === 'number' ? a.score : -Infinity;
      const bScore = typeof b.score === 'number' ? b.score : -Infinity;
      if (aScore !== bScore) return bScore - aScore;
      return a.slot - b.slot;
    });
    return sorted;
  }

  function sortRankRows(rows: readonly RoundPanelRankRow[]): RoundPanelRankRow[] {
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (a.place !== null && b.place !== null) {
        if (a.place !== b.place) return a.place - b.place;
      } else if (a.place !== null) {
        return -1;
      } else if (b.place !== null) {
        return 1;
      }
      return a.slot - b.slot;
    });
    return sorted;
  }

  function checkForNewMatch(totals: readonly ScoreRow[]): boolean {
    for (const row of totals) {
      if (typeof row.score !== 'number') continue;
      const saved = savedScores[row.slot];
      if (saved !== undefined && row.score < saved) {
        return true;
      }
    }
    return false;
  }

  function saveTotals(totals: readonly ScoreRow[]): void {
    savedScores = {};
    for (const row of totals) {
      if (typeof row.score === 'number') {
        savedScores[row.slot] = row.score;
      }
    }
  }

  function withLiveStatus(
    rows: readonly RoundPanelRankRow[],
    totals: readonly ScoreRow[],
  ): RoundPanelRankRow[] {
    return rows.map((row) => {
      const live = totals.find((t) => t.slot === row.slot);
      if (live === undefined || live.status === row.status) return row;
      return { ...row, status: live.status };
    });
  }

  return {
    update(view: RoundRankingView | null, totals: readonly ScoreRow[], nowMs: number): RoundPanelOutput {
      if (checkForNewMatch(totals)) {
        this.reset();
      }

      if (view === null) {
        return {
          mode: 'empty',
          rankRows: [],
          totalRows: sortTotalRows(totals),
        };
      }

      if (view.stage === 'live') {
        baseline = {};
        for (const row of totals) {
          if (typeof row.score === 'number') {
            baseline[row.slot] = row.score;
          }
        }
        previousStage = 'live';
        saveTotals(totals);
        return {
          mode: 'live',
          rankRows: sortRankRows(view.rows),
          totalRows: sortTotalRows(totals),
        };
      }

      if (view.stage === 'final' && previousStage !== 'final') {
        if (baseline !== null) {
          const earned: { [slot: number]: number } = {};
          for (const row of totals) {
            if (typeof row.score !== 'number') continue;
            const before = baseline[row.slot] ?? 0;
            const delta = row.score - before;
            earned[row.slot] = delta > 0 ? delta : 0;
          }
          frozenRows = view.rows.map((row) => ({
            ...row,
            earned: earned[row.slot] ?? 0,
          }));
          t0 = nowMs;
          baseline = null;
          saveTotals(totals);
        } else {
          frozenRows = view.rows;
          previousStage = 'final';
          saveTotals(totals);
          return {
            mode: 'result',
            rankRows: sortRankRows(withLiveStatus(frozenRows, totals)),
            totalRows: sortTotalRows(totals),
          };
        }
        previousStage = 'final';
      }

      const elapsed = nowMs - t0;

      if (previousStage === 'final' && elapsed < ROUND_FREEZE_MS) {
        const oldRows: ScoreRow[] = [];
        for (const row of totals) {
          const earned = frozenRows.find((fr) => fr.slot === row.slot)?.earned ?? 0;
          const oldScore = typeof row.score === 'number' ? row.score - earned : row.score;
          oldRows.push({ ...row, score: oldScore });
        }
        oldRows.sort((a, b) => {
          const aScore = typeof a.score === 'number' ? a.score : -Infinity;
          const bScore = typeof b.score === 'number' ? b.score : -Infinity;
          if (aScore !== bScore) return bScore - aScore;
          return a.slot - b.slot;
        });
        return {
          mode: 'frozen',
          rankRows: sortRankRows(withLiveStatus(frozenRows, totals)),
          totalRows: oldRows,
        };
      }

      if (frozenRows.length === 0) {
        return {
          mode: 'empty',
          rankRows: sortRankRows(view.rows),
          totalRows: sortTotalRows(totals),
        };
      }

      return {
        mode: 'result',
        rankRows: sortRankRows(withLiveStatus(frozenRows, totals)),
        totalRows: sortTotalRows(totals),
      };
    },

    reset(): void {
      baseline = null;
      frozenRows = [];
      t0 = 0;
      previousStage = null;
      savedScores = {};
    },
  };
}
