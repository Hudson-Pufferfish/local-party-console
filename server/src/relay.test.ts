import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { startRelay } from './index.ts';

const ROOM_ID = /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const HOST_TOKEN = /^[0-9a-f]{32}$/;

interface TextFrame {
  type: string;
  payload?: {
    gameId?: string;
    marker?: number;
    index?: number;
    sessionToken?: string;
    players?: unknown;
  };
}

function serverSource(): string {
  const dir = path.resolve(import.meta.dirname);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => readFileSync(path.join(dir, name), 'utf8'))
    .join('\n');
}

async function postRoom(port: number): Promise<{ roomId: string; hostToken: string }> {
  const response = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST' });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ roomId: string; hostToken: string }>;
}

function connect(port: number, query: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitForText(socket: WebSocket, type: string): Promise<TextFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, 2000);
    const onMessage = (data: RawData, isBinary: boolean) => {
      if (isBinary) return;
      const frame = JSON.parse(data.toString()) as TextFrame;
      if (frame.type !== type) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(frame);
    };
    socket.on('message', onMessage);
  });
}

test('game:mount marker reaches the other client in the room', async () => {
  expect(serverSource().includes('sumo-dash')).toBe(false);

  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    expect(created.roomId).toMatch(ROOM_ID);
    expect(created.hostToken).toMatch(HOST_TOKEN);

    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const phone = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, phone);

    const mounted = waitForText(phone, 'game:mount');
    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));
    screen.send(JSON.stringify({
      type: 'game:mount',
      roomId: 'WRONG',
      payload: { gameId: 'sumo-dash', marker: 7 },
    }));

    const frame = await mounted;
    expect(frame.payload?.gameId).toBe('sumo-dash');
    expect(frame.payload?.marker).toBe(7);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('a phone that joins after the game is chosen still receives game:mount', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    sockets.push(screen);
    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));
    screen.send(JSON.stringify({
      type: 'game:mount',
      payload: { gameId: 'sumo-dash', marker: 9 },
    }));
    await settle();

    const phone = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(phone);
    const mounted = waitForText(phone, 'game:mount');
    phone.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const frame = await mounted;
    expect(frame.payload?.gameId).toBe('sumo-dash');
    expect(frame.payload?.marker).toBe(9);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

function asBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.concat(data);
}

function waitForBinary(socket: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('timed out waiting for a binary frame'));
    }, 2000);
    const onMessage = (data: RawData, isBinary: boolean) => {
      if (!isBinary) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(asBuffer(data));
    };
    socket.on('message', onMessage);
  });
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 40);
  });
}

test('an 8-byte controller frame is forwarded only to the claimed screen', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const slot0 = await connect(relay.port, `room=${created.roomId}&role=controller`);
    const other = await connect(relay.port, `room=${created.roomId}&role=controller`);
    const unjoined = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, slot0, other, unjoined);

    const claimed = waitForText(slot0, 'net:ping');
    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));
    screen.send(JSON.stringify({ type: 'net:ping', payload: { t: 1 } }));
    await claimed;

    const joined = waitForText(slot0, 'room:joined');
    slot0.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const joinFrame = await joined;
    expect(joinFrame.payload?.index).toBe(0);

    const otherJoined = waitForText(other, 'room:joined');
    other.send(JSON.stringify({ type: 'room:join', payload: { name: 'Bea' } }));
    await otherJoined;

    const otherFrames: Buffer[] = [];
    other.on('message', (data, isBinary) => {
      if (isBinary) otherFrames.push(asBuffer(data));
    });
    const screenFrames: Buffer[] = [];
    screen.on('message', (data, isBinary) => {
      if (isBinary) screenFrames.push(asBuffer(data));
    });

    const frame = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const forwarded = waitForBinary(screen);
    slot0.send(frame);
    const received = await forwarded;
    expect(received.length).toBe(9);
    expect(received[0]).toBe(0);
    expect(received.subarray(1).equals(frame)).toBe(true);

    await settle();
    expect(otherFrames).toEqual([]);

    unjoined.send(frame);
    slot0.send(Buffer.from([1, 2, 3, 4, 5, 6, 7]));
    await settle();
    expect(screenFrames).toHaveLength(1);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('a 4-byte heartbeat is prefixed with the slot', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const slot0 = await connect(relay.port, `room=${created.roomId}&role=controller`);
    const other = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, slot0, other);

    const claimed = waitForText(slot0, 'net:ping');
    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));
    screen.send(JSON.stringify({ type: 'net:ping', payload: { t: 1 } }));
    await claimed;

    const joined = waitForText(slot0, 'room:joined');
    slot0.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const joinFrame = await joined;
    expect(joinFrame.payload?.index).toBe(0);

    const otherJoined = waitForText(other, 'room:joined');
    other.send(JSON.stringify({ type: 'room:join', payload: { name: 'Bea' } }));
    await otherJoined;

    const otherFrames: Buffer[] = [];
    other.on('message', (data, isBinary) => {
      if (isBinary) otherFrames.push(asBuffer(data));
    });
    const screenFrames: Buffer[] = [];
    screen.on('message', (data, isBinary) => {
      if (isBinary) screenFrames.push(asBuffer(data));
    });

    const heart = Buffer.from([0xa5, 0x00, 0x34, 0x12]);
    const forwarded = waitForBinary(screen);
    slot0.send(heart);
    const received = await forwarded;
    expect(received.length).toBe(5);
    expect(received[0]).toBe(0);
    expect(received.subarray(1).equals(heart)).toBe(true);

    await settle();
    expect(otherFrames).toEqual([]);

    const before = screenFrames.length;
    slot0.send(Buffer.from([1, 2, 3, 4, 5, 6, 7]));
    await settle();
    expect(screenFrames).toHaveLength(before);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('rejoin keeps the slot and the broadcast omits the session token', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const observer = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const phone = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(observer, phone);

    const firstJoined = waitForText(phone, 'room:joined');
    phone.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const first = await firstJoined;
    const sessionToken = first.payload?.sessionToken;
    const index = first.payload?.index;
    expect(typeof sessionToken).toBe('string');
    expect(index).toBe(0);

    const closed = new Promise<void>((resolve) => {
      phone.once('close', () => resolve());
    });
    phone.close();
    await closed;

    const seen: string[] = [];
    observer.on('message', (data, isBinary) => {
      if (!isBinary) seen.push(data.toString());
    });

    const phone2 = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(phone2);
    const before = seen.length;
    const secondJoined = waitForText(phone2, 'room:joined');
    phone2.send(JSON.stringify({
      type: 'room:join',
      payload: { name: 'Ada', sessionToken },
    }));
    const second = await secondJoined;
    expect(second.payload?.index).toBe(index);

    await settle();
    const fresh = seen.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    for (const raw of fresh) {
      expect(raw.includes('sessionToken')).toBe(false);
      expect(raw.includes(sessionToken ?? '')).toBe(false);
    }
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});
