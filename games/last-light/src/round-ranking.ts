import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import {
  LAMP_FLAG,
  LAST_LIGHT_CONSTANTS as C,
  LIGHT_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
} from './constants.ts';
import {
  shortTag,
  shouldIncludeSlot,
  type RoundRankRow,
  type RoundRankingView,
  type RoundStage,
  type ScorePlayerStatus,
} from './scoreboard.ts';
import { readPlayerFlags, readPlayerLastRoundPoints, readPlayerLockTick } from './state.ts';

const FALLBACK_COLOR = '#111111';

function formatLockTime(lockTick: number): string {
  const secs = lockTick > 0 ? lockTick / C.stepHz : 0;
  return `${secs.toFixed(1)}s`;
}

export function createLastLightRoundRanking(): {
  read(
    state: Float32Array,
    names: readonly string[],
    players?: readonly ScorePlayerStatus[],
  ): RoundRankingView;
} {
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

      const lampFlags = (state[H.lampFlags] ?? 0) | 0;
      const winnerSlot = state[H.winnerSlot] ?? -1;

      const slots: Array<{
        slot: number;
        flags: number;
        name: string;
        color: string;
        status?: 'LIVE' | 'AWAY';
      }> = [];

      for (let index = 0; index < C.maxPlayers; index += 1) {
        if (!shouldIncludeSlot(state, index)) continue;
        const flags = readPlayerFlags(state, index);
        const player = players?.find((entry) => entry.index === index);
        slots.push({
          slot: index,
          flags,
          name: shortTag(names[index] ?? '', index),
          color: PLAYER_COLORS[index] ?? FALLBACK_COLOR,
          status: player === undefined ? undefined : (player.connected ? 'LIVE' : 'AWAY'),
        });
      }

      if (stage === 'idle') {
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

      if (stage === 'live') {
        // INV-8: Never read lockTick during live stage; sort strictly by slot (place: null, finalized: false).
        return {
          stage: 'live',
          rows: slots.map((data) => {
            let value = 'IN';
            if ((data.flags & LIGHT_FLAG.active) === 0) {
              value = 'WATCHING';
            } else if ((data.flags & LIGHT_FLAG.locked) !== 0) {
              value = 'LOCKED';
            }
            return {
              slot: data.slot,
              color: data.color,
              name: data.name,
              value,
              place: null,
              finalized: false,
              preview: null,
              status: data.status,
            };
          }),
        };
      }

      // Final stage (ROUND_END / MATCH_OVER): reveal competition places and exact lock times.
      const lockedEntries: Array<{ slot: number; lockTick: number }> = [];
      let anyEarned = false;
      for (const data of slots) {
        if (readPlayerLastRoundPoints(state, data.slot) > 0) {
          anyEarned = true;
        }
        if ((data.flags & LIGHT_FLAG.active) !== 0 && (data.flags & LIGHT_FLAG.locked) !== 0) {
          lockedEntries.push({
            slot: data.slot,
            lockTick: readPlayerLockTick(state, data.slot),
          });
        }
      }

      const isSuddenDeathReplay =
        (lampFlags & LAMP_FLAG.suddenDeath) !== 0 && winnerSlot < 0 && !anyEarned;

      const rows: RoundRankRow[] = [];
      for (const data of slots) {
        if ((data.flags & LIGHT_FLAG.active) === 0) {
          rows.push({
            slot: data.slot,
            color: data.color,
            name: data.name,
            value: 'WATCHING',
            place: null,
            finalized: true,
            preview: null,
            status: data.status,
          });
          continue;
        }

        if ((data.flags & LIGHT_FLAG.locked) === 0) {
          rows.push({
            slot: data.slot,
            color: data.color,
            name: data.name,
            value: 'OUT',
            place: null,
            finalized: true,
            preview: null,
            status: data.status,
            marker: isSuddenDeathReplay ? 'REPLAY' : undefined,
          });
          continue;
        }

        const myLock = readPlayerLockTick(state, data.slot);
        let strictlyLater = 0;
        for (const other of lockedEntries) {
          if (other.lockTick > myLock) strictlyLater += 1;
        }
        const place = strictlyLater + 1;
        rows.push({
          slot: data.slot,
          color: data.color,
          name: data.name,
          value: formatLockTime(myLock),
          place,
          finalized: true,
          preview: null,
          status: data.status,
          marker: isSuddenDeathReplay && place === 1 ? 'REPLAY' : undefined,
        });
      }

      return { stage: 'final', rows };
    },
  };
}
