import { expect, test } from 'vitest';
import { APP_THEME } from '../../../shared/src/theme';
import { COLOR_CLASH_MANIFEST } from './manifest';

test('COLOR_CLASH_MANIFEST satisfies GameDefinition contract and Neo-Brutalist theme tokens', () => {
  expect(COLOR_CLASH_MANIFEST.id).toBe('color-clash');
  expect(COLOR_CLASH_MANIFEST.title).toBe('COLOR CLASH');
  expect(COLOR_CLASH_MANIFEST.minPlayers).toBe(2);
  expect(COLOR_CLASH_MANIFEST.maxPlayers).toBe(8);
  expect(COLOR_CLASH_MANIFEST.supportsTeams).toBe(false);
  expect(COLOR_CLASH_MANIFEST.maxTeams).toBe(0);
  expect(COLOR_CLASH_MANIFEST.supportsBots).toBe(true);
  expect(COLOR_CLASH_MANIFEST.rendererType).toBe('phaser-2d');
  expect(COLOR_CLASH_MANIFEST.viewConfig).toEqual({
    mode: 'holistic',
    inputBufferMode: 'zero-buffer',
  });
  expect(COLOR_CLASH_MANIFEST.supportedOrientations).toEqual(['portrait', 'landscape']);
  expect(COLOR_CLASH_MANIFEST.themeTokens['--grid-unpainted']).toBe('#CFC9BE');
  expect(COLOR_CLASH_MANIFEST.themeTokens['--accent-boost']).toBe(APP_THEME.yellow);
  expect(COLOR_CLASH_MANIFEST.themeTokens['--accent-golden']).toBe(APP_THEME.yellowBright);
  expect(COLOR_CLASH_MANIFEST.themeTokens['--accent-hazard']).toBe(APP_THEME.yellowDeep);
});
