import './screen.css';
import type { PlayerSlot } from '../../../shared/src/types/game.ts';
import { bannerCopy } from './banner.ts';
import { buildLightStateEnvelope, createLastLightEventsDiff } from './events.ts';
import { levelsForMask, writeHeuristic } from './heuristic.ts';
import { createLastLightRenderer } from './renderer.ts';
import { createLastLightRoundRanking } from './round-ranking.ts';
import { scoreboardHeader, scoreboardRows, scoreRules } from './scoreboard.ts';
import { createLastLightSimulation } from './simulation.ts';

export function createLastLightScreenRuntime() {
  const eventsFromHeaderDiff = createLastLightEventsDiff();
  return {
    createSim: () => createLastLightSimulation(),
    eventsFromHeaderDiff,
    rehydrateEvent: (state: Float32Array) => buildLightStateEnvelope(state),
    createRenderer: createLastLightRenderer,
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
    rematchEventType: 'light:rematch',
    createRoundRanking: createLastLightRoundRanking,
  };
}
