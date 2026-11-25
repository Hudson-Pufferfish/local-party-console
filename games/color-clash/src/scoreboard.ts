import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import {
  COLOR_CLASH_CONSTANTS as C,
  FLAG_ACTIVE,
  PHASE_COUNTDOWN,
  PHASE_FINAL_REVEAL,
  PHASE_MATCH_OVER,
  PHASE_OVERTIME,
  PHASE_ROUND_ACTIVE,
} from './constants.ts';

const PLAYER = 8;
const STRIDE = 10;
const SLOTS = 8;
const FALLBACK_COLOR = '#111111';

export interface ColorScoreRow {
  readonly slot: number;
  readonly color: string;
  readonly name: string;
  readonly score: string;
  readonly ratio: number;
  readonly status?: 'LIVE' | 'AWAY';
}

export interface ColorScorePlayerStatus {
  readonly index: number;
  readonly connected: boolean;
}

export interface ColorScoreRuleRow {
  readonly label: string;
  readonly value: string;
}

export interface ColorScoreRules {
  readonly rows: readonly ColorScoreRuleRow[];
}

export function shortTag(name: string, slot: number): string {
  let letters = '';
  const raw = name.toUpperCase();
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const digit = code >= 48 && code <= 57;
    const alpha = code >= 65 && code <= 90;
    if (!digit && !alpha) continue;
    letters += raw.charAt(index);
    if (letters.length === 6) break;
  }
  if (letters.length > 0) return letters;
  return `P${slot + 1}`;
}

function formatClock(seconds: number): string {
  const clamped = seconds > 0 ? Math.ceil(seconds) : 0;
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  const mm = mins < 10 ? `0${mins}` : `${mins}`;
  const ss = secs < 10 ? `0${secs}` : `${secs}`;
  return `${mm}:${ss}`;
}

export function scoreboardHeader(state: Float32Array): string {
  const phase = state[1] ?? PHASE_COUNTDOWN;
  const timer = state[2] ?? 0;
  if (phase === PHASE_FINAL_REVEAL || phase === PHASE_MATCH_OVER) {
    return 'FINAL SCORES';
  }
  if (phase === PHASE_OVERTIME) {
    return `OVERTIME ${formatClock(timer)}`;
  }
  if (phase === PHASE_ROUND_ACTIVE) {
    return `TIME ${formatClock(timer)}`;
  }
  return `TIME ${formatClock(C.matchDuration)}`;
}

export function scoreRules(_state: Float32Array): ColorScoreRules {
  return {
    rows: [
      { label: 'MATCH', value: '45S' },
      { label: 'BOOST', value: '3S WIDE' },
      { label: 'TIE', value: '30S GOLDEN TILE' },
    ],
  };
}

export function scoreboardRows(
  state: Float32Array,
  names: readonly string[],
  players?: readonly ColorScorePlayerStatus[],
): ColorScoreRow[] {
  const entries: Array<{ slot: number; cells: number; pct: number }> = [];
  for (let index = 0; index < SLOTS; index += 1) {
    const base = PLAYER + index * STRIDE;
    const flags = state[base + 8] ?? 0;
    const cells = state[base + 9] ?? 0;
    const x = state[base] ?? 0;
    const y = state[base + 1] ?? 0;
    if ((flags & FLAG_ACTIVE) === 0 && cells === 0 && x === 0 && y === 0) continue;
    const pct = state[base + 7] ?? (cells * 100) / C.gridCells;
    entries.push({ slot: index, cells, pct });
  }

  entries.sort((a, b) => {
    if (b.cells !== a.cells) return b.cells - a.cells;
    return a.slot - b.slot;
  });

  const rows: ColorScoreRow[] = [];
  for (const entry of entries) {
    const tag = shortTag(names[entry.slot] ?? '', entry.slot);
    const player = players?.find((item) => item.index === entry.slot);
    const ratio = entry.cells / C.gridCells;
    const score = `${entry.pct.toFixed(1)}%`;
    if (player === undefined) {
      rows.push({
        slot: entry.slot,
        color: PLAYER_COLORS[entry.slot] ?? FALLBACK_COLOR,
        name: tag,
        score,
        ratio,
      });
    } else {
      rows.push({
        slot: entry.slot,
        color: PLAYER_COLORS[entry.slot] ?? FALLBACK_COLOR,
        name: tag,
        score,
        ratio,
        status: player.connected ? 'LIVE' : 'AWAY',
      });
    }
  }
  return rows;
}
