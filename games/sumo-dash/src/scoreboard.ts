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
  readonly target: string;
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

export function scoreRules(state: Float32Array): ScoreRules | null {
  const count = activePlayerCount(state);
  if (count < 2) return null;
  const target = targetScoreForCount(count);
  const rows: ScoreRuleRow[] = [];
  for (let rank = 1; rank <= count; rank += 1) {
    rows.push({
      label: ORDINALS[rank - 1] ?? `${rank}TH`,
      value: `+${count - rank}`,
    });
  }
  return {
    target: `TARGET: >= ${target} PTS`,
    rows,
  };
}

export function shortTag(name: string, slot: number): string {
  let letters = '';
  const raw = name.toLowerCase();
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const digit = code >= 48 && code <= 57;
    const alpha = code >= 97 && code <= 122;
    if (!digit && !alpha) continue;
    letters += raw.charAt(index);
    if (letters.length === 2) break;
  }
  if (letters.length === 2) return letters;
  return `p${slot + 1}`;
}

export function scoreboardRows(
  state: Float32Array,
  names: readonly string[],
  win?: number,
): ScoreRow[] {
  const target = win ?? targetScoreForState(state);
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
      text: `${tag} ${score}/${target}`,
    });
  }
  return rows;
}

export function scoreboardLine(
  state: Float32Array,
  names: readonly string[],
  win?: number,
): string {
  return scoreboardRows(state, names, win).map((row) => row.text).join('  ');
}
