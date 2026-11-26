import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import {
  FLAG_ACTIVE,
  FLAG_CONTENDER,
  PHASE_COUNTDOWN,
  PHASE_MATCH_OVER,
  PHASE_OVERTIME,
  PHASE_PRACTICE,
  PHASE_ROUND_ACTIVE,
  PHASE_ROUND_END,
} from './constants.ts';
import {
  isSuddenDeath,
  shortTag,
  shouldIncludeSlot,
  targetScoreForCount,
  type ScorePlayerStatus,
} from './scoreboard.ts';

const PHASE = 1;
const WINNER = 7;
const PLAYER = 8;
const STRIDE = 10;
const SLOTS = 8;
const FALLBACK_COLOR = '#111111';

export interface RoundStage {
  readonly stage: 'idle' | 'live' | 'final';
}

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
  readonly stage: 'idle' | 'live' | 'final';
  readonly rows: readonly RoundRankRow[];
}

export function colorClashRoundRanking(
  state: Float32Array,
  names: readonly string[],
  players?: readonly ScorePlayerStatus[],
): RoundRankingView {
  const phase = state[PHASE] ?? 0;

  let stage: 'idle' | 'live' | 'final';
  if (phase === PHASE_PRACTICE || phase === PHASE_COUNTDOWN) {
    stage = 'idle';
  } else if (phase === PHASE_ROUND_END || phase === PHASE_MATCH_OVER) {
    stage = 'final';
  } else {
    stage = 'live';
  }

  const rows: RoundRankRow[] = [];

  const slotData: Array<{
    slot: number;
    pct: number;
    flags: number;
    name: string;
    color: string;
    status?: 'LIVE' | 'AWAY';
  }> = [];

  for (let index = 0; index < SLOTS; index += 1) {
    if (!shouldIncludeSlot(state, index)) continue;
    const base = PLAYER + index * STRIDE;
    const pct = state[base + 7] ?? 0;
    const flags = state[base + 8] ?? 0;
    const tag = shortTag(names[index] ?? '', index);
    const player = players?.find((item) => item.index === index);
    slotData.push({
      slot: index,
      pct,
      flags,
      name: tag,
      color: PLAYER_COLORS[index] ?? FALLBACK_COLOR,
      status: player === undefined ? undefined : (player.connected ? 'LIVE' : 'AWAY'),
    });
  }

  if (stage === 'idle') {
    for (const data of slotData) {
      rows.push({
        slot: data.slot,
        color: data.color,
        name: data.name,
        value: '',
        place: null,
        finalized: false,
        preview: null,
        status: data.status,
      });
    }
    return { stage: 'idle', rows };
  }

  const count = slotData.length;

  if (stage === 'final') {
    const winnerSlot = state[WINNER] | 0;

    for (const data of slotData) {
      const value = data.pct.toFixed(1) + '%';
      const sittingOut = (data.flags & FLAG_ACTIVE) === 0 && data.pct === 0;

      if (sittingOut) {
        rows.push({
          slot: data.slot,
          color: data.color,
          name: data.name,
          value: 'OUT',
          place: null,
          finalized: true,
          preview: 0,
          status: data.status,
        });
        continue;
      }

      let place: number;
      if (data.slot === winnerSlot) {
        place = 1;
      } else {
        let better = 1;
        for (const other of slotData) {
          if (other.slot === winnerSlot) continue;
          if (other.slot === data.slot) continue;
          const otherSittingOut = (other.flags & FLAG_ACTIVE) === 0 && other.pct === 0;
          if (otherSittingOut) continue;
          if (other.pct > data.pct) {
            better += 1;
          }
        }
        place = 1 + better;
      }

      rows.push({
        slot: data.slot,
        color: data.color,
        name: data.name,
        value,
        place,
        finalized: true,
        preview: null,
        status: data.status,
      });
    }

    return { stage: 'final', rows };
  }

  const isInSuddenDeath = isSuddenDeath(state, targetScoreForCount(count));

  for (const data of slotData) {
    const value = data.pct.toFixed(1) + '%';
    const sittingOut = (data.flags & FLAG_ACTIVE) === 0 && data.pct === 0;

    if (sittingOut) {
      rows.push({
        slot: data.slot,
        color: data.color,
        name: data.name,
        value: 'OUT',
        place: null,
        finalized: true,
        preview: 0,
        status: data.status,
      });
      continue;
    }

    let better = 0;
    for (const other of slotData) {
      if (other.slot === data.slot) continue;
      const otherSittingOut = (other.flags & FLAG_ACTIVE) === 0 && other.pct === 0;
      if (otherSittingOut) continue;
      if (other.pct > data.pct) {
        better += 1;
      }
    }
    const place = 1 + better;

    let preview: number | null;
    let marker: string | undefined;

    if (phase === PHASE_OVERTIME && (data.flags & FLAG_CONTENDER) !== 0) {
      marker = 'TIE';
      preview = null;
    } else if (isInSuddenDeath) {
      preview = place === 1 ? 1 : 0;
    } else {
      preview = count - place;
    }

    rows.push({
      slot: data.slot,
      color: data.color,
      name: data.name,
      value,
      place,
      finalized: false,
      preview,
      status: data.status,
      marker,
    });
  }

  return { stage: 'live', rows };
}
