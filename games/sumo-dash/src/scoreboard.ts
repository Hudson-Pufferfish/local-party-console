import { PLAYER_COLORS } from '../../../shared/src/registry';
import { SUMO_CONSTANTS } from './constants';

const PLAYER = 8;
const STRIDE = 10;
const SLOTS = 8;
const FALLBACK_COLOR = '#111111';
const ORDINALS = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'] as const;

export interface ScoreRow {
  readonly slot: number;
  readonly color: string;
  readonly text: string;
}

export interface ScoreRuleRow {
  readonly label: string;
  readonly value: string;
}

export interface ScoreRules {
  readonly rows: readonly ScoreRuleRow[];
}

export function targetScoreForCount(playerCount: number): number {
  const scaled = (playerCount - 1) * SUMO_CONSTANTS.targetMultiplier;
  return scaled > SUMO_CONSTANTS.minTargetScore ? scaled : SUMO_CONSTANTS.minTargetScore;
}

export function activePlayerCount(state: Float32Array): number {
  let count = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    const base = PLAYER + index * STRIDE;
    const flags = state[base + 8] ?? 0;
    const score = state[base + 9] ?? 0;
    const x = state[base] ?? 0;
    const y = state[base + 1] ?? 0;
    if ((flags & 1) === 0 && score === 0 && x === 0 && y === 0) continue;
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

export function scoreboardHeader(state: Float32Array): string {
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
  if (isSuddenDeath(state, target)) {
    return { rows: [{ label: ORDINALS[0], value: '+1' }] };
  }
  const rows: ScoreRuleRow[] = [];
  for (let rank = 1; rank <= count; rank += 1) {
    rows.push({
      label: ORDINALS[rank - 1] ?? `${rank}TH`,
      value: `+${count - rank}`,
    });
  }
  return { rows };
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
    if (letters.length === 2) break;
  }
  if (letters.length > 0) return letters;
  return `P${slot + 1}`;
}

export function scoreboardRows(
  state: Float32Array,
  names: readonly string[],
): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (let index = 0; index < SLOTS; index += 1) {
    const base = PLAYER + index * STRIDE;
    const flags = state[base + 8] ?? 0;
    const score = state[base + 9] ?? 0;
    const x = state[base] ?? 0;
    const y = state[base + 1] ?? 0;
    if ((flags & 1) === 0 && score === 0 && x === 0 && y === 0) continue;
    const tag = shortTag(names[index] ?? '', index);
    rows.push({
      slot: index,
      color: PLAYER_COLORS[index] ?? FALLBACK_COLOR,
      text: `${tag} ${score}`,
    });
  }
  return rows;
}

export function scoreboardLine(
  state: Float32Array,
  names: readonly string[],
): string {
  return scoreboardRows(state, names).map((row) => row.text).join('  ');
}
