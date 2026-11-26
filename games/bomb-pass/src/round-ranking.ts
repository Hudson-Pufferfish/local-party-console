import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import {
  BOMB_CONSTANTS as C,
  BOMB_FLAG_ALIVE,
  BOMB_FLAG_HOLDING,
  BOMB_FLAG_SD_CONTENDER,
  BOMB_HEADER as H,
  BOMB_PHASE as P,
  BOMB_PLAYER_BASE as PLAYER,
  BOMB_PLAYER_STRIDE as STRIDE,
} from './constants.ts';
import {
  isRoundSuddenDeath,
  isSuddenDeath,
  shortTag,
  shouldIncludeSlot,
  targetScoreForCount,
  type RoundRankRow,
  type RoundRankingView,
  type RoundStage,
  type ScorePlayerStatus,
} from './scoreboard.ts';

const FALLBACK_COLOR = '#111111';

// Known limits:
// A mirror monitor tab can skip frames, so two blasts on different ticks can
// look like one frame there and share a place.
// In the replay round the earned +N for everyone, including parked players,
// is exact. The shared round-panel model reads it from the totals. The
// replay roundEnd with nobody alive shows +0 for everyone. That is correct.
// That blast gives no points.
export function createBombPassRoundRanking(): {
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
      const phase = state[H.phase] ?? P.countdown;
      let stage: RoundStage;
      if (phase === P.practice || phase === P.countdown) {
        stage = 'idle';
      } else if (phase === P.roundEnd || phase === P.matchOver) {
        stage = 'final';
      } else {
        stage = 'live';
      }

      const slots: Array<{
        slot: number;
        flags: number;
        alive: boolean;
        name: string;
        color: string;
        status?: 'LIVE' | 'AWAY';
      }> = [];

      for (let index = 0; index < C.maxPlayers; index += 1) {
        if (!shouldIncludeSlot(state, index)) continue;
        const base = PLAYER + index * STRIDE;
        const flags = state[base + 8] ?? 0;
        const tag = shortTag(names[index] ?? '', index);
        const player = players?.find((entry) => entry.index === index);
        slots.push({
          slot: index,
          flags,
          alive: (flags & BOMB_FLAG_ALIVE) !== 0,
          name: tag,
          color: PLAYER_COLORS[index] ?? FALLBACK_COLOR,
          status: player === undefined ? undefined : (player.connected ? 'LIVE' : 'AWAY'),
        });
      }

      if (stage === 'idle') {
        if (isRoundSuddenDeath(state)) {
          for (const data of slots) {
            if ((data.flags & BOMB_FLAG_SD_CONTENDER) !== 0) lockedPlace.delete(data.slot);
          }
          sittingOut.clear();
        } else {
          lockedPlace.clear();
          sittingOut.clear();
        }
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
          if (!data.alive && !lockedPlace.has(data.slot)) sittingOut.add(data.slot);
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
      const replay = stage === 'final' && isRoundSuddenDeath(state);
      const rows: RoundRankRow[] = [];

      for (const data of slots) {
        const bombMarker = data.alive && (data.flags & BOMB_FLAG_HOLDING) !== 0
          ? 'BOMB'
          : undefined;
        if (replay && (data.flags & BOMB_FLAG_SD_CONTENDER) !== 0) {
          rows.push({
            slot: data.slot,
            color: data.color,
            name: data.name,
            value: 'OUT',
            place: null,
            finalized: true,
            preview: null,
            status: data.status,
            marker: 'REPLAY',
          });
          continue;
        }
        if (data.alive && stage === 'final') {
          rows.push({
            slot: data.slot,
            color: data.color,
            name: data.name,
            value: 'ALIVE',
            place: 1,
            finalized: true,
            preview: null,
            status: data.status,
            marker: bombMarker,
          });
          continue;
        }
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
            marker: bombMarker,
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
            preview: stage === 'final' ? null : 0,
            status: data.status,
          });
          continue;
        }
        const place = lockedPlace.get(data.slot) ?? null;
        const preview = stage === 'final' || place === null
          ? null
          : (sudden ? 0 : count - place);
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

      return { stage, rows };
    },
  };
}
