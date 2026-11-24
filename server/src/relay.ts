// A binary frame that arrives before viewport:claim is dropped.
// The phone send path retries the latest scratch until a send is accepted.
// This process does not queue those frames.

import type { Server, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { RoomPhase } from '@shared/types';
import {
  hostTokenMatches,
  joinRoom,
  kickSlot,
  markSlotDisconnected,
  publicPlayers,
  setRoomPhase,
  type Room,
  type RoomStore,
} from './rooms.ts';

const MAX_PAYLOAD = 65536;
const MAX_SOCKETS_PER_ADDRESS = 12;
const INPUT_FRAME = 8;
const HEARTBEAT_FRAME = 4;

interface Client {
  ws: WebSocket;
  role: 'screen' | 'controller';
  room: Room;
  slotIndex: number | null;
}

export interface Relay {
  close(): void;
}

export function attachRelay(httpServer: Server, store: RoomStore): Relay {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_PAYLOAD,
  });
  const counts = new Map<string, number>();
  const clients = new Map<Room, Set<Client>>();
  const primaries = new WeakMap<Room, Client>();
  const mounts = new WeakMap<Room, string>();

  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    const url = requestUrl(request);
    // This listener owns upgrade paths that start with /ws. Leave every other path on the socket.
    if (url === null || !url.pathname.startsWith('/ws')) return;

    const room = store.rooms.get(url.searchParams.get('room') ?? '');
    const role = url.searchParams.get('role');
    if (room === undefined || (role !== 'screen' && role !== 'controller')) {
      socket.destroy();
      return;
    }
    if (role === 'screen' && !hostTokenMatches(room, url.searchParams.get('hostToken') ?? '')) {
      socket.destroy();
      return;
    }

    const address = socket.remoteAddress ?? 'unknown';
    const open = counts.get(address) ?? 0;
    if (open >= MAX_SOCKETS_PER_ADDRESS) {
      socket.destroy();
      return;
    }
    counts.set(address, open + 1);
    socket.setNoDelay(true);

    wss.handleUpgrade(request, socket, head, (ws) => {
      const client: Client = { ws, role, room, slotIndex: null };
      const group = roomClients(clients, room);
      group.add(client);
      ws.on('error', () => {
        // A client frame can carry a session token. Do not log this error.
      });
      ws.on('close', () => {
        group.delete(client);
        if (primaries.get(room) === client) primaries.delete(room);
        if (client.slotIndex !== null) {
          markSlotDisconnected(room, client.slotIndex);
          const notice = JSON.stringify({
            type: 'room:players',
            payload: { players: publicPlayers(room) },
          });
          for (const other of group) {
            if (other.ws.readyState === WebSocket.OPEN) other.ws.send(notice);
          }
        }
        counts.set(address, Math.max(0, (counts.get(address) ?? 1) - 1));
      });
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          handleBinary(primaries, client, rawBinary(data));
          return;
        }
        handleText(clients, primaries, mounts, room, client, rawText(data));
      });
    });
  };

  httpServer.on('upgrade', onUpgrade);
  return {
    close() {
      httpServer.off('upgrade', onUpgrade);
      wss.close();
    },
  };
}

function roomClients(clients: Map<Room, Set<Client>>, room: Room): Set<Client> {
  const existing = clients.get(room);
  if (existing !== undefined) return existing;
  const created = new Set<Client>();
  clients.set(room, created);
  return created;
}

function handleText(
  clients: Map<Room, Set<Client>>,
  primaries: WeakMap<Room, Client>,
  mounts: WeakMap<Room, string>,
  room: Room,
  client: Client,
  raw: string,
): void {
  let message: { type?: unknown; payload?: unknown };
  try {
    message = JSON.parse(raw) as { type?: unknown; payload?: unknown };
  } catch {
    return;
  }
  if (typeof message.type !== 'string') return;
  const type = message.type;

  if (type === 'viewport:claim') {
    if (client.role === 'screen' && primaries.get(room) === undefined) {
      primaries.set(room, client);
    }
    return;
  }
  if (type === 'viewport:hello') {
    recordView(room, message.payload);
    return;
  }
  if (type === 'viewport:heartbeat') {
    touchView(room, message.payload);
    return;
  }
  if (type === 'room:join') {
    handleJoin(clients, mounts, room, client, message.payload);
    return;
  }
  if (type === 'room:phase') {
    if (primaries.get(room) !== client) return;
    const phase = readPhase(message.payload);
    if (phase !== null) setRoomPhase(room, phase);
    return;
  }
  if (type === 'room:kick') {
    if (primaries.get(room) !== client) return;
    handleKick(clients, room, message.payload);
    return;
  }
  if (type === 'game:mount' || type.startsWith('sumo:')) {
    if (primaries.get(room) !== client) return;
    if (type === 'game:mount') mounts.set(room, raw);
    fanOut(clients, room, client, raw);
    return;
  }
  if (type.startsWith('signal:')) {
    if (client.role !== 'screen' && client.slotIndex === null) return;
    fanOut(clients, room, client, raw);
    return;
  }
  fanOut(clients, room, client, raw);
}

function handleJoin(
  clients: Map<Room, Set<Client>>,
  mounts: WeakMap<Room, string>,
  room: Room,
  client: Client,
  payload: unknown,
): void {
  const request = readJoin(payload);
  const result = joinRoom(room, request.name, request.sessionToken);
  if (result.kind === 'full') {
    client.ws.send(JSON.stringify({ type: 'room:full', payload: {} }));
    return;
  }
  if (result.kind === 'kicked') {
    client.ws.send(JSON.stringify({ type: 'room:kicked', payload: { reason: 'kicked' } }));
    return;
  }
  const group = clients.get(room);
  if (group !== undefined) {
    for (const other of group) {
      if (other !== client && other.slotIndex === result.index) other.slotIndex = null;
    }
  }
  client.slotIndex = result.index;
  client.ws.send(JSON.stringify({
    type: 'room:joined',
    payload: {
      index: result.index,
      sessionToken: result.sessionToken,
      players: result.players,
    },
  }));
  fanOut(clients, room, client, JSON.stringify({
    type: 'room:players',
    payload: { players: result.players },
  }));
  const mounted = mounts.get(room);
  if (mounted !== undefined) client.ws.send(mounted);
}

function handleKick(clients: Map<Room, Set<Client>>, room: Room, payload: unknown): void {
  const index = readKickIndex(payload);
  if (index === null) return;
  const result = kickSlot(room, index);
  if (result.kind !== 'kicked') return;
  const group = clients.get(room);
  if (group === undefined) return;
  const kickedFrame = JSON.stringify({ type: 'room:kicked', payload: { reason: 'kicked' } });
  const playersFrame = JSON.stringify({
    type: 'room:players',
    payload: { players: result.players },
  });
  for (const member of group) {
    if (member.slotIndex === result.index) {
      member.slotIndex = null;
      if (member.ws.readyState === WebSocket.OPEN) {
        member.ws.send(kickedFrame);
        member.ws.close(1000, 'kicked');
      }
      continue;
    }
    if (member.ws.readyState === WebSocket.OPEN) member.ws.send(playersFrame);
  }
}

function readKickIndex(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const index = (payload as { index?: unknown }).index;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 7) return null;
  return index;
}

function readPhase(payload: unknown): RoomPhase | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const phase = (payload as { phase?: unknown }).phase;
  return phase === 'lobby' || phase === 'match' ? phase : null;
}

function handleBinary(primaries: WeakMap<Room, Client>, client: Client, data: Buffer): void {
  const size = data.length;
  if ((size !== INPUT_FRAME && size !== HEARTBEAT_FRAME) || client.slotIndex === null) return;
  const primary = primaries.get(client.room);
  if (primary === undefined || primary.ws.readyState !== WebSocket.OPEN) return;
  const out = Buffer.alloc(size + 1);
  out[0] = client.slotIndex;
  data.copy(out, 1);
  primary.ws.send(out);
}

function readJoin(payload: unknown): { name: string; sessionToken?: string } {
  if (typeof payload !== 'object' || payload === null) return { name: '' };
  const record = payload as { name?: unknown; sessionToken?: unknown };
  return {
    name: typeof record.name === 'string' ? record.name : '',
    sessionToken: typeof record.sessionToken === 'string' ? record.sessionToken : undefined,
  };
}

function fanOut(clients: Map<Room, Set<Client>>, room: Room, sender: Client, raw: string): void {
  const group = clients.get(room);
  if (group === undefined) return;
  for (const other of group) {
    if (other === sender || other.ws.readyState !== WebSocket.OPEN) continue;
    other.ws.send(raw);
  }
}

function recordView(room: Room, payload: unknown): void {
  const tab = readTab(payload);
  if (tab === null) return;
  room.views.set(tab.tabId, { view: tab.view, at: Date.now() });
}

function touchView(room: Room, payload: unknown): void {
  const tab = readTab(payload);
  if (tab === null) return;
  const current = room.views.get(tab.tabId);
  if (current === undefined) return;
  current.at = Date.now();
}

function readTab(payload: unknown): { tabId: string; view: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as { tabId?: unknown; view?: unknown };
  if (typeof record.tabId !== 'string') return null;
  return {
    tabId: record.tabId,
    view: typeof record.view === 'string' ? record.view : '',
  };
}

function requestUrl(request: IncomingMessage): URL | null {
  try {
    return new URL(request.url ?? '/', 'http://localhost');
  } catch {
    return null;
  }
}

function rawBinary(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data);
  return Buffer.concat(data);
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return Buffer.concat(data).toString('utf8');
}
