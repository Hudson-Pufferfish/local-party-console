import './screen.css';
import type { PlayerSlot } from '../../../shared/src/types/game.ts';
import { bannerCopy } from './banner.ts';
import { buildCyberRehydrateEvents, createCyberEventsDiff } from './events.ts';
import { levelsForMask, standbyBotLevel, writeHeuristic } from './heuristic.ts';
import { createCyberCitadelRenderer } from './renderer.ts';
import { scoreboardHeader, scoreboardRows, scoreRules } from './scoreboard.ts';
import { createCyberCitadelSimulation } from './simulation.ts';

export function createCyberCitadelScreenRuntime() {
  return {
    createSim: () => createCyberCitadelSimulation(),
    eventsFromHeaderDiff: createCyberEventsDiff(),
    createRenderer: createCyberCitadelRenderer,
    writeBotInput: writeHeuristic,
    botLevels: levelsForMask,
    standbyBotLevel,
    rehydrateEvents: (state: Float32Array, slot: number) => buildCyberRehydrateEvents(state, slot),
    scoreboardHeader: (state: Float32Array) => scoreboardHeader(state),
    scoreboardRows: (
      state: Float32Array,
      names: readonly string[],
      players?: readonly PlayerSlot[],
    ) => scoreboardRows(state, names, players),
    scoreRules: (state: Float32Array) => scoreRules(state),
    bannerCopy: (state: Float32Array, names: readonly string[]) => bannerCopy(state, names),
    rematchEventType: 'cyber:rematch',
  };
}
