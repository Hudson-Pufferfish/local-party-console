import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import {
  COLOR_CLASH_CONSTANTS as C,
  FLAG_ACTIVE,
  PHASE_COUNTDOWN,
  PHASE_MATCH_OVER,
  PHASE_OVERTIME,
  PHASE_PRACTICE,
  PHASE_ROUND_ACTIVE,
  PHASE_ROUND_END,
} from './constants.ts';

const TICK = 0;
const PHASE = 1;
const TIMER = 2;
const PLAYER = 8;
const STRIDE = 10;
const SLOTS = 8;
const FALLBACK_COLOR = '#111111';
const ORDINALS = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'] as const;

export interface ScoreRow {
  readonly slot: number;
  readonly color: string;
  readonly name: string;
  readonly score: number;
  readonly status?: 'LIVE' | 'AWAY';
}

export interface ScorePlayerStatus {
  readonly index: number;
  readonly connected: boolean;
}

export interface ScoreRuleRow {
  readonly label: string;
  readonly value: string;
}

export interface ScoreRules {
  readonly guide?: readonly string[];
  readonly rows: readonly ScoreRuleRow[];
}

export function targetScoreForCount(playerCount: number): number {
  const scaled = (playerCount - 1) * C.targetMultiplier;
  return scaled > C.minTargetScore ? scaled : C.minTargetScore;
}

export function activePlayerCount(state: Float32Array): number {
  let count = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    const base = PLAYER + index * STRIDE;
    const flags = state[base + 8] ?? 0;
    const score = state[base + 9] ?? 0;
    const x = state[base] ?? 0;
    const y = state[base + 1] ?? 0;
    if ((flags & FLAG_ACTIVE) === 0 && score === 0 && x === 0 && y === 0) continue;
    count += 1;
  }
  return count;
}

export function targetScoreForState(state: Float32Array): number {
  return targetScoreForCount(activePlayerCount(state));
}

export function maxScoreForState(state: Float32Array): number {
  let max = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    const score = state[PLAYER + index * STRIDE + 9] ?? 0;
    if (score > max) max = score;
  }
  return max;
}

export function leaderCountForState(state: Float32Array, maxScore: number): number {
  if (maxScore <= 0) return 0;
  let leaders = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    const score = state[PLAYER + index * STRIDE + 9] ?? 0;
    if (score === maxScore) leaders += 1;
  }
  return leaders;
}

export function isSuddenDeath(state: Float32Array, win?: number): boolean {
  const target = win ?? targetScoreForState(state);
  if (target <= 0) return false;
  const max = maxScoreForState(state);
  return max >= target && leaderCountForState(state, max) > 1;
}

export function hasUniqueWinner(state: Float32Array, win?: number): boolean {
  const target = win ?? targetScoreForState(state);
  if (target <= 0) return false;
  const max = maxScoreForState(state);
  return max >= target && leaderCountForState(state, max) === 1;
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
  const phase = state[PHASE] ?? 0;
  if (phase === PHASE_OVERTIME) {
    return `OVERTIME ${formatClock(state[TIMER] ?? 0)}`;
  }
  const count = activePlayerCount(state);
  if (count < 2) return '';
  const target = targetScoreForCount(count);
  if (isSuddenDeath(state, target)) return 'SUDDEN DEATH';
  return `THRESHOLD: ${target}`;
}

export function scoreRules(state: Float32Array): ScoreRules | null {
  const count = activePlayerCount(state);
  if (count < 2) return null;
  const target = targetScoreForCount(count);
  const guide = [
    'STEER TO PAINT THE FLOOR',
    'BOOST: WIDE PAINT FOR 3S, 8S RECHARGE',
    'MOST FLOOR AT THE BELL WINS THE ROUND',
    'TIE AT THE BELL: GOLDEN TILE OVERTIME',
  ];
  if (isSuddenDeath(state, target)) {
    return { guide, rows: [{ label: ORDINALS[0], value: '+1 PTS' }] };
  }
  const rows: ScoreRuleRow[] = [];
  for (let rank = 1; rank <= count; rank += 1) {
    rows.push({
      label: ORDINALS[rank - 1] ?? `${rank}TH`,
      value: `+${count - rank} PTS`,
    });
  }
  return { guide, rows };
}

export function shouldIncludeSlot(state: Float32Array, index: number): boolean {
  const base = PLAYER + index * STRIDE;
  const flags = state[base + 8] ?? 0;
  const score = state[base + 9] ?? 0;
  const x = state[base] ?? 0;
  const y = state[base + 1] ?? 0;
  if ((flags & FLAG_ACTIVE) === 0 && score === 0 && x === 0 && y === 0) return false;
  return true;
}

export function scoreboardRows(
  state: Float32Array,
  names: readonly string[],
  players?: readonly ScorePlayerStatus[],
): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (let index = 0; index < SLOTS; index += 1) {
    if (!shouldIncludeSlot(state, index)) continue;
    const base = PLAYER + index * STRIDE;
    const score = state[base + 9] ?? 0;
    const tag = shortTag(names[index] ?? '', index);
    const player = players?.find((item) => item.index === index);
    if (player === undefined) {
      rows.push({
        slot: index,
        color: PLAYER_COLORS[index] ?? FALLBACK_COLOR,
        name: tag,
        score,
      });
    } else {
      rows.push({
        slot: index,
        color: PLAYER_COLORS[index] ?? FALLBACK_COLOR,
        name: tag,
        score,
        status: player.connected ? 'LIVE' : 'AWAY',
      });
    }
  }
  return rows;
}
