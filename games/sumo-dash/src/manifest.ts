import type { GameManifest } from '../../../shared/src/types/game.ts';

export const SUMO_DASH_MANIFEST: GameManifest = {
  id: 'sumo-dash',
  title: 'SUMO DASH',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: true, // Heuristic policy lives in heuristic.ts.
  rendererType: 'phaser-2d',
  viewConfig: {
    mode: 'holistic',
    inputBufferMode: 'zero-buffer',
  },
  themeTokens: {
    '--bg-surface': '#EAE6DF',
    '--ink-primary': '#111111',
    '--accent-hazard': '#FF4D00',
    '--accent-ready': '#00C853',
    '--arena-plate': '#D6D1C7',
  },
};
