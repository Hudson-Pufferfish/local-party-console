import type { GameManifest } from '../../../shared/src/types/game.ts';

export const CYBER_CITADEL_MANIFEST: GameManifest = {
  id: 'cyber-citadel',
  title: 'CYBER-CITADEL',
  minPlayers: 1,
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
    preset: 'stick-diamond',
    buttons: [
      { bit: 0, glyph: 'A', label: 'LASER', kind: 'tap', cooldownMs: 2500, hapticMs: 25 },
      { bit: 1, glyph: 'B', label: 'DASH', kind: 'tap', hapticMs: 18 },
      { bit: 2, glyph: 'X', label: 'WALL', kind: 'tap', hapticMs: 14 },
      { bit: 3, glyph: 'Y', label: 'REVIVE', kind: 'tap', hapticMs: 18 },
    ],
  },
  themeTokens: {
    '--bg-surface': '#F4F1EA',
    '--ink-primary': '#111111',
    '--accent-hazard-alert': '#FF4D00',
    '--accent-shield-arc': '#E10600',
  },
};
