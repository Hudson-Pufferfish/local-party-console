import './screen.css';
import type { PlayerSlot } from '../../../shared/src/types/game.ts';
import { bannerCopy } from './banner.ts';
import { eventsFromHeaderDiff } from './events.ts';
import { levelsForMask, writeHeuristic } from './heuristic.ts';
import { createColorClashRenderer } from './renderer.ts';
import { scoreboardHeader, scoreboardRows, scoreRules } from './scoreboard.ts';
import { createColorClashSimulation } from './simulation.ts';

export function createColorClashScreenRuntime() {
  return {
    createSim: () => createColorClashSimulation(),
    eventsFromHeaderDiff,
    createRenderer: createColorClashRenderer,
    writeBotInput: writeHeuristic,
    botLevels: levelsForMask,
    scoreboardHeader: (state: Float32Array) => scoreboardHeader(state),
    scoreboardRows: (
      state: Float32Array,
      names: readonly string[],
      players?: readonly PlayerSlot[],
    ) => scoreboardRows(state, names, players),
    scoreRules: (state: Float32Array) => scoreRules(state),
    bannerCopy: (state: Float32Array, names: readonly string[]) => bannerCopy(state, names),
    rematchEventType: 'color:rematch',
  };
}
