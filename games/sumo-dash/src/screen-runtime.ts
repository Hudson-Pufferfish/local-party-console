import './screen.css';
import type { PlayerSlot } from '../../../shared/src/types/game.ts';
import { bannerCopy, matchWinnerTag } from './banner.ts';
import { eventsFromHeaderDiff } from './events.ts';
import { levelsForMask, writeHeuristic } from './heuristic.ts';
import { createSumoRenderer } from './renderer.ts';
import { createSumoRoundRanking } from './round-ranking.ts';
import { isSuddenDeath, scoreboardHeader, scoreboardRows, scoreRules } from './scoreboard.ts';
import { createSumoSimulation } from './simulation.ts';

export function createSumoScreenRuntime() {
  return {
    createSim: () => createSumoSimulation(),
    eventsFromHeaderDiff,
    createRenderer: createSumoRenderer,
    writeBotInput: writeHeuristic,
    botLevels: levelsForMask,
    scoreboardHeader: (state: Float32Array) => scoreboardHeader(state),
    scoreboardRows: (
      state: Float32Array,
      names: readonly string[],
      players?: readonly PlayerSlot[],
    ) => scoreboardRows(state, names, players),
    scoreRules: (state: Float32Array) => scoreRules(state),
    bannerCopy: (state: Float32Array, names: readonly string[]) => {
      const winner = matchWinnerTag(state, names);
      return bannerCopy(state[1] ?? 0, state[2] ?? 0, winner, isSuddenDeath(state));
    },
    rematchEventType: 'sumo:rematch',
    createRoundRanking: createSumoRoundRanking,
  };
}
