import { APP_THEME } from '../../../shared/src/theme.ts';
import type { GameManifest } from '../../../shared/src/types/game.ts';

export const COLOR_CLASH_MANIFEST: GameManifest = {
  id: 'color-clash',
  title: 'COLOR CLASH',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: true,
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
        label: 'BOOST',
        kind: 'tap',
      },
    ],
  },
  themeTokens: {
    '--bg-surface': '#F4F1EA',
    '--ink-primary': '#111111',
    '--arena-plate': '#CFC9BE',
    '--grid-unpainted': '#CFC9BE',
    '--grid-line': '#B8B1A4',
    '--accent-boost': APP_THEME.yellow,
    '--accent-golden': APP_THEME.yellowBright,
    '--accent-hazard': APP_THEME.yellowDeep,
    '--accent-ready': '#00C853',
    '--accent-splash': '#FF4D00',
  },
};
