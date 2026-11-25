import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import type { GameManifest } from '../../shared/src/types/game.ts';

vi.mock('phaser', () => ({
  default: {
    CANVAS: 1,
    Scale: { NONE: 0 },
    Game: class {},
    Scene: class {},
  },
}));
import {
  createScreenGameLoader,
  createStartGuard,
  listScreenManifests,
  screenGames,
  type ScreenGameRuntime,
} from './register-games.ts';

const TEST_MANIFEST: GameManifest = {
  id: 'alpha-arena',
  title: 'ALPHA ARENA',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: true,
  rendererType: 'phaser-2d',
  viewConfig: { mode: 'holistic', inputBufferMode: 'zero-buffer' },
  themeTokens: {},
};

function stubRuntime(): ScreenGameRuntime {
  return {
    createSim: () => ({
      state: new Float32Array(88),
      applyInput() {},
      step() {},
      startMatch() {},
    }),
  };
}

test('register-games keeps only manifests eager and deduplicates lazy runtime loads with retry on failure', async () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, 'register-games.ts'), 'utf8');
  expect(source).not.toMatch(/import\s+[^;]*from\s+['"][^'"]*renderer\.ts['"]/);
  expect(source).not.toMatch(/import\s+[^;]*from\s+['"][^'"]*simulation\.ts['"]/);
  expect(source).not.toMatch(/import\s+[^;]*from\s+['"][^'"]*heuristic\.ts['"]/);
  expect(source).toContain('import(');

  const manifests = listScreenManifests();
  expect(manifests.some((m) => m.id === 'sumo-dash')).toBe(true);
  expect(manifests.some((m) => m.id === 'color-clash')).toBe(true);

  let calls = 0;
  let shouldFail = true;
  const runtime = stubRuntime();
  let resolveSecond!: (value: ScreenGameRuntime) => void;
  const loader = createScreenGameLoader([
    {
      manifest: TEST_MANIFEST,
      load: () => {
        calls += 1;
        if (shouldFail) return Promise.reject(new Error('network blip'));
        return new Promise<ScreenGameRuntime>((resolve) => {
          resolveSecond = resolve;
        });
      },
    },
  ]);

  expect(loader.listManifests().map((m) => m.id)).toEqual(['alpha-arena']);
  expect(loader.getLoaded('alpha-arena')).toBeUndefined();
  await expect(loader.load('alpha-arena')).rejects.toThrow('network blip');
  expect(loader.getLoaded('alpha-arena')).toBeUndefined();

  shouldFail = false;
  const first = loader.load('alpha-arena');
  const second = loader.load('alpha-arena');
  expect(calls).toBe(2);
  resolveSecond(runtime);
  const [r1, r2] = await Promise.all([first, second]);
  expect(r1).toBe(runtime);
  expect(r2).toBe(runtime);
  expect(loader.getLoaded('alpha-arena')).toBe(runtime);
});

test('createStartGuard prevents duplicate START launches while loading and aborts stale launches', async () => {
  const runtime = stubRuntime();
  let resolveLoad!: (value: ScreenGameRuntime) => void;
  const loadingStates: boolean[] = [];
  let launched = 0;
  let stillValid = true;

  const guard = createStartGuard({
    load: () =>
      new Promise<ScreenGameRuntime>((resolve) => {
        resolveLoad = resolve;
      }),
    onLoadingChange: (loading) => loadingStates.push(loading),
  });

  const pending = guard.run('alpha-arena', () => stillValid, () => {
    launched += 1;
  });
  expect(guard.loading).toBe(true);
  expect(loadingStates).toEqual([true]);

  const duplicate = await guard.run('alpha-arena', () => stillValid, () => {
    launched += 1;
  });
  expect(duplicate).toBe(false);

  resolveLoad(runtime);
  expect(await pending).toBe(true);
  expect(launched).toBe(1);
  expect(guard.loading).toBe(false);
  expect(loadingStates).toEqual([true, false]);

  // If selection or readiness changes while loading, launch is skipped cleanly.
  const stalePending = guard.run('alpha-arena', () => stillValid, () => {
    launched += 1;
  });
  stillValid = false;
  resolveLoad(runtime);
  expect(await stalePending).toBe(false);
  expect(launched).toBe(1);
  expect(guard.loading).toBe(false);
});

test('screenGames registers bomb-pass with lazy runtime and holistic config', async () => {
  const manifests = listScreenManifests();
  const bomb = manifests.find((m) => m.id === 'bomb-pass');
  expect(bomb).toBeDefined();
  expect(bomb?.title).toBe('BOMB PASS');
  expect(bomb?.supportsBots).toBe(true);
  expect(bomb?.viewConfig.mode).toBe('holistic');

  const runtime = await screenGames.load('bomb-pass');
  expect(typeof runtime.createSim).toBe('function');
  expect(typeof runtime.eventsFromHeaderDiff).toBe('function');
  expect(typeof runtime.createRenderer).toBe('function');
  expect(typeof runtime.writeBotInput).toBe('function');
  expect(typeof runtime.botLevels).toBe('function');
  expect(typeof runtime.scoreboardHeader).toBe('function');
  expect(typeof runtime.scoreboardRows).toBe('function');
  expect(typeof runtime.scoreRules).toBe('function');
  expect(typeof runtime.bannerCopy).toBe('function');
  expect(runtime.rematchEventType).toBe('bomb:rematch');
});
