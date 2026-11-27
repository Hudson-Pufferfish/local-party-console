import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import {
  LAMP_FLAG,
  LAST_LIGHT_CONSTANTS as C,
  LIGHT_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PLAYER_OFFSET as OFF,
} from './constants.ts';
import { playerBase, readPlayerFlags, readPlayerScore } from './state.ts';

const SLOTS = C.maxPlayers;
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

export type RoundStage = 'idle' | 'live' | 'final';

export interface RoundRankRow {
  readonly slot: number;
  readonly color: string;
  readonly name: string;
  readonly value: string;
  readonly place: number | null;
  readonly finalized: boolean;
  readonly preview: number | null;
  readonly status?: 'LIVE' | 'AWAY';
  readonly marker?: string;
}

export interface RoundRankingView {
  readonly stage: RoundStage;
  readonly rows: readonly RoundRankRow[];
}

const LIGHT_GUIDE: readonly string[] = [
  'TAP TO LOCK IN',
  'LATEST TAP BEFORE THE BLOWOUT WINS',
  'NEVER TAPPED? YOU ARE OUT',
];

export function targetScoreForCount(playerCount: number): number {
  const scaled = (playerCount - 1) * C.targetMultiplier;
  return scaled > C.minTargetScore ? scaled : C.minTargetScore;
}

export function shouldIncludeSlot(state: Float32Array, index: number): boolean {
  return (readPlayerFlags(state, index) & LIGHT_FLAG.joined) !== 0;
}

export function activePlayerCount(state: Float32Array): number {
  let count = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    if (shouldIncludeSlot(state, index)) count += 1;
  }
  return count;
}

export function targetScoreForState(state: Float32Array): number {
  return targetScoreForCount(activePlayerCount(state));
}

export function maxScoreForState(state: Float32Array): number {
  let max = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    if (!shouldIncludeSlot(state, index)) continue;
    const score = readPlayerScore(state, index);
    if (score > max) max = score;
  }
  return max;
}

export function leaderCountForState(state: Float32Array, maxScore: number): number {
  if (maxScore <= 0) return 0;
  let leaders = 0;
  for (let index = 0; index < SLOTS; index += 1) {
    if (!shouldIncludeSlot(state, index)) continue;
    if (readPlayerScore(state, index) === maxScore) leaders += 1;
  }
  return leaders;
}

export function isSuddenDeath(state: Float32Array, win?: number): boolean {
  if ((state[H.winnerSlot] ?? -1) >= 0) return false;
  if ((((state[H.lampFlags] ?? 0) | 0) & LAMP_FLAG.suddenDeath) !== 0) return true;
  const target = win ?? targetScoreForState(state);
  if (target <= 0) return false;
  const max = maxScoreForState(state);
  return max >= target && leaderCountForState(state, max) > 1;
}

export function hasUniqueWinner(state: Float32Array, win?: number): boolean {
  if ((state[H.winnerSlot] ?? -1) >= 0) return true;
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
    return { guide: LIGHT_GUIDE, rows: [{ label: ORDINALS[0], value: '+1 PTS' }] };
  }
  const rows: ScoreRuleRow[] = [];
  for (let rank = 1; rank <= count; rank += 1) {
    rows.push({
      label: ORDINALS[rank - 1] ?? `${rank}TH`,
      value: `+${count - rank} PTS`,
    });
  }
  return { guide: LIGHT_GUIDE, rows };
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

export function scoreboardRows(
  state: Float32Array,
  names: readonly string[],
  players?: readonly ScorePlayerStatus[],
): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (let index = 0; index < SLOTS; index += 1) {
    if (!shouldIncludeSlot(state, index)) continue;
    const score = state[playerBase(index) + OFF.score] ?? 0;
    const tag = shortTag(names[index] ?? '', index);
    const player = players?.find((entry) => entry.index === index);
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
