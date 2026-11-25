import './screen.css';
import type { PlayerSlot } from '../../../shared/src/types/game.ts';
import { bannerCopy } from './banner.ts';
import { eventsFromHeaderDiff } from './events.ts';
import { levelsForMask, writeHeuristic } from './heuristic.ts';
import { createBombPassRenderer } from './renderer.ts';
import { scoreboardHeader, scoreboardRows, scoreRules } from './scoreboard.ts';
import { createBombPassSimulation } from './simulation.ts';

export function createBombPassScreenRuntime() {
  return {
    createSim: () => createBombPassSimulation(),
    eventsFromHeaderDiff,
    createRenderer: createBombPassRenderer,
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
    rematchEventType: 'bomb:rematch',
  };
}
