import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { afterEach, expect, test, vi } from 'vitest';
import type { GameManifest, PlayerSlot } from '../../shared/src/types/game.ts';
import type { BotLobbyState } from './bot-fill.ts';
import { Lobby } from './lobby.tsx';
import {
  MatchExitControl,
  canShowMatchExit,
  isSingleScreenGame,
  reduceMatchExit,
  type MatchExitState,
} from './match-exit.tsx';
import {
  screenGames,
  type ScoreRow,
  type ScoreRules,
  type ScreenGameRuntime,
} from './register-games.ts';
import { startSession } from './session.ts';
import { resetTabLocksForTest } from './sim-lock.ts';

const HOLISTIC_MANIFEST: GameManifest = {
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

const MULTISCREEN_MANIFEST: GameManifest = {
  id: 'team-duel',
  title: 'TEAM DUEL',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: true,
  maxTeams: 2,
  supportsBots: false,
  rendererType: 'three-3d',
  viewConfig: {
    mode: 'team-exclusive',
    requiredTeams: 2,
    allowHolisticSpectator: false,
    inputBufferMode: 'zero-buffer',
  },
  controllerLayout: {
    preset: 'stick-single',
    buttons: [{ bit: 0, glyph: 'A', label: 'DUEL', kind: 'tap' }],
  },
  themeTokens: {},
};

function renderExit(state: MatchExitState, onConfirm: () => void): string {
  return renderToString(() => (
    <MatchExitControl
      primary={state.primary}
      match={state.match}
      manifest={state.manifest}
      confirmOpen={state.confirmOpen}
      onConfirm={onConfirm}
    />
  ));
}

test('holistic game renders (x) exit button and clicking it opens confirmation modal with exact prompt', () => {
  expect(isSingleScreenGame(HOLISTIC_MANIFEST)).toBe(true);
  expect(canShowMatchExit(true, true, HOLISTIC_MANIFEST)).toBe(true);

  const returnToLobby = vi.fn();
  let state: MatchExitState = {
    primary: true,
    match: true,
    manifest: HOLISTIC_MANIFEST,
    confirmOpen: false,
  };

  const initialHtml = renderExit(state, returnToLobby);
  expect(initialHtml).toContain('class="match-exit"');
  expect(initialHtml).toContain('type="button"');
  expect(initialHtml).toContain('>×<');
  expect(initialHtml).not.toContain('role="dialog"');

  state = reduceMatchExit(state, { type: 'open' });
  expect(state.confirmOpen).toBe(true);

  const openHtml = renderExit(state, returnToLobby);
  expect(openHtml).toContain('role="dialog"');
  expect(openHtml).toContain('aria-modal="true"');
  expect(openHtml).toContain('QUIT MATCH?');
  expect(openHtml).toContain('Are you sure to end the current game and quit to the lobby?');
  expect(openHtml).toContain('>CANCEL<');
  expect(openHtml).toContain('>QUIT TO LOBBY<');
});

test('clicking CANCEL closes the confirmation modal without calling resetLobby', () => {
  const resetLobby = vi.fn();
  let state: MatchExitState = {
    primary: true,
    match: true,
    manifest: HOLISTIC_MANIFEST,
    confirmOpen: false,
  };

  state = reduceMatchExit(state, { type: 'open' });
  expect(state.confirmOpen).toBe(true);

  state = reduceMatchExit(state, { type: 'cancel' });
  expect(state.confirmOpen).toBe(false);
  expect(state.match).toBe(true);
  expect(resetLobby).not.toHaveBeenCalled();

  const afterCancelHtml = renderExit(state, resetLobby);
  expect(afterCancelHtml).toContain('class="match-exit"');
  expect(afterCancelHtml).not.toContain('role="dialog"');
});

test('clicking QUIT TO LOBBY calls resetLobby, transitions back to lobby, and keeps modal closed next match', () => {
  let inMatch = true;
  const resetLobby = vi.fn(() => {
    inMatch = false;
  });
  let state: MatchExitState = {
    primary: true,
    match: inMatch,
    manifest: HOLISTIC_MANIFEST,
    confirmOpen: false,
  };

  state = reduceMatchExit(state, { type: 'open' });
  expect(state.confirmOpen).toBe(true);

  state = reduceMatchExit(state, { type: 'confirm' }, resetLobby);
  state = reduceMatchExit(state, {
    type: 'sync',
    primary: true,
    match: inMatch,
    manifest: HOLISTIC_MANIFEST,
  });

  expect(resetLobby).toHaveBeenCalledTimes(1);
  expect(inMatch).toBe(false);
  expect(state.match).toBe(false);
  expect(state.confirmOpen).toBe(false);

  const lobbyHtml = renderExit(state, resetLobby);
  expect(lobbyHtml).not.toContain('class="match-exit"');
  expect(lobbyHtml).not.toContain('role="dialog"');

  // Starting another match later keeps modal closed.
  state = reduceMatchExit(state, {
    type: 'sync',
    primary: true,
    match: true,
    manifest: HOLISTIC_MANIFEST,
  });
  expect(state.confirmOpen).toBe(false);
});

test('multi-screen games, secondary monitors, and lobby do not render (x) button and styles stay Neo-Brutalist', () => {
  expect(isSingleScreenGame(MULTISCREEN_MANIFEST)).toBe(false);
  expect(isSingleScreenGame(undefined)).toBe(false);
  expect(canShowMatchExit(true, true, MULTISCREEN_MANIFEST)).toBe(false);

  const returnToLobby = vi.fn();
  let multiState: MatchExitState = {
    primary: true,
    match: true,
    manifest: MULTISCREEN_MANIFEST,
    confirmOpen: false,
  };

  multiState = reduceMatchExit(multiState, { type: 'open' });
  expect(multiState.confirmOpen).toBe(false);

  const multiHtml = renderExit(multiState, returnToLobby);
  expect(multiHtml).not.toContain('class="match-exit"');
  expect(multiHtml).not.toContain('role="dialog"');

  // Secondary monitor on holistic game: hidden.
  const secondaryState: MatchExitState = {
    primary: false,
    match: true,
    manifest: HOLISTIC_MANIFEST,
    confirmOpen: false,
  };
  expect(canShowMatchExit(false, true, HOLISTIC_MANIFEST)).toBe(false);
  expect(renderExit(secondaryState, returnToLobby)).not.toContain('class="match-exit"');

  // Primary monitor in lobby: hidden.
  const lobbyState: MatchExitState = {
    primary: true,
    match: false,
    manifest: HOLISTIC_MANIFEST,
    confirmOpen: false,
  };
  expect(canShowMatchExit(true, false, HOLISTIC_MANIFEST)).toBe(false);
  expect(renderExit(lobbyState, returnToLobby)).not.toContain('class="match-exit"');

  const matchCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles/match.css'), 'utf8');
  const exitBlock = matchCss.match(/\.match-exit\s*\{[^}]*\}/)?.[0] ?? '';
  const panelBlock = matchCss.match(/\.confirm-panel\s*\{[^}]*\}/)?.[0] ?? '';
  expect(exitBlock).toContain('border: 2.5px solid');
  expect(exitBlock).toContain('box-shadow:');
  expect(panelBlock).toContain('border: 2.5px solid');
  expect(panelBlock).toContain('box-shadow: 0px 6px 0px #111111');
  expect(matchCss).not.toContain('backdrop-filter');
});

afterEach(() => {
  resetTabLocksForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'window');
});

test('session.resetLobby() unselects game, resets bots/match/scores, tears down renderer, broadcasts unmount + lobby phase, and hides BOTS panel in lobby', async () => {
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
  const memory = new Map<string, string>([['party-host-ABCD', 'host-secret']]);
  let rafId = 0;
  const cancelledRafs: number[] = [];
  const win = Object.assign(new EventTarget(), {
    requestAnimationFrame: () => {
      rafId += 1;
      return rafId;
    },
    cancelAnimationFrame: (id: number) => {
      cancelledRafs.push(id);
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });

  globalThis.window = win as unknown as Window & typeof globalThis;
  vi.stubGlobal('location', {
    search: '?room=ABCD&view=holistic',
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
  vi.stubGlobal('fetch', async () => ({
    ok: false,
    json: async () => ({}),
  }));

  const rendererDestroy = vi.fn();
  const simState = new Float32Array(88);
  const fakeRuntime: ScreenGameRuntime = {
    createSim: () => ({
      state: simState,
      applyInput() {},
      step() {},
      startMatch() {
        simState[1] = 1;
      },
    }),
    createRenderer: () => ({
      draw() {},
      destroy: rendererDestroy,
    }),
    scoreboardHeader: () => 'FIRST TO 3',
    scoreboardRows: () => [{ slot: 0, color: '#FF4D00', name: 'ADA', score: 1 }],
    scoreRules: () => ({ rows: [{ label: '1ST', value: '+3' }] }),
    bannerCopy: () => 'FIGHT',
    rematchEventType: 'sumo:rematch',
  };
  vi.spyOn(screenGames, 'load').mockResolvedValue(fakeRuntime);
  vi.spyOn(screenGames, 'getLoaded').mockReturnValue(fakeRuntime);

  let selectedId = '';
  let botLobby: BotLobbyState = { botCount: 0, difficulty: 'medium', locked: false };
  let match = false;
  let matchOver = false;
  let standby: string | null = 'STANDBY';
  let scoreHeader = '';
  let scoreRows: ScoreRow[] = [];
  let scoreRules: ScoreRules | null = null;
  let banner = '';
  let players: PlayerSlot[] = [];

  const session = startSession({
    setRoomId() {},
    setQrUrl() {},
    setPlayers(next) {
      players = next;
    },
    setPrimary() {},
    setSdpWarning() {},
    setStandby(next) {
      standby = next;
    },
    setMatch(next) {
      match = next;
    },
    setMatchOver(next) {
      matchOver = next;
    },
    setScoreHeader(next) {
      scoreHeader = next;
    },
    setScoreRows(next) {
      scoreRows = next;
    },
    setScoreRules(next) {
      scoreRules = next;
    },
    setBanner(next) {
      banner = next;
    },
    setNotice() {},
    setSelectedId(next) {
      selectedId = next;
    },
    setBotLobby(next) {
      botLobby = next;
    },
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
    session.setBotDifficulty('hard');
    expect(selectedId).toBe('sumo-dash');
    expect(botLobby).toEqual({ botCount: 1, difficulty: 'hard', locked: false });

    session.attachMatch({} as HTMLCanvasElement);
    session.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(match).toBe(true);
    expect(botLobby).toEqual({ botCount: 1, difficulty: 'hard', locked: true });
    expect(scoreHeader).toBe('FIRST TO 3');
    expect(scoreRows).toHaveLength(1);
    expect(scoreRules).not.toBeNull();
    expect(banner).toBe('FIGHT');

    socket.sent.length = 0;
    session.resetLobby();

    expect(selectedId).toBe('');
    expect(botLobby).toEqual({ botCount: 0, difficulty: 'medium', locked: false });
    expect(match).toBe(false);
    expect(matchOver).toBe(false);
    expect(standby).toBeNull();
    expect(scoreHeader).toBe('');
    expect(scoreRows).toEqual([]);
    expect(scoreRules).toBeNull();
    expect(banner).toBe('');
    expect(rendererDestroy).toHaveBeenCalledTimes(1);
    expect(cancelledRafs.length).toBeGreaterThan(0);

    expect(socket.sent).toEqual([
      JSON.stringify({ type: 'game:unmount', payload: {} }),
      JSON.stringify({ type: 'room:phase', payload: { phase: 'lobby' } }),
    ]);

    const lobbyHtml = renderToString(() => (
      <Lobby
        roomId="ABCD"
        qrUrl="https://10.0.0.1:8443/controller?rev=0.0.6&room=ABCD"
        notice=""
        sdpWarning={false}
        players={players}
        games={[HOLISTIC_MANIFEST]}
        selectedId={selectedId}
        startEnabled={selectedId !== ''}
        botCount={botLobby.botCount}
        botDifficulty={botLobby.difficulty}
        botControlEnabled={false}
        botNotice=""
        canKick={true}
        onBotStep={() => {}}
        onBotDifficulty={() => {}}
        onQr={() => {}}
        onSelect={() => {}}
        onStart={() => {}}
        onKick={() => {}}
      />
    ));
    expect(lobbyHtml).toContain('data-selected="false"');
    expect(lobbyHtml).not.toContain('<h2>BOTS</h2>');
    expect(lobbyHtml).toMatch(/class="key start"[^>]*\bdisabled\b/);
  } finally {
    session.stop();
  }
});
