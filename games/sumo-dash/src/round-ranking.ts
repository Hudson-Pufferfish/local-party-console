import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import {
  isSuddenDeath,
  shortTag,
  shouldIncludeSlot,
  targetScoreForCount,
  type RoundRankingView,
  type RoundRankRow,
  type RoundStage,
  type ScorePlayerStatus,
} from './scoreboard.ts';

const PHASE = 1;
const PLAYER = 8;
const STRIDE = 10;
const SLOTS = 8;
const FALLBACK_COLOR = '#111111';

const PHASE_COUNTDOWN = 0;
const PHASE_ACTIVE = 1;
const PHASE_ROUND_END = 2;
const PHASE_MATCH_OVER = 3;
const PHASE_PRACTICE = 4;
const FLAG_ALIVE = 1;

// Known limit: a mirror monitor tab can skip frames, so two knockouts on different
// ticks can look like the same frame there and share a place. The +N on the frozen
// rows is still exact because the shared round-panel model reads it from the totals.
export function createSumoRoundRanking(): {
  read(
    state: Float32Array,
    names: readonly string[],
    players?: readonly ScorePlayerStatus[],
  ): RoundRankingView;
} {
  const lockedPlace = new Map<number, number>();
  const sittingOut = new Set<number>();
  let wasLive = false;

  return {
    read(
      state: Float32Array,
      names: readonly string[],
      players?: readonly ScorePlayerStatus[],
    ): RoundRankingView {
      const phase = state[PHASE] ?? PHASE_COUNTDOWN;
      let stage: RoundStage;
      if (phase === PHASE_PRACTICE || phase === PHASE_COUNTDOWN) {
        stage = 'idle';
      } else if (phase === PHASE_ROUND_END || phase === PHASE_MATCH_OVER) {
        stage = 'final';
      } else {
        stage = 'live';
      }

      const slots: Array<{
        slot: number;
        alive: boolean;
        name: string;
        color: string;
        status?: 'LIVE' | 'AWAY';
      }> = [];

      for (let index = 0; index < SLOTS; index += 1) {
        if (!shouldIncludeSlot(state, index)) continue;
        const base = PLAYER + index * STRIDE;
        const flags = state[base + 8] ?? 0;
        const alive = (flags & FLAG_ALIVE) !== 0;
        const tag = shortTag(names[index] ?? '', index);
        const player = players?.find((entry) => entry.index === index);
        slots.push({
          slot: index,
          alive,
          name: tag,
          color: PLAYER_COLORS[index] ?? FALLBACK_COLOR,
          status: player === undefined ? undefined : (player.connected ? 'LIVE' : 'AWAY'),
        });
      }

      if (stage === 'idle') {
        lockedPlace.clear();
        sittingOut.clear();
        wasLive = false;
        return {
          stage: 'idle',
          rows: slots.map((data) => ({
            slot: data.slot,
            color: data.color,
            name: data.name,
            value: '',
            place: null,
            finalized: false,
            preview: null,
            status: data.status,
          })),
        };
      }

      if (stage === 'live' && !wasLive) {
        for (const data of slots) {
          if (!data.alive) sittingOut.add(data.slot);
        }
        wasLive = true;
      }

      let aliveNow = 0;
      for (const data of slots) {
        if (data.alive) aliveNow += 1;
      }
      for (const data of slots) {
        if (!data.alive && !sittingOut.has(data.slot) && !lockedPlace.has(data.slot)) {
          lockedPlace.set(data.slot, aliveNow + 1);
        }
      }

      const count = slots.length;
      const sudden = isSuddenDeath(state, targetScoreForCount(count));
      const rows: RoundRankRow[] = [];

      if (stage === 'final') {
        for (const data of slots) {
          if (sittingOut.has(data.slot)) {
            rows.push({
              slot: data.slot,
              color: data.color,
              name: data.name,
              value: 'OUT',
              place: null,
              finalized: true,
              preview: null,
              status: data.status,
            });
            continue;
          }
          if (data.alive) {
            rows.push({
              slot: data.slot,
              color: data.color,
              name: data.name,
              value: 'ALIVE',
              place: 1,
              finalized: true,
              preview: null,
              status: data.status,
            });
            continue;
          }
          rows.push({
            slot: data.slot,
            color: data.color,
            name: data.name,
            value: 'OUT',
            place: lockedPlace.get(data.slot) ?? null,
            finalized: true,
            preview: null,
            status: data.status,
          });
        }
        return { stage: 'final', rows };
      }

      for (const data of slots) {
        if (data.alive) {
          rows.push({
            slot: data.slot,
            color: data.color,
            name: data.name,
            value: 'ALIVE',
            place: null,
            finalized: false,
            preview: null,
            status: data.status,
          });
          continue;
        }
        if (sittingOut.has(data.slot)) {
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
        const place = lockedPlace.get(data.slot) ?? null;
        const preview = place === null ? null : (sudden ? 0 : count - place);
        rows.push({
          slot: data.slot,
          color: data.color,
          name: data.name,
          value: 'OUT',
          place,
          finalized: true,
          preview,
          status: data.status,
        });
      }

      return { stage: 'live', rows };
    },
  };
}
