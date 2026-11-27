import fs from 'node:fs';
import path from 'node:path';
import type { VoidComponent } from 'solid-js';
import { expect, test } from 'vitest';
import type { GameManifest } from '../../shared/src/types/game.ts';
import {
  controllerGames,
  controllerSupportedOrientations,
  createControllerGameLoader,
  loadControllerView,
  localTheme,
  type ControllerViewProps,
} from './register-games.ts';

const MOCK_MANIFEST: GameManifest = {
  id: 'mock-coop',
  title: 'MOCK COOP',
  minPlayers: 1,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: true,
  rendererType: 'phaser-2d',
  viewConfig: { mode: 'holistic', inputBufferMode: 'zero-buffer' },
  supportedOrientations: ['portrait', 'landscape'],
  controllerLayout: {
    preset: 'stick-diamond',
    buttons: [
      { bit: 0, glyph: 'A', label: 'A', kind: 'tap' },
      { bit: 1, glyph: 'B', label: 'B', kind: 'tap' },
      { bit: 2, glyph: 'X', label: 'X', kind: 'tap' },
      { bit: 3, glyph: 'Y', label: 'Y', kind: 'tap' },
    ],
  },
  themeTokens: { '--bg-surface': '#F4F1EA' },
};

test('controller register-games keeps only manifests eager, deduplicates lazy loads, and registers cyber-citadel', async () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, 'register-games.ts'), 'utf8');
  expect(source).not.toMatch(/import\s+[^;]*from\s+['"][^'"]*controller-view\.tsx['"]/);
  expect(source).toContain('import(');

  expect(controllerGames.has('sumo-dash')).toBe(true);
  expect(controllerGames.has('bomb-pass')).toBe(true);
  expect(controllerGames.has('color-clash')).toBe(true);
  expect(controllerGames.has('cyber-citadel')).toBe(true);
  expect(controllerSupportedOrientations('cyber-citadel')).toEqual(['portrait', 'landscape']);
  expect(localTheme('cyber-citadel')['--bg-surface']).toBe('#F4F1EA');

  const cyberView = await loadControllerView('cyber-citadel');
  expect(typeof cyberView).toBe('function');

  // Deduplication and retry on failure with mock descriptor
  const StubView: VoidComponent<ControllerViewProps> = () => null;
  let calls = 0;
  let failOnce = true;
  const loader = createControllerGameLoader([
    {
      manifest: MOCK_MANIFEST,
      load: async () => {
        calls += 1;
        if (failOnce) {
          failOnce = false;
          throw new Error('blip');
        }
        return StubView;
      },
    },
  ]);

  await expect(loader.load('mock-coop')).rejects.toThrow('blip');
  const [v1, v2] = await Promise.all([loader.load('mock-coop'), loader.load('mock-coop')]);
  expect(v1).toBe(StubView);
  expect(v2).toBe(StubView);
  expect(calls).toBe(2);
});
