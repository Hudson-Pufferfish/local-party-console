import { renderToString } from '@solidjs/web';
import { afterEach, expect, test, vi } from 'vitest';
import type { GameManifest } from '../../../../shared/src/types/game.ts';
import { screenGames, type ScreenGameRuntime } from '../../register-games.ts';
import { startSession } from '../../session.ts';
import { resetTabLocksForTest } from '../../sim-lock.ts';
import { HolisticMatchShell } from './holistic-match-shell.tsx';

const SUMO_MANIFEST: GameManifest = {
  id: 'sumo-dash',
  title: 'SUMO DASH',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: true,
  rendererType: 'phaser-2d',
  viewConfig: { mode: 'holistic', inputBufferMode: 'zero-buffer' },
  controllerLayout: {
    preset: 'stick-single',
    buttons: [{ bit: 0, glyph: 'A', label: 'DASH', kind: 'tap' }],
  },
  themeTokens: {},
};

afterEach(() => {
  resetTabLocksForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'window');
});

test('HolisticMatchShell renders holistic match frame and gates exit, score rules, and podium controls', () => {
  const activePrimaryHtml = renderToString(() => (
    <HolisticMatchShell
      gameId="sumo-dash"
      primary={true}
      match={true}
      matchOver={false}
      manifest={SUMO_MANIFEST}
      banner="ROUND 1"
      scoreHeader="THRESHOLD: 9"
      scoreRows={[{ slot: 0, color: '#FF4D00', name: 'HUDSON', score: 3, status: 'LIVE' }]}
      scoreRules={{ rows: [{ label: '1ST', value: '+3 PTS' }] }}
      onQr={() => {}}
      onMatchCanvas={() => {}}
      onPlayAgain={() => {}}
      onExit={() => {}}
    />
  ));

  expect(activePrimaryHtml).toContain('<section class="match" data-game="sumo-dash">');
  expect(activePrimaryHtml).toContain('class="match-rejoin"');
  expect(activePrimaryHtml).toContain('class="match-exit"');
  expect(activePrimaryHtml).toContain('<p class="match-banner">ROUND 1</p>');
  expect(activePrimaryHtml).toContain('class="score-rules"');
  expect(activePrimaryHtml).toContain('<canvas width="800" height="800"></canvas>');
  expect(activePrimaryHtml).toContain('class="scoreboard-panel"');
  expect(activePrimaryHtml).toContain('THRESHOLD: 9');
  expect(activePrimaryHtml).toContain('HUDSON');
  expect(activePrimaryHtml).not.toContain('class="podium"');

  const matchOverPrimaryHtml = renderToString(() => (
    <HolisticMatchShell
      gameId="sumo-dash"
      primary={true}
      match={true}
      matchOver={true}
      manifest={SUMO_MANIFEST}
      banner="HUDSON WINS"
      scoreHeader="THRESHOLD: 9"
      scoreRows={[{ slot: 0, color: '#FF4D00', name: 'HUDSON', score: 9, status: 'LIVE' }]}
      scoreRules={null}
      onQr={() => {}}
      onMatchCanvas={() => {}}
      onPlayAgain={() => {}}
      onExit={() => {}}
    />
  ));

  expect(matchOverPrimaryHtml).not.toContain('class="score-rules"');
  expect(matchOverPrimaryHtml).toContain('class="podium"');
  expect(matchOverPrimaryHtml).toContain('>PLAY AGAIN<');
  expect(matchOverPrimaryHtml).toContain('>RETURN TO LOBBY<');

  const matchOverSecondaryHtml = renderToString(() => (
    <HolisticMatchShell
      gameId="sumo-dash"
      primary={false}
      match={true}
      matchOver={true}
      manifest={SUMO_MANIFEST}
      banner="HUDSON WINS"
      scoreHeader="THRESHOLD: 9"
      scoreRows={[{ slot: 0, color: '#FF4D00', name: 'HUDSON', score: 9 }]}
      scoreRules={null}
      onQr={() => {}}
      onMatchCanvas={() => {}}
      onPlayAgain={() => {}}
      onExit={() => {}}
    />
  ));

  expect(matchOverSecondaryHtml).not.toContain('class="match-exit"');
  expect(matchOverSecondaryHtml).not.toContain('class="podium"');
});

test('session.playAgain() emits runtime rematchEventType only when the game runtime defines one', async () => {
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
  const memory = new Map<string, string>([['party-host-ROOM', 'secret']]);
  const win = Object.assign(new EventTarget(), {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  });

  globalThis.window = win as unknown as Window & typeof globalThis;
  vi.stubGlobal('location', {
    search: '?room=ROOM&view=holistic',
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

  const simState = new Float32Array(88);
  const runtimeWithoutRematch: ScreenGameRuntime = {
    createSim: () => ({
      state: simState,
      applyInput() {},
      step() {},
      startMatch() {
        simState[1] = 1;
      },
    }),
  };

  vi.spyOn(screenGames, 'load').mockResolvedValue(runtimeWithoutRematch);
  vi.spyOn(screenGames, 'getLoaded').mockReturnValue(runtimeWithoutRematch);

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

  try {
    const socket = sockets[0];
    if (socket === undefined) throw new Error('missing socket');
    socket.dispatchEvent(new Event('open'));
    await Promise.resolve();
    await Promise.resolve();

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        type: 'room:players',
        payload: {
          players: [{ index: 0, name: 'ADA', color: '#FF4D00', teamId: null, connected: true }],
        },
      }),
    }));

    session.selectGame('sumo-dash');
    session.setBotCount(1);
    session.start();
    await Promise.resolve();
    await Promise.resolve();

    socket.sent.length = 0;
    session.playAgain();

    const sentTypes = socket.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);
    expect(sentTypes).toEqual(['game:mount', 'room:phase']);
  } finally {
    session.stop();
  }
});
