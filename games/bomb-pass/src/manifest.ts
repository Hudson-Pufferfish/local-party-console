import { APP_THEME } from '../../../shared/src/theme.ts';
import type { GameManifest } from '../../../shared/src/types/game.ts';

export const BOMB_PASS_MANIFEST: GameManifest = {
  id: 'bomb-pass',
  title: 'BOMB PASS',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: true, // Heuristic chase/flee policy lives in heuristic.ts.
  rendererType: 'phaser-2d',
  viewConfig: {
    mode: 'holistic',
    inputBufferMode: 'zero-buffer',
  },
  supportedOrientations: ['portrait', 'landscape'],
  controllerLayout: {
    preset: 'stick-single',
    buttons: [
      {
        bit: 0,
        glyph: 'A',
        label: 'DASH',
        kind: 'tap',
        cooldownMs: 1500,
        hapticMs: 20,
      },
    ],
  },
  themeTokens: {
    '--bg-surface': '#EAE6DF',
    '--ink-primary': '#111111',
    '--accent-hazard': APP_THEME.yellowDeep,
    '--accent-dash': APP_THEME.yellowWarm,
    '--accent-spark': APP_THEME.yellowBright,
    '--accent-bomb': '#E10600',
    '--accent-ready': '#00C853',
    '--arena-plate': '#D6D1C7',
  },
};
