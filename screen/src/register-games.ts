import { eventsFromHeaderDiff } from '../../games/sumo-dash/src/events.ts';
import { levelsForMask, writeHeuristic } from '../../games/sumo-dash/src/heuristic.ts';
import { SUMO_DASH_MANIFEST } from '../../games/sumo-dash/src/manifest.ts';
import { createSumoRenderer } from '../../games/sumo-dash/src/renderer.ts';
import { createSumoSimulation } from '../../games/sumo-dash/src/simulation.ts';
import { GameRegistry } from '../../shared/src/registry.ts';
import type { Envelope } from '../../shared/src/types/envelope.ts';
import type { GameManifest } from '../../shared/src/types/game.ts';
import type { BotLevels, WriteBotInput } from './bot-fill.ts';
import type { ScreenSim } from './host-loop.ts';

export interface ArenaRenderer {
  draw(): void;
  destroy(): void;
}

export interface ScreenGame {
  manifest: GameManifest;
  createSim: () => ScreenSim;
  eventsFromHeaderDiff?: (prev: Float32Array, next: Float32Array) => Envelope[];
  createRenderer?: (
    canvas: HTMLCanvasElement,
    readState: () => Float32Array,
    readNames?: () => readonly string[],
  ) => ArenaRenderer;
  writeBotInput?: WriteBotInput;
  botLevels?: BotLevels;
}

export const screenGames = new Map<string, ScreenGame>();

export function listScreenManifests(): GameManifest[] {
  const registry = new GameRegistry();
  for (const game of screenGames.values()) {
    registry.register(game.manifest);
  }
  return registry.list();
}

screenGames.set(SUMO_DASH_MANIFEST.id, {
  manifest: SUMO_DASH_MANIFEST,
  createSim: () => createSumoSimulation(),
  eventsFromHeaderDiff,
  createRenderer: createSumoRenderer,
  writeBotInput: writeHeuristic,
  botLevels: levelsForMask,
});
