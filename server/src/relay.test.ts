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

test('kicking a LIVE or AWAY player in lobby removes them, closes LIVE socket after room:kicked, frees slots, and refuses in-match kicks', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const ada = await connect(relay.port, `room=${created.roomId}&role=controller`);
    const bea = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, ada, bea);

    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));

    const adaJoined = waitForText(ada, 'room:joined');
    const adaRoster = waitForText(screen, 'room:players');
    ada.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const adaFrame = await adaJoined;
    await adaRoster;
    expect(adaFrame.payload?.index).toBe(0);
    const adaToken = adaFrame.payload?.sessionToken;
    expect(typeof adaToken).toBe('string');

    const beaJoined = waitForText(bea, 'room:joined');
    const beaRoster = waitForText(screen, 'room:players');
    bea.send(JSON.stringify({ type: 'room:join', payload: { name: 'Bea' } }));
    const beaFrame = await beaJoined;
    await beaRoster;
    expect(beaFrame.payload?.index).toBe(1);

    const screenUpdates: Array<Array<{ index: number; name: string; connected: boolean }>> = [];
    screen.on('message', (data, isBinary) => {
      if (isBinary) return;
      const frame = JSON.parse(data.toString()) as {
        type: string;
        payload?: { players?: Array<{ index: number; name: string; connected: boolean }> };
      };
      if (frame.type === 'room:players' && Array.isArray(frame.payload?.players)) {
        screenUpdates.push(frame.payload.players);
      }
    });

    // Refuses kicking an unknown/empty slot
    const beforeRefused = screenUpdates.length;
    screen.send(JSON.stringify({ type: 'room:kick', payload: { index: 7 } }));
    await settle();
    expect(screenUpdates.length).toBe(beforeRefused);

    // Refuses kicking a LIVE player during an active match
    screen.send(JSON.stringify({ type: 'room:phase', payload: { phase: 'match' } }));
    await settle();
    const beforeMatchKick = screenUpdates.length;
    screen.send(JSON.stringify({ type: 'room:kick', payload: { index: 0 } }));
    await settle();
    expect(screenUpdates.length).toBe(beforeMatchKick);

    // Returning to lobby permits kicking LIVE Ada: sends room:kicked, closes socket, updates roster
    screen.send(JSON.stringify({ type: 'room:phase', payload: { phase: 'lobby' } }));
    const adaKicked = waitForText(ada, 'room:kicked');
    const adaClosed = new Promise<void>((resolve) => {
      ada.once('close', () => resolve());
    });
    const screenAfterLiveKick = waitForText(screen, 'room:players');
    const beaAfterLiveKick = waitForText(bea, 'room:players');
    screen.send(JSON.stringify({ type: 'room:kick', payload: { index: 0 } }));
    const [, , screenLiveFrame, beaLiveFrame] = await Promise.all([
      adaKicked,
      adaClosed,
      screenAfterLiveKick,
      beaAfterLiveKick,
    ]);
    expect(screenLiveFrame.payload?.players).toEqual([
      expect.objectContaining({ index: 1, name: 'BEA', connected: true }),
    ]);
    expect(beaLiveFrame.payload?.players).toEqual([
      expect.objectContaining({ index: 1, name: 'BEA', connected: true }),
    ]);

    // Revoked token from kicked LIVE player is rejected
    const staleAda = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(staleAda);
    const staleRejected = waitForText(staleAda, 'room:kicked');
    staleAda.send(JSON.stringify({
      type: 'room:join',
      payload: { name: 'Ada', sessionToken: adaToken },
    }));
    await staleRejected;

    // Disconnect Bea so slot 1 becomes AWAY, then kick AWAY Bea in lobby
    const awayUpdate = waitForText(screen, 'room:players');
    bea.close();
    await awayUpdate;

    const screenAfterAwayKick = waitForText(screen, 'room:players');
    screen.send(JSON.stringify({ type: 'room:kick', payload: { index: 1 } }));
    const screenAwayFrame = await screenAfterAwayKick;
    expect(screenAwayFrame.payload?.players).toEqual([]);

    // Slot 0 is freed and reused by the next joining player
    const cy = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(cy);
    const cyJoined = waitForText(cy, 'room:joined');
    cy.send(JSON.stringify({ type: 'room:join', payload: { name: 'Cy' } }));
    const cyFrame = await cyJoined;
    expect(cyFrame.payload?.index).toBe(0);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('a kicked phone token is rejected with room:kicked instead of silently rejoining', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const phone = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, phone);

    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));
    const joined = waitForText(phone, 'room:joined');
    const joinRoster = waitForText(screen, 'room:players');
    phone.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const first = await joined;
    await joinRoster;
    const oldToken = first.payload?.sessionToken;
    expect(typeof oldToken).toBe('string');

    const awayNotice = waitForText(screen, 'room:players');
    phone.close();
    await awayNotice;

    const kickedNotice = waitForText(screen, 'room:players');
    screen.send(JSON.stringify({ type: 'room:kick', payload: { index: 0 } }));
    const emptyRoster = await kickedNotice;
    expect(emptyRoster.payload?.players).toEqual([]);

    // Stale reconnect with kicked token is rejected cleanly and does not add a player
    const returning = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(returning);
    const rejected = waitForText(returning, 'room:kicked');
    returning.send(JSON.stringify({
      type: 'room:join',
      payload: { name: 'Ada', sessionToken: oldToken },
    }));
    await rejected;

    // Explicit fresh join without the revoked token succeeds
    const freshJoined = waitForText(returning, 'room:joined');
    returning.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const fresh = await freshJoined;
    expect(fresh.payload?.index).toBe(0);
    expect(fresh.payload?.sessionToken).not.toBe(oldToken);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('room:phase lobby fans out to controllers and clears cached game:mount for later joiners', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const phone = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, phone);

    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));
    const mounted = waitForText(phone, 'game:mount');
    screen.send(JSON.stringify({ type: 'game:mount', payload: { gameId: 'sumo-dash' } }));
    await mounted;

    const returned = waitForText(phone, 'room:phase');
    screen.send(JSON.stringify({ type: 'room:phase', payload: { phase: 'lobby' } }));
    const phaseFrame = await returned;
    expect((phaseFrame.payload as { phase?: string } | undefined)?.phase).toBe('lobby');

    const late = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(late);
    const lateMounts: string[] = [];
    late.on('message', (data, isBinary) => {
      if (isBinary) return;
      const frame = JSON.parse(data.toString()) as { type?: string };
      if (frame.type === 'game:mount') lateMounts.push(frame.type);
    });
    const lateJoined = waitForText(late, 'room:joined');
    late.send(JSON.stringify({ type: 'room:join', payload: { name: 'Bea' } }));
    await lateJoined;
    await settle();
    expect(lateMounts).toEqual([]);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('primary re-claim over an open old screen or after a mid-match disconnect resets phase to lobby and permits kicking LIVE and AWAY players', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen1 = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const ada = await connect(relay.port, `room=${created.roomId}&role=controller`);
    const bea = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen1, ada, bea);

    screen1.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));

    const adaJoined = waitForText(ada, 'room:joined');
    const adaRoster = waitForText(screen1, 'room:players');
    ada.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    await Promise.all([adaJoined, adaRoster]);

    const beaJoined = waitForText(bea, 'room:joined');
    const beaRoster = waitForText(screen1, 'room:players');
    bea.send(JSON.stringify({ type: 'room:join', payload: { name: 'Bea' } }));
    await Promise.all([beaJoined, beaRoster]);

    // Enter match phase, then Bea disconnects (AWAY)
    const matchPhase = waitForText(ada, 'room:phase');
    screen1.send(JSON.stringify({ type: 'room:phase', payload: { phase: 'match' } }));
    await matchPhase;

    const beaAway = waitForText(screen1, 'room:players');
    bea.close();
    await beaAway;

    // Overlap race (HMR / fast reload / new primary tab): screen2 claims BEFORE screen1 closes
    const screen2 = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    sockets.push(screen2);
    const adaReturnedLobby = waitForText(ada, 'room:phase');
    screen2.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));
    const resetFrame = await adaReturnedLobby;
    expect((resetFrame.payload as { phase?: string } | undefined)?.phase).toBe('lobby');

    // Old screen closes after screen2 already claimed; screen2 must stay primary
    const screen1Closed = new Promise<void>((resolve) => {
      screen1.once('close', () => resolve());
    });
    screen1.close();
    await screen1Closed;
    await settle();

    // screen2 kicks AWAY Bea (slot 1)
    const afterAwayKick = waitForText(screen2, 'room:players');
    screen2.send(JSON.stringify({ type: 'room:kick', payload: { index: 1 } }));
    const awayKickFrame = await afterAwayKick;
    expect(awayKickFrame.payload?.players).toEqual([
      expect.objectContaining({ index: 0, name: 'ADA', connected: true }),
    ]);

    // screen2 kicks LIVE Ada (slot 0)
    const adaKicked = waitForText(ada, 'room:kicked');
    const afterLiveKick = waitForText(screen2, 'room:players');
    screen2.send(JSON.stringify({ type: 'room:kick', payload: { index: 0 } }));
    const [, liveKickFrame] = await Promise.all([adaKicked, afterLiveKick]);
    expect(liveKickFrame.payload?.players).toEqual([]);

    // Disconnect-first mid-match reload: screen2 starts a match and closes before screen3 connects
    const cy = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(cy);
    const cyJoined = waitForText(cy, 'room:joined');
    cy.send(JSON.stringify({ type: 'room:join', payload: { name: 'Cy' } }));
    await cyJoined;

    const cyMatch = waitForText(cy, 'room:phase');
    screen2.send(JSON.stringify({ type: 'room:phase', payload: { phase: 'match' } }));
    await cyMatch;

    const cyLobby = waitForText(cy, 'room:phase');
    screen2.close();
    const cyLobbyFrame = await cyLobby;
    expect((cyLobbyFrame.payload as { phase?: string } | undefined)?.phase).toBe('lobby');

    const cyClosed = new Promise<void>((resolve) => {
      cy.once('close', () => resolve());
    });
    cy.close();
    await cyClosed;

    const screen3 = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    sockets.push(screen3);
    screen3.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));
    const afterReconnectKick = waitForText(screen3, 'room:players');
    screen3.send(JSON.stringify({ type: 'room:kick', payload: { index: 0 } }));
    const reconnectKickFrame = await afterReconnectKick;
    expect(reconnectKickFrame.payload?.players).toEqual([]);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('room:leave frees the slot in lobby, broadcasts room:players, allows instant rejoin, and is ignored during match', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const ada = await connect(relay.port, `room=${created.roomId}&role=controller`);
    const bea = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, ada, bea);

    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));

    const adaJoined = waitForText(ada, 'room:joined');
    const adaRoster = waitForText(screen, 'room:players');
    ada.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const [adaFrame] = await Promise.all([adaJoined, adaRoster]);
    expect(adaFrame.payload?.index).toBe(0);
    expect((adaFrame.payload as { phase?: string } | undefined)?.phase).toBe('lobby');

    const beaJoined = waitForText(bea, 'room:joined');
    const beaRoster = waitForText(screen, 'room:players');
    bea.send(JSON.stringify({ type: 'room:join', payload: { name: 'Bea' } }));
    const [beaFrame] = await Promise.all([beaJoined, beaRoster]);
    const beaToken = beaFrame.payload?.sessionToken;

    // Ada leaves pre-start: slot 0 is freed, screen and Bea receive updated roster, Ada stays connected
    const screenAfterLeave = waitForText(screen, 'room:players');
    const beaAfterLeave = waitForText(bea, 'room:players');
    ada.send(JSON.stringify({ type: 'room:leave', payload: {} }));
    const [screenLeaveFrame, beaLeaveFrame] = await Promise.all([screenAfterLeave, beaAfterLeave]);
    expect(screenLeaveFrame.payload?.players).toEqual([
      expect.objectContaining({ index: 1, name: 'BEA', connected: true }),
    ]);
    expect(beaLeaveFrame.payload?.players).toEqual([
      expect.objectContaining({ index: 1, name: 'BEA', connected: true }),
    ]);

    // Ada rejoins on the same open socket and gets slot 0 back cleanly
    const adaRejoined = waitForText(ada, 'room:joined');
    const screenAfterRejoin = waitForText(screen, 'room:players');
    ada.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const [rejoinFrame, rejoinRoster] = await Promise.all([adaRejoined, screenAfterRejoin]);
    expect(rejoinFrame.payload?.index).toBe(0);
    expect((rejoinFrame.payload as { phase?: string } | undefined)?.phase).toBe('lobby');
    expect(rejoinRoster.payload?.players).toHaveLength(2);

    // Once host starts the match, room:leave is refused and does not modify the roster
    const matchPhase = waitForText(ada, 'room:phase');
    screen.send(JSON.stringify({ type: 'room:phase', payload: { phase: 'match' } }));
    await matchPhase;

    const midMatchUpdates: unknown[] = [];
    screen.on('message', (data, isBinary) => {
      if (isBinary) return;
      const frame = JSON.parse(data.toString()) as { type: string; payload?: unknown };
      if (frame.type === 'room:players') midMatchUpdates.push(frame.payload);
    });
    ada.send(JSON.stringify({ type: 'room:leave', payload: {} }));
    await settle();
    expect(midMatchUpdates).toEqual([]);

    // A returning controller rejoining mid-match receives phase: 'match' in room:joined
    const beaRejoin = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(beaRejoin);
    const beaRejoined = waitForText(beaRejoin, 'room:joined');
    beaRejoin.send(JSON.stringify({
      type: 'room:join',
      payload: { name: 'Bea', sessionToken: beaToken },
    }));
    const beaRejoinFrame = await beaRejoined;
    expect((beaRejoinFrame.payload as { phase?: string } | undefined)?.phase).toBe('match');
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('room:join normalizes names to uppercase and rejects empty or duplicate names with room:rejected', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const first = await connect(relay.port, `room=${created.roomId}&role=controller`);
    const second = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, first, second);

    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));

    // Empty and whitespace-only inputs are rejected with EMPTY
    const emptyStrRejected = waitForText(first, 'room:rejected');
    first.send(JSON.stringify({ type: 'room:join', payload: { name: '' } }));
    expect(((await emptyStrRejected).payload as { reason?: string } | undefined)?.reason).toBe('EMPTY');

    const whitespaceRejected = waitForText(first, 'room:rejected');
    first.send(JSON.stringify({ type: 'room:join', payload: { name: '   ' } }));
    expect(((await whitespaceRejected).payload as { reason?: string } | undefined)?.reason).toBe('EMPTY');

    // First player joins as ALICE
    const firstJoined = waitForText(first, 'room:joined');
    const firstRoster = waitForText(screen, 'room:players');
    first.send(JSON.stringify({ type: 'room:join', payload: { name: '  ALICE  ' } }));
    const [joinFrame, rosterFrame] = await Promise.all([firstJoined, firstRoster]);
    expect(joinFrame.payload?.index).toBe(0);
    expect(rosterFrame.payload?.players).toEqual([
      expect.objectContaining({ index: 0, name: 'ALICE', connected: true }),
    ]);

    // Exact match and case-insensitive duplicates are rejected with DUPLICATE
    for (const candidate of ['ALICE', 'alice', 'Alice']) {
      const dupRejected = waitForText(second, 'room:rejected');
      second.send(JSON.stringify({ type: 'room:join', payload: { name: candidate } }));
      expect(((await dupRejected).payload as { reason?: string } | undefined)?.reason).toBe('DUPLICATE');
    }

    // Socket stays open so the rejected player can pick a unique name and join
    const secondJoined = waitForText(second, 'room:joined');
    const secondRoster = waitForText(screen, 'room:players');
    second.send(JSON.stringify({ type: 'room:join', payload: { name: 'bob' } }));
    const [secondFrame, updatedRoster] = await Promise.all([secondJoined, secondRoster]);
    expect(secondFrame.payload?.index).toBe(1);
    expect(updatedRoster.payload?.players).toEqual([
      expect.objectContaining({ index: 0, name: 'ALICE', connected: true }),
      expect.objectContaining({ index: 1, name: 'BOB', connected: true }),
    ]);

    // After first player leaves, ALICE is free to take again
    const afterLeave = waitForText(screen, 'room:players');
    first.send(JSON.stringify({ type: 'room:leave', payload: {} }));
    await afterLeave;

    const third = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(third);
    const thirdJoined = waitForText(third, 'room:joined');
    third.send(JSON.stringify({ type: 'room:join', payload: { name: 'alice' } }));
    const thirdFrame = await thirdJoined;
    expect(thirdFrame.payload?.index).toBe(0);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('game:unmount from primary clears cached game:mount and fans out to room clients, while non-primary unmount is ignored', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const phone = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, phone);

    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));
    const mounted = waitForText(phone, 'game:mount');
    screen.send(JSON.stringify({ type: 'game:mount', payload: { gameId: 'sumo-dash' } }));
    await mounted;

    // Non-primary client cannot unmount the room game
    const screenFrames: string[] = [];
    screen.on('message', (data, isBinary) => {
      if (!isBinary) screenFrames.push(data.toString());
    });
    phone.send(JSON.stringify({ type: 'game:unmount', payload: {} }));
    await settle();
    expect(screenFrames.some((raw) => raw.includes('"game:unmount"'))).toBe(false);

    // Primary game:unmount fans out to existing clients and clears cached mount
    const unmounted = waitForText(phone, 'game:unmount');
    screen.send(JSON.stringify({ type: 'game:unmount', payload: {} }));
    const unmountFrame = await unmounted;
    expect(unmountFrame.type).toBe('game:unmount');

    // Late joiner after game:unmount does not receive stale game:mount
    const late = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(late);
    const lateMounts: string[] = [];
    late.on('message', (data, isBinary) => {
      if (isBinary) return;
      const frame = JSON.parse(data.toString()) as { type?: string };
      if (frame.type === 'game:mount') lateMounts.push(frame.type);
    });
    const lateJoined = waitForText(late, 'room:joined');
    late.send(JSON.stringify({ type: 'room:join', payload: { name: 'Bea' } }));
    await lateJoined;
    await settle();
    expect(lateMounts).toEqual([]);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('mid-match join rejects strangers and unknown tokens with MATCH_IN_PROGRESS while returning players rejoin and broadcast connected: true', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const ada = await connect(relay.port, `room=${created.roomId}&role=controller`);
    const bea = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, ada, bea);

    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));

    const adaJoined = waitForText(ada, 'room:joined');
    const adaRoster = waitForText(screen, 'room:players');
    ada.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    await Promise.all([adaJoined, adaRoster]);

    const beaJoined = waitForText(bea, 'room:joined');
    const beaRoster = waitForText(screen, 'room:players');
    bea.send(JSON.stringify({ type: 'room:join', payload: { name: 'Bea' } }));
    const [beaFrame] = await Promise.all([beaJoined, beaRoster]);
    const beaToken = beaFrame.payload?.sessionToken;
    expect(typeof beaToken).toBe('string');

    // Mount game and start match
    const adaMounted = waitForText(ada, 'game:mount');
    const adaMatch = waitForText(ada, 'room:phase');
    screen.send(JSON.stringify({ type: 'game:mount', payload: { gameId: 'sumo-dash' } }));
    screen.send(JSON.stringify({ type: 'room:phase', payload: { phase: 'match' } }));
    await Promise.all([adaMounted, adaMatch]);

    const rosterUpdates: unknown[] = [];
    screen.on('message', (data, isBinary) => {
      if (isBinary) return;
      const frame = JSON.parse(data.toString()) as { type: string; payload?: unknown };
      if (frame.type === 'room:players') rosterUpdates.push(frame.payload);
    });

    // Brand new stranger is rejected with MATCH_IN_PROGRESS
    const stranger = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(stranger);
    const strangerRejected = waitForText(stranger, 'room:rejected');
    stranger.send(JSON.stringify({ type: 'room:join', payload: { name: 'Cy' } }));
    expect(((await strangerRejected).payload as { reason?: string } | undefined)?.reason).toBe('MATCH_IN_PROGRESS');

    // Stranger with an unknown session token is also rejected with MATCH_IN_PROGRESS
    const bogusRejected = waitForText(stranger, 'room:rejected');
    stranger.send(JSON.stringify({
      type: 'room:join',
      payload: { name: 'Cy', sessionToken: 'deadbeef00000000deadbeef00000000' },
    }));
    expect(((await bogusRejected).payload as { reason?: string } | undefined)?.reason).toBe('MATCH_IN_PROGRESS');

    // Stranger with empty name mid-match still gets MATCH_IN_PROGRESS
    const emptyStrangerRejected = waitForText(stranger, 'room:rejected');
    stranger.send(JSON.stringify({ type: 'room:join', payload: { name: '' } }));
    expect(((await emptyStrangerRejected).payload as { reason?: string } | undefined)?.reason).toBe('MATCH_IN_PROGRESS');

    await settle();
    expect(rosterUpdates).toEqual([]);

    // Returning player Bea disconnects -> screen sees connected: false
    const awayUpdate = waitForText(screen, 'room:players');
    bea.close();
    const awayFrame = await awayUpdate;
    expect(awayFrame.payload?.players).toEqual([
      expect.objectContaining({ index: 0, name: 'ADA', connected: true }),
      expect.objectContaining({ index: 1, name: 'BEA', connected: false }),
    ]);

    // Returning player Bea reconnects with valid token -> rejoins slot 1, gets game:mount, broadcasts connected: true
    const bea2 = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(bea2);
    const bea2Joined = waitForText(bea2, 'room:joined');
    const bea2Mounted = waitForText(bea2, 'game:mount');
    const liveUpdate = waitForText(screen, 'room:players');
    bea2.send(JSON.stringify({
      type: 'room:join',
      payload: { name: 'Bea', sessionToken: beaToken },
    }));
    const [rejoinedFrame, mountedFrame, liveFrame] = await Promise.all([
      bea2Joined,
      bea2Mounted,
      liveUpdate,
    ]);
    expect(rejoinedFrame.payload?.index).toBe(1);
    expect((rejoinedFrame.payload as { phase?: string } | undefined)?.phase).toBe('match');
    expect(mountedFrame.payload?.gameId).toBe('sumo-dash');
    expect(liveFrame.payload?.players).toEqual([
      expect.objectContaining({ index: 0, name: 'ADA', connected: true }),
      expect.objectContaining({ index: 1, name: 'BEA', connected: true }),
    ]);

    // Returning player rejoining with valid token and empty name preserves existing slot name
    const bea2Away = waitForText(screen, 'room:players');
    bea2.close();
    await bea2Away;

    const bea3 = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(bea3);
    const bea3Joined = waitForText(bea3, 'room:joined');
    const bea3Live = waitForText(screen, 'room:players');
    bea3.send(JSON.stringify({
      type: 'room:join',
      payload: { name: '', sessionToken: beaToken },
    }));
    const [bea3Frame, bea3Roster] = await Promise.all([bea3Joined, bea3Live]);
    expect(bea3Frame.payload?.index).toBe(1);
    expect(bea3Roster.payload?.players).toEqual([
      expect.objectContaining({ index: 0, name: 'ADA', connected: true }),
      expect.objectContaining({ index: 1, name: 'BEA', connected: true }),
    ]);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('players who were AWAY at match start or new joiners are rejected mid-match while active match players can rejoin and lobby restores joining', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const playerA = await connect(relay.port, `room=${created.roomId}&role=controller`);
    const playerB = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, playerA, playerB);

    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));

    // Player A joins in lobby (LIVE)
    const aJoined = waitForText(playerA, 'room:joined');
    const aRoster = waitForText(screen, 'room:players');
    playerA.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const [aFrame] = await Promise.all([aJoined, aRoster]);
    const aToken = aFrame.payload?.sessionToken;
    expect(aFrame.payload?.index).toBe(0);
    expect(typeof aToken).toBe('string');

    // Player B joins in lobby, then disconnects (AWAY) before match starts
    const bJoined = waitForText(playerB, 'room:joined');
    const bRoster = waitForText(screen, 'room:players');
    playerB.send(JSON.stringify({ type: 'room:join', payload: { name: 'Bea' } }));
    const [bFrame] = await Promise.all([bJoined, bRoster]);
    const bToken = bFrame.payload?.sessionToken;
    expect(bFrame.payload?.index).toBe(1);
    expect(typeof bToken).toBe('string');

    const bAwayNotice = waitForText(screen, 'room:players');
    playerB.close();
    await bAwayNotice;

    // Host starts match (only Player A is LIVE at match start)
    const matchPhase = waitForText(playerA, 'room:phase');
    screen.send(JSON.stringify({ type: 'room:phase', payload: { phase: 'match' } }));
    await matchPhase;

    // Player B (AWAY at match start) attempts to rejoin mid-match -> rejected with MATCH_IN_PROGRESS
    const playerBRetry = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(playerBRetry);
    const bRejected = waitForText(playerBRetry, 'room:rejected');
    playerBRetry.send(JSON.stringify({
      type: 'room:join',
      payload: { name: 'Bea', sessionToken: bToken },
    }));
    expect(((await bRejected).payload as { reason?: string } | undefined)?.reason).toBe('MATCH_IN_PROGRESS');

    // Brand-new Player C attempts to join mid-match -> rejected with MATCH_IN_PROGRESS
    const playerC = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(playerC);
    const cRejected = waitForText(playerC, 'room:rejected');
    playerC.send(JSON.stringify({ type: 'room:join', payload: { name: 'Cy' } }));
    expect(((await cRejected).payload as { reason?: string } | undefined)?.reason).toBe('MATCH_IN_PROGRESS');

    // Player A (LIVE at match start) disconnects mid-match and rejoins -> succeeds
    const aAwayNotice = waitForText(screen, 'room:players');
    playerA.close();
    await aAwayNotice;

    const playerARejoin = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(playerARejoin);
    const aRejoined = waitForText(playerARejoin, 'room:joined');
    const aRejoinRoster = waitForText(screen, 'room:players');
    playerARejoin.send(JSON.stringify({
      type: 'room:join',
      payload: { name: 'Ada', sessionToken: aToken },
    }));
    const [aRejoinFrame, aRejoinRosterFrame] = await Promise.all([aRejoined, aRejoinRoster]);
    expect(aRejoinFrame.payload?.index).toBe(0);
    expect((aRejoinFrame.payload as { phase?: string } | undefined)?.phase).toBe('match');
    expect(aRejoinRosterFrame.payload?.players).toEqual([
      expect.objectContaining({ index: 0, name: 'ADA', connected: true }),
      expect.objectContaining({ index: 1, name: 'BEA', connected: false }),
    ]);

    // Host returns to lobby -> Player B can rejoin in the lobby normally
    const lobbyPhase = waitForText(playerARejoin, 'room:phase');
    screen.send(JSON.stringify({ type: 'room:phase', payload: { phase: 'lobby' } }));
    await lobbyPhase;

    const bLobbyJoined = waitForText(playerBRetry, 'room:joined');
    const bLobbyRoster = waitForText(screen, 'room:players');
    playerBRetry.send(JSON.stringify({
      type: 'room:join',
      payload: { name: 'Bea', sessionToken: bToken },
    }));
    const [bLobbyFrame, bLobbyRosterFrame] = await Promise.all([bLobbyJoined, bLobbyRoster]);
    expect(bLobbyFrame.payload?.index).toBe(1);
    expect((bLobbyFrame.payload as { phase?: string } | undefined)?.phase).toBe('lobby');
    expect(bLobbyRosterFrame.payload?.players).toEqual([
      expect.objectContaining({ index: 0, name: 'ADA', connected: true }),
      expect.objectContaining({ index: 1, name: 'BEA', connected: true }),
    ]);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});

test('relay forwards game control messages from primary screen to controllers for all games', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const created = await postRoom(relay.port);
    const screen = await connect(
      relay.port,
      `room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    const phone = await connect(relay.port, `room=${created.roomId}&role=controller`);
    sockets.push(screen, phone);

    screen.send(JSON.stringify({ type: 'viewport:claim', payload: { role: 'primary', view: 'holistic' } }));
    phone.send(JSON.stringify({ type: 'room:join', payload: { name: 'ADA' } }));
    await settle();

    const phoneMessages: any[] = [];
    phone.on('message', (data: RawData) => {
      phoneMessages.push(JSON.parse(data.toString()));
    });

    // Send various game control messages from primary screen:
    screen.send(JSON.stringify({ type: 'sumo:round_start', payload: { round: 1 } }));
    screen.send(JSON.stringify({ type: 'bomb:holder', payload: { holderIndex: 0 } }));
    screen.send(JSON.stringify({ type: 'color:boost', payload: { playerIndex: 0 } }));
    screen.send(JSON.stringify({ type: 'cyber:wave_start', payload: { wave: 1 } }));

    await settle();

    const forwardedTypes = phoneMessages.map((m) => m.type);
    expect(forwardedTypes).toContain('sumo:round_start');
    expect(forwardedTypes).toContain('bomb:holder');
    expect(forwardedTypes).toContain('color:boost');
    expect(forwardedTypes).toContain('cyber:wave_start');
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});
