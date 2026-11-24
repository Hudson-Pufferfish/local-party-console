import { toCanvas } from 'qrcode';
import { bannerCopy, matchWinnerTag } from '../../games/sumo-dash/src/banner.ts';
import { SUMO_CONSTANTS } from '../../games/sumo-dash/src/constants.ts';
import { scoreboardRows, type ScoreRow } from '../../games/sumo-dash/src/scoreboard.ts';
import { qrTarget } from '../../shared/src/sdp/qr-target.ts';
import type { GameManifest, PlayerSlot, ScreenViewTarget } from '../../shared/src/types/game.ts';
import { standbyCopy } from '../../shared/src/view/policy.ts';
import {
  createBotFill,
  createBotLobby,
  lockBotCount,
  nextBotCount,
  rosterForStart,
  unlockBotCount,
  type BotLobbyState,
} from './bot-fill.ts';
import { SNAPSHOT_BYTES, createHostLoop, type HostLoop } from './host-loop.ts';
import { createPeerMap, type PeerMap } from './peer.ts';
import { createIngest, type TelemetryRead } from './telemetry/ingest.ts';
import { screenGames, type ArenaRenderer, type ScreenGame } from './register-games.ts';

export interface SessionHandlers {
  setRoomId: (value: string) => void;
  setQrUrl: (value: string) => void;
  setPlayers: (value: PlayerSlot[]) => void;
  setPrimary: (value: boolean) => void;
  setSdpWarning: (value: boolean) => void;
  setStandby: (value: string | null) => void;
  setMatch: (value: boolean) => void;
  setMatchOver: (value: boolean) => void;
  setScoreRows: (value: ScoreRow[]) => void;
  setBanner: (value: string) => void;
  setNotice: (value: string) => void;
  setSelectedId: (value: string) => void;
  setBotLobby: (value: BotLobbyState) => void;
}

export interface ScreenSession {
  readonly view: ScreenViewTarget;
  selectGame: (id: string) => void;
  start: () => void;
  playAgain: () => void;
  returnToLobby: () => void;
  setBotCount: (requested: number) => void;
  readTelemetry: (slot: number) => TelemetryRead | null;
  resumeAudio: () => void;
  attachQr: (canvas: HTMLCanvasElement) => void;
  attachMatch: (canvas: HTMLCanvasElement) => void;
  stop: () => void;
}

const VIEWS: readonly ScreenViewTarget[] = ['holistic', 'team-1', 'team-2', 'team-3', 'team-4'];

export function readScreenView(raw: string | null): ScreenViewTarget {
  for (const view of VIEWS) {
    if (view === raw) return view;
  }
  return 'holistic';
}

export function startSession(handlers: SessionHandlers): ScreenSession {
  const params = new URLSearchParams(location.search);
  const initialRoom = params.get('room');
  const view = readScreenView(params.get('view'));
  if (initialRoom === null || initialRoom === '') {
    void createRoom();
    return idleSession(view);
  }

  const roomId = initialRoom;
  const presented = params.get('hostToken');
  if (presented !== null && presented !== '') {
    localStorage.setItem(hostKey(roomId), presented);
    params.delete('hostToken');
    const query = params.toString();
    const next = query === '' ? location.pathname : `${location.pathname}?${query}`;
    history.replaceState(null, '', next);
  }
  const hostToken = localStorage.getItem(hostKey(roomId));
  handlers.setRoomId(roomId);
  const tabId = crypto.randomUUID();
  let lanIp = '';
  let qrUrl = '';
  let qrCanvas: HTMLCanvasElement | null = null;
  let matchCanvas: HTMLCanvasElement | null = null;
  let matchCtx: CanvasRenderingContext2D | null = null;
  let renderer: ArenaRenderer | null = null;
  let players: PlayerSlot[] = [];
  let selectedId = '';
  let botLobby = createBotLobby();
  const bots = createBotFill((state, botIndex, axisX, axisY, buttons, level) => {
    const writer = screenGames.get(selectedId)?.writeBotInput;
    if (writer === undefined) return;
    writer(state, botIndex, axisX, axisY, buttons, level);
  }, (mask) => {
    const levels = screenGames.get(selectedId)?.botLevels;
    if (levels === undefined) return new Uint8Array(8);
    return levels(mask);
  });
  let primary = false;
  let socket: WebSocket | null = null;
  let socketOpen = false;
  let loop: HostLoop | null = null;
  let raf = 0;
  let lastFrame = 0;
  let audio: AudioContext | null = null;
  let stopped = false;
  let heartbeat = 0;
  const queue: string[] = [];
  const publishBytes = new ArrayBuffer(SNAPSHOT_BYTES);
  const publishView = new Uint8Array(publishBytes);
  const connected = new Uint8Array(8);
  const mirror = new Float32Array(88);
  let lastScoreRows: ScoreRow[] = [];
  let seenEpoch = -1;
  const snapMessage = { epoch: 0, bytes: publishBytes };
  let channel: BroadcastChannel | null = null;

  const ingest = createIngest();
  const peers: PeerMap = createPeerMap({
    onPacket: (slot, seq, buttons, axisX, axisY, phoneTs, touchLag) => {
      const now = performance.now();
      ingest.onInput(slot, seq, phoneTs, touchLag, now);
      loop?.accept(slot, seq, buttons, axisX, axisY, now);
    },
    onHeartbeat: (slot) => {
      ingest.onHeartbeat(slot, performance.now());
    },
    onOffset: (slot, theta) => {
      ingest.onOffset(slot, theta);
    },
    onTier: (slot, tier, lowPower, cores) => {
      ingest.onTier(slot, tier, lowPower, cores);
    },
    onLongTask: (slot, n) => {
      ingest.onLongTask(slot, n);
    },
    isPrimary: () => primary,
    onSdp: (ok) => {
      if (!ok) handlers.setSdpWarning(true);
    },
    send: (message) => {
      send(message);
    },
  });

  if (hostToken === null) {
    handlers.setNotice('HOST // TOKEN MISSING');
    holdAntiNap(roomId, tabId);
    return idleSession(view);
  }

  handlers.setPrimary(false);
  void loadHost(roomId);
  openSocket(roomId, hostToken);
  startAudio();
  holdAntiNap(roomId, tabId);
  if (view === 'holistic') {
    holdSim(roomId);
    listenSnapshots(roomId);
  }

  function send(message: { type: string; payload: unknown }): void {
    const raw = JSON.stringify(message);
    if (socket !== null && socketOpen) socket.send(raw);
    else queue.push(raw);
  }

  function flushQueue(): void {
    if (socket === null) return;
    for (const raw of queue) socket.send(raw);
    queue.length = 0;
  }

  function paintQr(): void {
    if (qrCanvas === null || qrUrl === '') return;
    void toCanvas(qrCanvas, qrUrl, {
      margin: 1,
      width: 280,
      color: { dark: '#111111', light: '#F4F1EA' },
    });
  }

  function destroyRenderer(): void {
    renderer?.destroy();
    renderer = null;
  }

  function mountRenderer(): void {
    if (renderer !== null || matchCanvas === null || view !== 'holistic') return;
    const game = screenGames.get(selectedId);
    if (game?.createRenderer === undefined) return;
    const canvas = matchCanvas;
    renderer = game.createRenderer(canvas, () => {
      if (primary && loop !== null) return loop.state;
      return mirror;
    });
  }

  function scoreNames(): string[] {
    const names = ['', '', '', '', '', '', '', ''];
    for (const player of players) {
      if (player.index < 0 || player.index >= names.length) continue;
      names[player.index] = player.name;
    }
    return names;
  }

  function publishScores(): void {
    const state = primary && loop !== null ? loop.state : mirror;
    const names = scoreNames();
    const rows = scoreboardRows(state, names, SUMO_CONSTANTS.scoreToWin);
    if (!sameScoreRows(lastScoreRows, rows)) {
      lastScoreRows = rows;
      handlers.setScoreRows(rows);
    }
    const winner = matchWinnerTag(state, names, SUMO_CONSTANTS.scoreToWin);
    handlers.setBanner(bannerCopy(state[1] ?? 0, state[2] ?? 0, winner));
  }

  function clearMatch(): void {
    if (matchCanvas === null || matchCtx === null) return;
    matchCtx.fillStyle = '#EAE6DF';
    matchCtx.fillRect(0, 0, matchCanvas.width, matchCanvas.height);
  }

  function paintMatch(): void {
    publishScores();
    if (view === 'holistic') mountRenderer();
    if (renderer !== null) {
      renderer.draw();
      return;
    }
    if (matchCanvas === null) return;
    if (matchCtx === null) matchCtx = matchCanvas.getContext('2d');
    clearMatch();
  }

  function publish(): void {
    if (loop === null || channel === null) return;
    const source = new Uint8Array(loop.snapshot.buffer, loop.snapshot.byteOffset, SNAPSHOT_BYTES);
    publishView.set(source);
    snapMessage.epoch = loop.epoch;
    channel.postMessage(snapMessage);
    paintMatch();
  }

  function offerConnected(): void {
    if (!primary || lanIp === '') return;
    for (let slot = 0; slot < connected.length; slot += 1) {
      if (connected[slot] === 1) void peers.offer(slot, lanIp);
    }
  }

  function applyPlayers(next: PlayerSlot[]): void {
    const was = connected.slice();
    connected.fill(0);
    for (const player of next) {
      if (player.index < 0 || player.index > 7) continue;
      if (player.connected) connected[player.index] = 1;
    }
    for (let slot = 0; slot < connected.length; slot += 1) {
      const before = was[slot] === 1;
      const after = connected[slot] === 1;
      if (before && !after) {
        peers.close(slot);
        loop?.clearSeq(slot);
      }
      if (!before && after) {
        loop?.clearSeq(slot);
        if (primary && lanIp !== '') void peers.offer(slot, lanIp);
      }
    }
    players = next;
    handlers.setPlayers(next);
  }

  function onGameMount(payload: unknown): void {
    const manifest = readManifest(payload);
    if (manifest === null) return;
    const gameId = readGameId(payload);
    const local = gameId === null ? undefined : screenGames.get(gameId);
    if (local !== undefined && gameId !== null) {
      selectedId = gameId;
      handlers.setSelectedId(gameId);
    }
    if (view === 'holistic') return;
    const config = local?.manifest.viewConfig ?? manifest.viewConfig;
    handlers.setStandby(standbyCopy(view, config));
  }

  function connectedHumans(): number {
    let count = 0;
    for (const player of players) {
      if (player.connected) count += 1;
    }
    return count;
  }

  function openLoop(game: ScreenGame): void {
    if (loop !== null) return;
    loop = createHostLoop(
      game.createSim(),
      game.eventsFromHeaderDiff,
      (events) => {
        for (const event of events) send(event);
      },
      (slot, sim) => bots.fill(slot, sim),
    );
  }

  function startFrames(): void {
    if (raf !== 0) return;
    lastFrame = 0;
    const frame = (now: number): void => {
      raf = window.requestAnimationFrame(frame);
      if (loop === null) return;
      const delta = lastFrame === 0 ? 0 : now - lastFrame;
      lastFrame = now;
      const steps = loop.tick(delta, now);
      if (steps > 0) {
        handlers.setMatchOver(loop.matchOver);
        publish();
      }
    };
    raf = window.requestAnimationFrame(frame);
  }

  function stopFrames(): void {
    if (raf === 0) return;
    window.cancelAnimationFrame(raf);
    raf = 0;
  }

  return {
    view,
    selectGame(id: string): void {
      selectedId = id;
      handlers.setSelectedId(id);
      const game = screenGames.get(id);
      if (!primary || game === undefined) return;
      send({
        type: 'game:mount',
        payload: { gameId: id, manifest: game.manifest, players },
      });
    },
    start(): void {
      resumeAudio();
      if (!primary || view !== 'holistic') return;
      const game = screenGames.get(selectedId);
      if (game === undefined) return;
      const roster = rosterForStart(players, game.manifest, botLobby.botCount);
      if (roster === null) return;
      botLobby = lockBotCount(botLobby);
      handlers.setBotLobby(botLobby);
      openLoop(game);
      if (loop === null) return;
      bots.arm(roster.botMask);
      loop.startMatch(roster.slots);
      handlers.setMatch(true);
      handlers.setMatchOver(false);
      publish();
      startFrames();
    },
    playAgain(): void {
      if (!primary || loop === null) return;
      const game = screenGames.get(selectedId);
      if (game === undefined) return;
      const roster = rosterForStart(players, game.manifest, botLobby.botCount);
      if (roster === null) return;
      bots.arm(roster.botMask);
      loop.startMatch(roster.slots);
      handlers.setMatch(true);
      handlers.setMatchOver(false);
      publish();
      send({ type: 'sumo:rematch', payload: { action: 'restart' } });
    },
    returnToLobby(): void {
      if (!primary || loop === null) return;
      botLobby = unlockBotCount(botLobby);
      handlers.setBotLobby(botLobby);
      loop.release();
      stopFrames();
      destroyRenderer();
      handlers.setMatch(false);
      handlers.setMatchOver(false);
      lastScoreRows = [];
      handlers.setScoreRows([]);
      handlers.setBanner('');
      send({ type: 'sumo:rematch', payload: { action: 'lobby' } });
    },
    readTelemetry(slot: number): TelemetryRead | null {
      if (slot < 0 || slot > 7) return null;
      ingest.setTransport(slot, peers.mode(slot));
      return ingest.read(slot);
    },
    setBotCount(requested: number): void {
      const game = screenGames.get(selectedId);
      botLobby = nextBotCount(
        botLobby,
        requested,
        connectedHumans(),
        game?.manifest.maxPlayers ?? 8,
        game?.manifest.supportsBots === true,
      );
      handlers.setBotLobby(botLobby);
    },
    resumeAudio,
    attachQr(canvas: HTMLCanvasElement): void {
      qrCanvas = canvas;
      paintQr();
    },
    attachMatch(canvas: HTMLCanvasElement): void {
      if (matchCanvas !== canvas) {
        destroyRenderer();
        matchCanvas = canvas;
        matchCtx = null;
      }
      paintMatch();
    },
    stop(): void {
      stopped = true;
      destroyRenderer();
      stopFrames();
      if (heartbeat !== 0) window.clearInterval(heartbeat);
      socket?.close();
      channel?.close();
      void audio?.close();
    },
  };

  function listenSnapshots(room: string): void {
    channel = new BroadcastChannel(`party-snap-${room}`);
    channel.onmessage = (event: MessageEvent) => {
      if (primary) return;
      const data = event.data as { epoch?: unknown; bytes?: unknown };
      if (typeof data.epoch !== 'number' || !(data.bytes instanceof ArrayBuffer)) return;
      if (data.epoch <= seenEpoch || data.bytes.byteLength < SNAPSHOT_BYTES) return;
      mirror.set(new Float32Array(data.bytes, 0, 88));
      seenEpoch = data.epoch;
      handlers.setMatch(true);
      handlers.setMatchOver(mirror[1] === 3);
      paintMatch();
    };
  }

  function holdSim(room: string): void {
    void navigator.locks.request(
      `party-sim-${room}`,
      { mode: 'exclusive', ifAvailable: true },
      (lock) => {
        if (lock === null) {
          primary = false;
          handlers.setPrimary(false);
          return;
        }
        primary = true;
        handlers.setPrimary(true);
        send({ type: 'viewport:claim', payload: {} });
        offerConnected();
        return new Promise<void>((resolve) => {
          window.addEventListener('pagehide', () => resolve(), { once: true });
        });
      },
    );
  }

  function openSocket(room: string, token: string): void {
    const url = `wss://${location.host}/ws?room=${encodeURIComponent(room)}&role=screen&hostToken=${encodeURIComponent(token)}`;
    socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => {
      socketOpen = true;
      socket?.send(JSON.stringify({
        type: 'viewport:hello',
        payload: { tabId, view },
      }));
      flushQueue();
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        if (event.data instanceof ArrayBuffer) peers.handleBinary(event.data);
        return;
      }
      const message = readMessage(event.data);
      if (message === null) return;
      if (message.type === 'room:players') {
        const next = readPlayers(message.payload);
        if (next !== null) applyPlayers(next);
        return;
      }
      if (message.type === 'room:joined') {
        const index = readIndex(message.payload);
        if (index !== null) loop?.clearSeq(index);
        return;
      }
      if (message.type === 'game:mount') {
        onGameMount(message.payload);
        return;
      }
      if (message.type === 'net:ping') {
        const t = readT(message.payload);
        if (t !== null) send({ type: 'net:pong', payload: { t } });
        return;
      }
      if (
        message.type === 'clock:sync'
        || message.type === 'clock:offset'
        || message.type === 'phone:tier'
        || message.type === 'phone:longtask'
      ) {
        peers.handleText(message.type, message.payload);
        return;
      }
      if (message.type === 'sumo:rematch' && !primary) {
        const action = readAction(message.payload);
        if (action === 'lobby' && view === 'holistic') {
          destroyRenderer();
          handlers.setMatch(false);
          handlers.setMatchOver(false);
          lastScoreRows = [];
          handlers.setScoreRows([]);
          handlers.setBanner('');
        }
        if (action === 'restart' && view === 'holistic') {
          handlers.setMatch(true);
          handlers.setMatchOver(false);
        }
        return;
      }
      if (message.type.startsWith('signal:')) peers.handleText(message.type, message.payload);
    });
    socket.addEventListener('close', () => {
      socketOpen = false;
      if (!stopped) handlers.setNotice('LINK // DOWN');
    });
    heartbeat = window.setInterval(() => {
      if (!socketOpen || socket === null) return;
      socket.send(JSON.stringify({
        type: 'viewport:heartbeat',
        payload: { tabId, view },
      }));
    }, 2000);
  }

  async function loadHost(room: string): Promise<void> {
    const response = await fetch('/api/host');
    if (!response.ok) {
      handlers.setNotice('HOST // OFFLINE');
      return;
    }
    const body = await response.json() as { lanIp?: unknown; port?: unknown };
    if (typeof body.lanIp !== 'string' || typeof body.port !== 'number') return;
    lanIp = body.lanIp;
    qrUrl = qrTarget(body.lanIp, body.port, room);
    handlers.setQrUrl(qrUrl);
    paintQr();
    offerConnected();
  }

  function startAudio(): void {
    try {
      const Ctx = window.AudioContext;
      audio = new Ctx();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      window.addEventListener('pointerdown', resumeAudio);
    } catch {
      audio = null;
    }
  }

  function resumeAudio(): void {
    if (audio !== null && audio.state === 'suspended') void audio.resume();
  }
}

function idleSession(view: ScreenViewTarget): ScreenSession {
  return {
    view,
    selectGame() {},
    start() {},
    playAgain() {},
    returnToLobby() {},
    setBotCount() {},
    readTelemetry() {
      return null;
    },
    resumeAudio() {},
    attachQr() {},
    attachMatch() {},
    stop() {},
  };
}

async function createRoom(): Promise<void> {
  const response = await fetch('/api/rooms', { method: 'POST' });
  if (!response.ok) return;
  const created = await response.json() as { roomId?: unknown; hostToken?: unknown };
  if (typeof created.roomId !== 'string' || typeof created.hostToken !== 'string') return;
  localStorage.setItem(hostKey(created.roomId), created.hostToken);
  location.replace(`/screen?room=${created.roomId}&view=holistic`);
}

function holdAntiNap(room: string, tabId: string): void {
  void navigator.locks.request(`party-antinap-${room}-${tabId}`, { mode: 'exclusive' }, () => {
    return new Promise<void>((resolve) => {
      window.addEventListener('pagehide', () => resolve(), { once: true });
    });
  });
}

function hostKey(roomId: string): string {
  return `party-host-${roomId}`;
}

function readMessage(raw: string): { type: string; payload: unknown } | null {
  try {
    const message = JSON.parse(raw) as { type?: unknown; payload?: unknown };
    if (typeof message.type !== 'string') return null;
    return { type: message.type, payload: message.payload };
  } catch {
    return null;
  }
}

function readPlayers(payload: unknown): PlayerSlot[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const list = (payload as { players?: unknown }).players;
  if (!Array.isArray(list)) return null;
  const players: PlayerSlot[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as {
      index?: unknown;
      name?: unknown;
      color?: unknown;
      teamId?: unknown;
      connected?: unknown;
    };
    if (typeof row.index !== 'number' || typeof row.name !== 'string') continue;
    if (typeof row.color !== 'string' || typeof row.connected !== 'boolean') continue;
    players.push({
      index: row.index,
      name: row.name,
      color: row.color,
      teamId: typeof row.teamId === 'number' ? row.teamId : null,
      connected: row.connected,
    });
  }
  return players;
}

function readManifest(payload: unknown): GameManifest | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const manifest = (payload as { manifest?: unknown }).manifest;
  if (typeof manifest !== 'object' || manifest === null) return null;
  const row = manifest as GameManifest;
  if (typeof row.id !== 'string' || row.viewConfig === undefined) return null;
  if (row.viewConfig.mode !== 'holistic' && row.viewConfig.mode !== 'team-exclusive') return null;
  return row;
}

function readGameId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const gameId = (payload as { gameId?: unknown }).gameId;
  return typeof gameId === 'string' && gameId !== '' ? gameId : null;
}

function readIndex(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const index = (payload as { index?: unknown }).index;
  if (typeof index !== 'number' || index < 0 || index > 7) return null;
  return index;
}

function readAction(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const action = (payload as { action?: unknown }).action;
  return typeof action === 'string' ? action : '';
}

function readT(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const t = (payload as { t?: unknown }).t;
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
}

function sameScoreRows(a: readonly ScoreRow[], b: readonly ScoreRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined || right === undefined) return false;
    if (left.slot !== right.slot || left.color !== right.color || left.text !== right.text) {
      return false;
    }
  }
  return true;
}
