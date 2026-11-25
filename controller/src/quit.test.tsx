import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { afterEach, expect, test, vi } from 'vitest';
import { OrientationToggle } from './orientation-toggle.tsx';
import { connectPhone, storedSeq, storedToken } from './peer.ts';
import { QuitButton, canQuitController, isOrientationLocked } from './quit-button.tsx';
import { sendAxes } from './send-input.ts';

class MockSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  binaryType = 'arraybuffer';
  readyState = MockSocket.OPEN;
  sentTexts: string[] = [];
  sentBuffers: ArrayBuffer[] = [];

  constructor(_url: string) {
    super();
    sockets.push(this);
  }

  send(data: string | ArrayBuffer): void {
    if (typeof data === 'string') this.sentTexts.push(data);
    else this.sentBuffers.push(data);
  }

  close(): void {
    this.readyState = MockSocket.CLOSED;
  }
}

const sockets: MockSocket[] = [];

afterEach(() => {
  sockets.length = 0;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'window');
});

test('when joined before host starts, Quit button is enabled and leaving resets session and unlocks orientation', () => {
  // Unjoined: Quit is hidden and orientation is unlocked
  expect(canQuitController(false, 'lobby')).toBe(false);
  expect(isOrientationLocked(false, false)).toBe(false);
  const unjoinedHtml = renderToString(() => (
    <>
      <QuitButton visible={canQuitController(false, 'lobby')} onQuit={() => {}} />
      <OrientationToggle value="portrait" disabled={isOrientationLocked(false, false)} onChange={() => {}} />
    </>
  ));
  expect(unjoinedHtml).not.toContain('quit-btn');
  expect(unjoinedHtml).not.toContain('disabled');

  // Joined in lobby (both before game selection and with game selected pre-start): Quit enabled, orientation locked
  expect(canQuitController(true, 'lobby')).toBe(true);
  expect(isOrientationLocked(true, false)).toBe(true);
  expect(isOrientationLocked(true, true)).toBe(true);
  const joinedPreStartHtml = renderToString(() => (
    <>
      <QuitButton visible={canQuitController(true, 'lobby')} onQuit={() => {}} />
      <OrientationToggle value="portrait" disabled={isOrientationLocked(true, false)} onChange={() => {}} />
    </>
  ));
  expect(joinedPreStartHtml).toContain('class="quit-btn"');
  expect(joinedPreStartHtml).toContain('>QUIT<');
  expect(joinedPreStartHtml).not.toMatch(/class="quit-btn"[^>]*\bdisabled\b/);
  expect(joinedPreStartHtml.match(/class="orient-btn"[^>]*\bdisabled\b/g)).toHaveLength(3);

  // Real peer.leave() sends room:leave, clears stored session/seq, stops input sending, and keeps socket open to rejoin
  const memory = new Map<string, string>([
    ['party-session-ABCD', 'tok-1'],
    ['party-seq-ABCD', '7'],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  });
  vi.stubGlobal('location', { host: '10.0.0.72:8443' });
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  const previousSocket = globalThis.WebSocket;
  const previousPeer = globalThis.RTCPeerConnection;
  globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
  globalThis.RTCPeerConnection = class {
    constructor() {
      throw new Error('no pc');
    }
  } as unknown as typeof RTCPeerConnection;

  const phases: string[] = [];
  try {
    const link = connectPhone('ABCD', {
      onJoined(next) {
        phases.push(next.phase);
      },
      onFull() {},
      onMount() {},
      onPong() {},
      onLink() {},
    });
    const socket = sockets[0];
    if (socket === undefined) throw new Error('missing socket');
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        type: 'room:joined',
        payload: {
          index: 0,
          sessionToken: 'tok-1',
          phase: 'lobby',
          players: [{ index: 0, name: 'Ada', color: '#FF4D00' }],
        },
      }),
    }));

    link.leave();
    sendAxes(1, 0, performance.now());

    expect(phases).toEqual(['lobby']);
    expect(socket.sentTexts).toContain(JSON.stringify({ type: 'room:leave', payload: {} }));
    expect(socket.readyState).toBe(MockSocket.OPEN);
    expect(storedToken('ABCD')).toBeNull();
    expect(storedSeq('ABCD')).toBe(-1);
    expect(socket.sentBuffers).toEqual([]);
    link.close();
  } finally {
    globalThis.WebSocket = previousSocket;
    globalThis.RTCPeerConnection = previousPeer;
  }
});

test('when match has started, Quit button is absent/disabled and controller styles stay compact Neo-Brutalist', () => {
  expect(canQuitController(true, 'match')).toBe(false);
  expect(isOrientationLocked(true, true)).toBe(true);

  const inMatchHtml = renderToString(() => (
    <>
      <QuitButton visible={canQuitController(true, 'match')} onQuit={() => {}} />
      <OrientationToggle value="landscape-left" disabled={isOrientationLocked(true, true)} onChange={() => {}} />
    </>
  ));
  expect(inMatchHtml).not.toContain('quit-btn');
  expect(inMatchHtml).not.toContain('>QUIT<');
  expect(inMatchHtml.match(/class="orient-btn"[^>]*\bdisabled\b/g)).toHaveLength(3);

  const disabledHtml = renderToString(() => (
    <QuitButton visible={true} disabled={true} onQuit={() => {}} />
  ));
  expect(disabledHtml).toMatch(/class="quit-btn"[^>]*\bdisabled\b/);

  const controllerCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles.css'), 'utf8');
  const quitBlock = controllerCss.match(/\.quit-btn\s*\{[^}]*\}/)?.[0] ?? '';
  expect(quitBlock).toContain('border: 2.5px solid');
  expect(quitBlock).toContain('box-shadow: 0px 3px 0px #111111');
  expect(quitBlock).not.toContain('backdrop-filter');
});
