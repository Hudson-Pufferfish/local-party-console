import type { GameManifest } from '../../../shared/src/types/game.ts';

export const LAST_LIGHT_MANIFEST: GameManifest = {
  id: 'last-light',
  title: 'LAST LIGHT',
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
    preset: 'tap-only',
    buttons: [
      {
        bit: 0,
        glyph: 'A',
        label: 'LOCK IN',
        kind: 'tap',
        hapticMs: 20,
      },
    ],
  },
  themeTokens: {
    '--bg-surface': '#F4F1EA',
    '--ink-primary': '#111111',
    '--lamp-glow': '#FF6B2B',
    '--lamp-filament': '#FFF4DC',
    '--lamp-shade': '#22201E',
    '--lamp-blackout': '#0D0D0D',
  },
};
