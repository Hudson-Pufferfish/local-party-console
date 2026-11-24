import { expect, test } from 'vitest';
import { encodeInto } from '../../shared/src/codec/input-packet.ts';
import { createSumoSimulation } from '../../games/sumo-dash/src/simulation.ts';
import { startRelay } from '../../server/src/index.ts';
import { applyHostFrame } from './apply-host-frame.ts';

const DT = 1 / 120;
const PHASE = 1;
const SLOT_STRIDE = 10;
const VX = 2;

function velocityX(slot: number): number {
  return 8 + slot * SLOT_STRIDE + VX;
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('socket failed')), { once: true });
  });
}

function waitForText(socket: WebSocket, type: string): Promise<{ payload?: { index?: number } }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, 2000);
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const frame = JSON.parse(event.data) as { type?: string; payload?: { index?: number } };
      if (frame.type !== type) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      resolve(frame);
    };
    socket.addEventListener('message', onMessage);
  });
}

function waitForBinary(socket: WebSocket): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error('timed out waiting for a binary frame'));
    }, 2000);
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      resolve(bytes);
    };
    socket.addEventListener('message', onMessage);
  });
}

test('one binary ws input changes that slot velocity', async () => {
  const relay = await startRelay();
  const sockets: WebSocket[] = [];
  try {
    const response = await fetch(`http://127.0.0.1:${relay.port}/api/rooms`, { method: 'POST' });
    expect(response.status).toBe(200);
    const created = await response.json() as { roomId: string; hostToken: string };

    const screen = new WebSocket(
      `ws://127.0.0.1:${relay.port}/ws?room=${created.roomId}&role=screen&hostToken=${created.hostToken}`,
    );
    screen.binaryType = 'arraybuffer';
    const phone = new WebSocket(
      `ws://127.0.0.1:${relay.port}/ws?room=${created.roomId}&role=controller`,
    );
    await opened(screen);
    await opened(phone);
    sockets.push(screen, phone);

    const claimed = waitForText(phone, 'net:ping');
    screen.send(JSON.stringify({ type: 'viewport:claim', payload: {} }));
    screen.send(JSON.stringify({ type: 'net:ping', payload: { t: 1 } }));
    await claimed;

    const joined = waitForText(phone, 'room:joined');
    phone.send(JSON.stringify({ type: 'room:join', payload: { name: 'Ada' } }));
    const join = await joined;
    expect(join.payload?.index).toBe(0);

    const sim = createSumoSimulation();
    sim.startMatch([0, 1]);
    let guard = 0;
    while (sim.state[PHASE] === 0 && guard < 1000) {
      sim.step(DT);
      guard += 1;
    }
    expect(sim.state[PHASE]).toBe(1);

    const before = sim.state[velocityX(0)];
    expect(before).toBe(0);
    expect(sim.state[velocityX(1)]).toBe(0);

    const packet = new Uint8Array(8);
    encodeInto(
      { seq: 1, phoneTs: 0, touchLag: 0, buttons: 0, axisX: 127, axisY: 0 },
      new DataView(packet.buffer),
    );

    const forwarded = waitForBinary(screen);
    phone.send(packet);
    const frame = await forwarded;
    expect(frame.byteLength).toBe(9);
    expect(frame[0]).toBe(0);

    applyHostFrame(sim, frame);
    sim.step(DT);

    expect(sim.state[velocityX(0)]).toBeGreaterThan(before);
    expect(sim.state[velocityX(1)]).toBe(0);
  } finally {
    for (const socket of sockets) socket.close();
    await relay.close();
  }
});
