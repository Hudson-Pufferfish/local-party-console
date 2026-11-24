import { routeFastInput, type FastInputRoute } from '../../shared/src/transport/policy.ts';
import { bindTransport, markJoined, setSeq } from './send-input.ts';

const CHANNEL: RTCDataChannelInit = {
  ordered: false,
  maxRetransmits: 0,
  negotiated: true,
  id: 0,
};

const routeInput = {
  channelOpen: false,
  channelAgeMs: 0,
  bufferedAmount: 0,
};

export interface JoinedSlot {
  index: number;
  sessionToken: string;
  name: string;
  color: string;
}

export type SendResult = 'open' | 'queued' | 'closed';

export function joinNotice(result: SendResult | 'missing'): string {
  return result === 'open' ? 'JOIN // SENT' : 'LINK // DOWN';
}

export interface PhoneLink {
  sendText: (message: { type: string; payload: unknown }) => SendResult;
  close: () => void;
}

export function storedToken(room: string): string | null {
  const value = localStorage.getItem(sessionKey(room));
  if (value === null || value === '') return null;
  return value;
}

export function storeToken(room: string, token: string): void {
  localStorage.setItem(sessionKey(room), token);
}

export function storedSeq(room: string): number {
  const raw = localStorage.getItem(seqKey(room));
  if (raw === null) return -1;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) return -1;
  return value;
}

export function storeSeq(room: string, seq: number): void {
  localStorage.setItem(seqKey(room), String(seq & 0xffff));
}

export function connectPhone(
  room: string,
  hooks: {
    onJoined: (slot: JoinedSlot) => void;
    onFull: () => void;
    onMount: (gameId: string) => void;
    onPong: (sentAt: number, receivedAt: number) => void;
    onLink: (up: boolean) => void;
    onControl?: (type: string, payload: unknown) => void;
  },
): PhoneLink {
  let socket: WebSocket | null = null;
  let socketOpen = false;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let slot = -1;
  let startedAt = 0;
  let answering = false;
  let stopped = false;
  let pingA = 0;
  let pingB = 0;
  let pingMarks = 0;
  let secondPing = 0;
  let connectTimer = 0;
  const queue: string[] = [];

  bindTransport({
    readRoute(): FastInputRoute {
      routeInput.channelOpen = dc !== null && dc.readyState === 'open';
      routeInput.channelAgeMs = startedAt === 0 ? 0 : performance.now() - startedAt;
      routeInput.bufferedAmount = dc === null ? 0 : dc.bufferedAmount;
      return routeFastInput(routeInput);
    },
    sendDc(buffer: ArrayBuffer): boolean {
      if (dc === null || dc.readyState !== 'open') return false;
      try {
        dc.send(buffer);
      } catch {
        return false;
      }
      return true;
    },
    sendWs(buffer: ArrayBuffer): boolean {
      if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(buffer);
      return true;
    },
  });

  const url = `wss://${location.host}/ws?room=${encodeURIComponent(room)}&role=controller`;
  socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  connectTimer = window.setTimeout(() => {
    if (stopped || socketOpen) return;
    hooks.onLink(false);
  }, 2000);
  socket.addEventListener('open', () => {
    socketOpen = true;
    window.clearTimeout(connectTimer);
    hooks.onLink(true);
    flushQueue();
    sendPing();
    secondPing = window.setTimeout(sendPing, 200);
  });
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    const message = readMessage(event.data);
    if (message === null) return;
    handleText(message.type, message.payload);
  });
  socket.addEventListener('error', () => {
    socketOpen = false;
    if (!stopped) hooks.onLink(false);
  });
  socket.addEventListener('close', () => {
    socketOpen = false;
    window.clearTimeout(connectTimer);
    if (!stopped) hooks.onLink(false);
  });

  function sendText(message: { type: string; payload: unknown }): SendResult {
    const raw = JSON.stringify(message);
    if (socket !== null && socketOpen) {
      socket.send(raw);
      return 'open';
    }
    if (socket !== null && socket.readyState === WebSocket.CONNECTING) {
      queue.push(raw);
      return 'queued';
    }
    if (!stopped) hooks.onLink(false);
    return 'closed';
  }

  function flushQueue(): void {
    if (socket === null) return;
    for (const raw of queue) socket.send(raw);
    queue.length = 0;
  }

  function sendPing(): void {
    if (pingMarks >= 2) return;
    const t = Math.round(performance.now());
    if (pingMarks === 0) pingA = t;
    else pingB = t;
    pingMarks += 1;
    sendText({ type: 'net:ping', payload: { t } });
  }

  function ownPing(t: number): boolean {
    if (pingMarks > 0 && t === pingA) return true;
    return pingMarks > 1 && t === pingB;
  }

  function handleText(type: string, payload: unknown): void {
    if (type === 'room:joined') {
      const joined = readJoined(payload);
      if (joined === null) return;
      slot = joined.index;
      storeToken(room, joined.sessionToken);
      const previous = storedSeq(room);
      setSeq(previous < 0 ? 0 : (previous + 1) & 0xffff);
      markJoined();
      startPeer();
      hooks.onJoined(joined);
      return;
    }
    if (type === 'room:full') {
      hooks.onFull();
      return;
    }
    if (type === 'game:mount') {
      const mountedRoom = readRoomId(payload);
      if (mountedRoom !== null && mountedRoom !== room) return;
      const gameId = readGameId(payload);
      if (gameId === null) return;
      hooks.onMount(gameId);
      return;
    }
    if (type.startsWith('sumo:')) {
      hooks.onControl?.(type, payload);
      return;
    }
    if (type === 'net:ping') {
      const t = readT(payload);
      if (t === null) return;
      sendText({ type: 'net:pong', payload: { t } });
      return;
    }
    if (type === 'net:pong') {
      const t = readT(payload);
      if (t === null || !ownPing(t)) return;
      hooks.onPong(t, Math.round(performance.now()));
      return;
    }
    if (type === 'signal:offer') {
      onOffer(payload);
      return;
    }
    if (type === 'signal:ice') onIce(payload);
  }

  function startPeer(): void {
    if (pc !== null) return;
    startedAt = performance.now();
    const next = new RTCPeerConnection({ iceServers: [] });
    pc = next;
    const channel = next.createDataChannel('input', CHANNEL);
    channel.binaryType = 'arraybuffer';
    dc = channel;
    next.onicecandidate = (event) => {
      if (event.candidate === null || slot < 0) return;
      sendText({
        type: 'signal:ice',
        payload: {
          slot,
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        },
      });
    };
  }

  function onOffer(payload: unknown): void {
    if (pc === null || slot < 0) return;
    const toSlot = readToSlot(payload);
    if (toSlot !== slot) return;
    const sdp = readSdp(payload);
    if (sdp === null) return;
    if (pc.signalingState !== 'stable' || answering) return;
    answering = true;
    void answer(sdp);
  }

  async function answer(sdp: string): Promise<void> {
    const current = pc;
    if (current === null) {
      answering = false;
      return;
    }
    try {
      await current.setRemoteDescription({ type: 'offer', sdp });
      const created = await current.createAnswer();
      await current.setLocalDescription(created);
      const local = current.localDescription?.sdp ?? created.sdp ?? '';
      sendText({ type: 'signal:answer', payload: { slot, sdp: local } });
    } catch {
      answering = false;
      return;
    }
    answering = false;
  }

  function onIce(payload: unknown): void {
    if (pc === null) return;
    const candidate = readCandidate(payload);
    if (candidate === null) return;
    void pc.addIceCandidate(candidate);
  }

  return {
    sendText,
    close(): void {
      stopped = true;
      if (secondPing !== 0) window.clearTimeout(secondPing);
      if (connectTimer !== 0) window.clearTimeout(connectTimer);
      socket?.close();
      dc?.close();
      pc?.close();
    },
  };
}

function sessionKey(room: string): string {
  return `party-session-${room}`;
}

function seqKey(room: string): string {
  return `party-seq-${room}`;
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

function readJoined(payload: unknown): JoinedSlot | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const row = payload as { index?: unknown; sessionToken?: unknown; players?: unknown };
  if (typeof row.index !== 'number' || row.index < 0 || row.index > 7) return null;
  if (typeof row.sessionToken !== 'string' || row.sessionToken === '') return null;
  let name = '';
  let color = '#111111';
  if (Array.isArray(row.players)) {
    for (const entry of row.players) {
      if (typeof entry !== 'object' || entry === null) continue;
      const player = entry as { index?: unknown; name?: unknown; color?: unknown };
      if (player.index !== row.index) continue;
      if (typeof player.name === 'string') name = player.name;
      if (typeof player.color === 'string') color = player.color;
    }
  }
  return { index: row.index, sessionToken: row.sessionToken, name, color };
}

function readRoomId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const roomId = (payload as { roomId?: unknown }).roomId;
  return typeof roomId === 'string' ? roomId : null;
}

function readGameId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const gameId = (payload as { gameId?: unknown }).gameId;
  return typeof gameId === 'string' && gameId !== '' ? gameId : null;
}

function readT(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const t = (payload as { t?: unknown }).t;
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
}

function readToSlot(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as { toSlot?: unknown; slot?: unknown }).toSlot;
  const slot = typeof value === 'number' ? value : (payload as { slot?: unknown }).slot;
  if (typeof slot !== 'number' || slot < 0 || slot > 7) return null;
  return slot;
}

function readSdp(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const sdp = (payload as { sdp?: unknown }).sdp;
  return typeof sdp === 'string' && sdp !== '' ? sdp : null;
}

function readCandidate(payload: unknown): RTCIceCandidateInit | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidate = (payload as { candidate?: unknown }).candidate;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const record = candidate as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown };
  if (typeof record.candidate !== 'string') return null;
  return {
    candidate: record.candidate,
    sdpMid: typeof record.sdpMid === 'string' ? record.sdpMid : null,
    sdpMLineIndex: typeof record.sdpMLineIndex === 'number' ? record.sdpMLineIndex : null,
  };
}
