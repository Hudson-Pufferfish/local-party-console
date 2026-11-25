import { expect, test } from 'vitest';
import { APP_THEME } from '../../../shared/src/theme.ts';
import { BOMB_PASS_MANIFEST } from './manifest.ts';

test('BOMB_PASS_MANIFEST matches Bomb Pass contract and holistic view config', () => {
  expect(BOMB_PASS_MANIFEST.id).toBe('bomb-pass');
  expect(BOMB_PASS_MANIFEST.title).toBe('BOMB PASS');
  expect(BOMB_PASS_MANIFEST.minPlayers).toBe(2);
  expect(BOMB_PASS_MANIFEST.maxPlayers).toBe(8);
  expect(BOMB_PASS_MANIFEST.supportsTeams).toBe(false);
  expect(BOMB_PASS_MANIFEST.maxTeams).toBe(0);
  expect(BOMB_PASS_MANIFEST.supportsBots).toBe(true);
  expect(BOMB_PASS_MANIFEST.rendererType).toBe('phaser-2d');
  expect(BOMB_PASS_MANIFEST.viewConfig).toEqual({
    mode: 'holistic',
    inputBufferMode: 'zero-buffer',
  });
  expect(BOMB_PASS_MANIFEST.supportedOrientations).toEqual(['portrait', 'landscape']);
  expect(BOMB_PASS_MANIFEST.themeTokens).toEqual({
    '--bg-surface': '#EAE6DF',
    '--ink-primary': '#111111',
    '--accent-hazard': APP_THEME.yellowDeep,
    '--accent-dash': APP_THEME.yellowWarm,
    '--accent-spark': APP_THEME.yellowBright,
    '--accent-bomb': '#E10600',
    '--accent-ready': '#00C853',
    '--arena-plate': '#D6D1C7',
  });
});
