import './screen.css';
import { bannerCopy, matchWinnerTag } from './banner.ts';
import { eventsFromHeaderDiff } from './events.ts';
import { levelsForMask, writeHeuristic } from './heuristic.ts';
import { createSumoRenderer } from './renderer.ts';
import { scoreboardRows, scoreRules } from './scoreboard.ts';
import { createSumoSimulation } from './simulation.ts';

export function createSumoScreenRuntime() {
  return {
    createSim: () => createSumoSimulation(),
    eventsFromHeaderDiff,
    createRenderer: createSumoRenderer,
    writeBotInput: writeHeuristic,
    botLevels: levelsForMask,
    scoreboardRows: (state: Float32Array, names: readonly string[]) =>
      scoreboardRows(state, names),
    scoreRules: (state: Float32Array) => scoreRules(state),
    bannerCopy: (state: Float32Array, names: readonly string[]) => {
      const winner = matchWinnerTag(state, names);
      return bannerCopy(state[1] ?? 0, state[2] ?? 0, winner);
    },
    rematchEventType: 'sumo:rematch',
  };
}
