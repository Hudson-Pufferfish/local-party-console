import { APP_THEME } from '../../../shared/src/theme.ts';
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
  supportedOrientations: ['portrait', 'landscape'],
  themeTokens: {
    '--bg-surface': '#EAE6DF',
    '--ink-primary': '#111111',
    '--accent-hazard': APP_THEME.yellowDeep,
    '--accent-dash': APP_THEME.yellowWarm,
    '--accent-spark': APP_THEME.yellowBright,
    '--accent-ready': '#00C853',
    '--arena-plate': '#D6D1C7',
  },
};
