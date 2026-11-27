import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { GameManifest } from '../../shared/src/types/game.ts';
import { startSession } from './session.ts';
import { resetTabLocksForTest } from './sim-lock.ts';

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
  controllerLayout: {
    preset: 'stick-single',
    buttons: [{ bit: 0, glyph: 'A', label: 'ACTION', kind: 'tap' }],
  },
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
  expect(typeof runtime.createRoundRanking).toBe('function');
  expect(runtime.rematchEventType).toBe('bomb:rematch');
});

test('screenGames registers last-light with lazy runtime, rehydrateEvent, and holistic tap-only config', async () => {
  const manifests = listScreenManifests();
  const light = manifests.find((m) => m.id === 'last-light');
  expect(light).toBeDefined();
  expect(light?.title).toBe('LAST LIGHT');
  expect(light?.supportsBots).toBe(true);
  expect(light?.viewConfig.mode).toBe('holistic');
  expect(light?.controllerLayout.preset).toBe('tap-only');

  const runtime = await screenGames.load('last-light');
  expect(typeof runtime.createSim).toBe('function');
  expect(typeof runtime.eventsFromHeaderDiff).toBe('function');
  expect(typeof runtime.rehydrateEvent).toBe('function');
  expect(typeof runtime.createRenderer).toBe('function');
  expect(typeof runtime.writeBotInput).toBe('function');
  expect(typeof runtime.botLevels).toBe('function');
  expect(typeof runtime.scoreboardHeader).toBe('function');
  expect(typeof runtime.scoreboardRows).toBe('function');
  expect(typeof runtime.scoreRules).toBe('function');
  expect(typeof runtime.bannerCopy).toBe('function');
  expect(typeof runtime.createRoundRanking).toBe('function');
  expect(runtime.rematchEventType).toBe('light:rematch');
});

afterEach(() => {
  resetTabLocksForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'window');
});

test('session emits ScreenGameRuntime.rehydrateEvent when a player reconnects during an active match', async () => {
  class MockSocket extends EventTarget {
    static OPEN = 1;
    binaryType = 'arraybuffer';
    readyState = MockSocket.OPEN;
    sent: string[] = [];
    constructor(_url: string) {
      super();
      sockets.push(this);
    }
    send(data: string): void {
      this.sent.push(data);
    }
    close(): void {}
  }

  class MockChannel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage(): void {}
    close(): void {}
  }

  const sockets: MockSocket[] = [];
  const memory = new Map<string, string>([['party-host-REHY', 'host-secret']]);
  const win = Object.assign(new EventTarget(), {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  });

  globalThis.window = win as unknown as Window & typeof globalThis;
  vi.stubGlobal('location', {
    search: '?room=REHY&view=holistic',
    host: '10.0.0.1:8443',
    pathname: '/screen',
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  });
  vi.stubGlobal('navigator', {
    locks: {
      request: (
        _name: string,
        _options: LockOptions,
        cb: (lock: Lock | null) => Promise<void> | void,
      ) => Promise.resolve(cb({ name: _name, mode: 'exclusive' } as Lock)),
    },
  });
  vi.stubGlobal('WebSocket', MockSocket);
  vi.stubGlobal('BroadcastChannel', MockChannel);
  vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }));

  const rehydrateSpy = vi.fn((state: Float32Array) => ({
    type: 'quiz:state',
    roomId: '',
    payload: { tick: state[0] },
  }));

  const simState = new Float32Array(88);
  simState[0] = 42;
  const mockRuntime: ScreenGameRuntime = {
    createSim: () => ({
      state: simState,
      applyInput() {},
      step() {},
      startMatch() {},
    }),
    rehydrateEvent: rehydrateSpy,
  };

  screenGames.register({
    manifest: { ...TEST_MANIFEST, id: 'mock-rehydrate-quiz' },
    load: async () => mockRuntime,
  });

  const session = startSession({
    setRoomId() {},
    setQrUrl() {},
    setPlayers() {},
    setPrimary() {},
    setSdpWarning() {},
    setStandby() {},
    setMatch() {},
    setMatchOver() {},
    setScoreRows() {},
    setBanner() {},
    setNotice() {},
    setSelectedId() {},
    setBotLobby() {},
  });

  await Promise.resolve();
  const ws = sockets[0]!;
  ws.dispatchEvent(new Event('open'));

  const dispatchPlayers = (connected0: boolean, connected1: boolean): void => {
    ws.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'room:players',
          payload: {
            players: [
              { index: 0, name: 'ADA', color: '#FF4D00', teamId: null, connected: connected0 },
              { index: 1, name: 'BEAU', color: '#00C853', teamId: null, connected: connected1 },
            ],
          },
        }),
      }),
    );
  };

  // Initial lobby join does not trigger rehydrateEvent.
  dispatchPlayers(true, true);
  expect(rehydrateSpy).not.toHaveBeenCalled();

  session.selectGame('mock-rehydrate-quiz');
  session.start();
  await Promise.resolve();
  await Promise.resolve();

  // Disconnect slot 1, then reconnect slot 1 during active match.
  dispatchPlayers(true, false);
  expect(rehydrateSpy).not.toHaveBeenCalled();

  dispatchPlayers(true, true);
  expect(rehydrateSpy).toHaveBeenCalledTimes(1);
  expect(ws.sent.some((raw) => raw.includes('"type":"quiz:state"') && raw.includes('"tick":42'))).toBe(true);

  session.stop();
});
