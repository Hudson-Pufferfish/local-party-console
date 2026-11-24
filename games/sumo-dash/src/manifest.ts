import type { GameManifest } from '../../../shared/src/types/game.ts';

export const SUMO_DASH_MANIFEST: GameManifest = {
  id: 'sumo-dash',
  title: 'SUMO DASH',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: false, // v1 humans only. v1.1 sets this true and adds the heuristic below.
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
