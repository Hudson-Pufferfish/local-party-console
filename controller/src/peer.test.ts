import { afterEach, expect, test, vi } from 'vitest';
import { connectPhone, joinNotice, storedSeq, storedToken } from './peer.ts';
import { sendAxes } from './send-input.ts';

class IdleSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  binaryType = 'blob';
  readyState = IdleSocket.CONNECTING;
  constructor(_url: string) {
    super();
  }
  send(_data: string): void {}
  close(): void {
    this.readyState = IdleSocket.CLOSED;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'window');
});

test('a socket that never opens reports the link down', () => {
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  vi.stubGlobal('location', { host: '10.0.0.72:8443' });
  vi.useFakeTimers();
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = IdleSocket as unknown as typeof WebSocket;
  const seen: boolean[] = [];
  try {
    const link = connectPhone('ABCD', {
      onJoined() {},
      onFull() {},
      onMount() {},
      onPong() {},
      onLink(up) {
        seen.push(up);
      },
    });
    vi.advanceTimersByTime(2000);
    link.close();
  } finally {
    globalThis.WebSocket = previous;
  }
  expect(seen).toContain(false);
});

test('a join while the socket is still connecting is queued and marked sent', () => {
  expect(joinNotice('queued')).toBe('JOIN // SENT');
  expect(joinNotice('closed')).toBe('LINK // DOWN');
  expect(joinNotice('missing')).toBe('LINK // DOWN');
  expect(joinNotice('open')).toBe('JOIN // SENT');
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  vi.stubGlobal('location', { host: '10.0.0.72:8443' });
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = IdleSocket as unknown as typeof WebSocket;
  try {
    const link = connectPhone('ABCD', {
      onJoined() {},
      onFull() {},
      onMount() {},
      onPong() {},
      onLink() {},
    });
    expect(link.sendText({ type: 'room:join', payload: { name: 'Ada' } })).toBe('queued');
    link.close();
  } finally {
    globalThis.WebSocket = previous;
  }
});

test('room:joined updates the phone even when the data channel cannot open', () => {
  const memory = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  });
  vi.stubGlobal('location', { host: '10.0.0.72:8443' });
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  openSockets.length = 0;
  const previousSocket = globalThis.WebSocket;
  const previousPeer = globalThis.RTCPeerConnection;
  globalThis.WebSocket = OpenSocket as unknown as typeof WebSocket;
  globalThis.RTCPeerConnection = class {
    constructor() {
      throw new Error('no pc');
    }
  } as unknown as typeof RTCPeerConnection;
  const seen: number[] = [];
  try {
    const link = connectPhone('ABCD', {
      onJoined(slot) {
        seen.push(slot.index);
      },
      onFull() {},
      onMount() {},
      onPong() {},
      onLink() {},
    });
    const socket = openSockets[0];
    if (socket === undefined) throw new Error('missing socket');
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        type: 'room:joined',
        payload: {
          index: 1,
          sessionToken: 'abc',
          players: [{ index: 1, name: 'Ada', color: '#00C853' }],
        },
      }),
    }));
    link.close();
  } finally {
    globalThis.WebSocket = previousSocket;
    globalThis.RTCPeerConnection = previousPeer;
  }
  expect(seen).toEqual([1]);
});

test('room:kicked clears stored reconnect state and notifies the controller', () => {
  const memory = new Map<string, string>([
    ['party-session-ABCD', 'stale-token'],
    ['party-seq-ABCD', '42'],
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
  openSockets.length = 0;
  const previousSocket = globalThis.WebSocket;
  const previousPeer = globalThis.RTCPeerConnection;
  globalThis.WebSocket = OpenSocket as unknown as typeof WebSocket;
  globalThis.RTCPeerConnection = class {
    constructor() {
      throw new Error('no pc');
    }
  } as unknown as typeof RTCPeerConnection;
  let kickedCount = 0;
  const sentBuffers: ArrayBuffer[] = [];
  try {
    const link = connectPhone('ABCD', {
      onJoined() {},
      onFull() {},
      onKicked() {
        kickedCount += 1;
      },
      onMount() {},
      onPong() {},
      onLink() {},
    });
    const socket = openSockets[0];
    if (socket === undefined) throw new Error('missing socket');
    socket.send = (data: string | ArrayBuffer) => {
      if (data instanceof ArrayBuffer) sentBuffers.push(data);
    };
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        type: 'room:joined',
        payload: {
          index: 0,
          sessionToken: 'stale-token',
          players: [{ index: 0, name: 'Ada', color: '#FF4D00' }],
        },
      }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        type: 'room:kicked',
        payload: { reason: 'kicked' },
      }),
    }));
    sendAxes(1, 0, performance.now());
    link.close();
  } finally {
    globalThis.WebSocket = previousSocket;
    globalThis.RTCPeerConnection = previousPeer;
  }
  expect(kickedCount).toBe(1);
  expect(storedToken('ABCD')).toBeNull();
  expect(storedSeq('ABCD')).toBe(-1);
  expect(sentBuffers).toEqual([]);
});

class OpenSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  binaryType = 'arraybuffer';
  readyState = OpenSocket.OPEN;
  constructor(_url: string) {
    super();
    openSockets.push(this);
  }
  send(_data: string | ArrayBuffer): void {}
  close(): void {
    this.readyState = OpenSocket.CLOSED;
  }
}

const openSockets: OpenSocket[] = [];
