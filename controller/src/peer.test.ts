import { afterEach, expect, test, vi } from 'vitest';
import {
  connectPhone,
  DUPLICATE_NAME_NOTICE,
  EMPTY_NAME_NOTICE,
  joinNotice,
  prepareJoinName,
  rejectNotice,
  storedSeq,
  storedToken,
} from './peer.ts';
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
  expect(joinNotice('queued')).toBe('JOINING ROOM...');
  expect(joinNotice('closed')).toBe('DISCONNECTED FROM HOST — CHECK WI-FI OR RELOAD');
  expect(joinNotice('missing')).toBe('DISCONNECTED FROM HOST — CHECK WI-FI OR RELOAD');
  expect(joinNotice('open')).toBe('');
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

test('room:kicked clears stored reconnect state, closes the kicked socket without reporting link down, and allows explicit rejoin', () => {
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
  const linkEvents: boolean[] = [];
  const sentBuffers: ArrayBuffer[] = [];
  const sentTexts: string[] = [];
  try {
    const link = connectPhone('ABCD', {
      onJoined() {},
      onFull() {},
      onKicked() {
        kickedCount += 1;
      },
      onMount() {},
      onPong() {},
      onLink(up) {
        linkEvents.push(up);
      },
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
    socket.dispatchEvent(new Event('close'));
    sendAxes(1, 0, performance.now());

    // No auto-reconnect until explicit rejoin
    expect(openSockets).toHaveLength(1);
    expect(socket.readyState).toBe(OpenSocket.CLOSED);
    expect(linkEvents).not.toContain(false);

    // Explicit rejoin opens a fresh socket and sends room:join
    link.reconnect();
    expect(openSockets).toHaveLength(2);
    const freshSocket = openSockets[1];
    if (freshSocket === undefined) throw new Error('missing fresh socket');
    freshSocket.send = (data: string | ArrayBuffer) => {
      if (typeof data === 'string') sentTexts.push(data);
    };
    freshSocket.dispatchEvent(new Event('open'));
    expect(link.sendText({ type: 'room:join', payload: { name: 'Ada' } })).toBe('open');
    expect(sentTexts.some((frame) => frame.includes('"room:join"'))).toBe(true);
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

test('prepareJoinName blocks empty names and room:rejected notifies duplicate or empty without closing the socket', () => {
  expect(prepareJoinName('')).toEqual({ ok: false, notice: EMPTY_NAME_NOTICE });
  expect(prepareJoinName('   ')).toEqual({ ok: false, notice: EMPTY_NAME_NOTICE });
  expect(prepareJoinName('  bob  ')).toEqual({ ok: true, name: 'BOB' });
  expect(prepareJoinName('Alice')).toEqual({ ok: true, name: 'ALICE' });
  expect(rejectNotice('EMPTY')).toBe('ENTER AT LEAST 1 CHARACTER');
  expect(rejectNotice('DUPLICATE')).toBe('NAME ALREADY TAKEN — CHOOSE ANOTHER');
  expect(EMPTY_NAME_NOTICE).toBe('ENTER AT LEAST 1 CHARACTER');
  expect(DUPLICATE_NAME_NOTICE).toBe('NAME ALREADY TAKEN — CHOOSE ANOTHER');

  const memory = new Map<string, string>();
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
  const notices: string[] = [];
  const joinedNames: string[] = [];
  const sentTexts: string[] = [];
  try {
    const link = connectPhone('ABCD', {
      onJoined(slot) {
        joinedNames.push(slot.name);
      },
      onFull() {},
      onRejected(reason) {
        notices.push(rejectNotice(reason));
      },
      onMount() {},
      onPong() {},
      onLink() {},
    });
    const socket = openSockets[0];
    if (socket === undefined) throw new Error('missing socket');
    socket.send = (data: string | ArrayBuffer) => {
      if (typeof data === 'string') sentTexts.push(data);
    };
    socket.dispatchEvent(new Event('open'));

    // Empty name is blocked locally and never sent over WebSocket
    const empty = prepareJoinName('   ');
    if (!empty.ok) notices.push(empty.notice);
    expect(sentTexts.some((frame) => frame.includes('"room:join"'))).toBe(false);

    // Server duplicate rejection surfaces the exact notice and keeps the socket open
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'room:rejected', payload: { reason: 'DUPLICATE' } }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'room:rejected', payload: { reason: 'EMPTY' } }),
    }));
    expect(socket.readyState).toBe(OpenSocket.OPEN);

    // Retrying with a valid unique name sends uppercase BOB and succeeds
    const valid = prepareJoinName('bob');
    expect(valid).toEqual({ ok: true, name: 'BOB' });
    if (valid.ok) {
      expect(link.sendText({ type: 'room:join', payload: { name: valid.name } })).toBe('open');
    }
    expect(sentTexts).toContain(JSON.stringify({ type: 'room:join', payload: { name: 'BOB' } }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        type: 'room:joined',
        payload: {
          index: 1,
          sessionToken: 'tok-bob',
          players: [{ index: 1, name: 'BOB', color: '#00C853' }],
        },
      }),
    }));
    link.close();
  } finally {
    globalThis.WebSocket = previousSocket;
    globalThis.RTCPeerConnection = previousPeer;
  }
  expect(notices).toEqual([
    'ENTER AT LEAST 1 CHARACTER',
    'NAME ALREADY TAKEN — CHOOSE ANOTHER',
    'ENTER AT LEAST 1 CHARACTER',
  ]);
  expect(joinedNames).toEqual(['BOB']);
});

test('game:unmount and room:phase lobby reset mounted game state to null view so NO GAME / WAITING and QUIT apply', () => {
  vi.stubGlobal('location', { host: '10.0.0.72:8443' });
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  openSockets.length = 0;
  const previousSocket = globalThis.WebSocket;
  globalThis.WebSocket = OpenSocket as unknown as typeof WebSocket;

  let activeGameId: string | null = null;
  let phase: 'lobby' | 'match' = 'lobby';
  let unmountCalls = 0;

  try {
    const link = connectPhone('ABCD', {
      onJoined() {},
      onFull() {},
      onMount(id) {
        activeGameId = id;
      },
      onUnmount() {
        unmountCalls += 1;
        activeGameId = null;
      },
      onPhase(nextPhase) {
        phase = nextPhase;
        if (nextPhase === 'lobby') activeGameId = null;
      },
      onPong() {},
      onLink() {},
    });
    const socket = openSockets[0];
    if (socket === undefined) throw new Error('missing socket');

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'game:mount', payload: { gameId: 'sumo-dash' } }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'room:phase', payload: { phase: 'match' } }),
    }));
    expect(activeGameId).toBe('sumo-dash');
    expect(phase).toBe('match');

    // Mismatched roomId is ignored
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'game:unmount', payload: { roomId: 'WXYZ' } }),
    }));
    expect(activeGameId).toBe('sumo-dash');
    expect(unmountCalls).toBe(0);

    // game:unmount resets mounted game view to null
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'game:unmount', payload: {} }),
    }));
    expect(unmountCalls).toBe(1);
    expect(activeGameId).toBeNull();

    // Re-mounting then receiving room:phase lobby also clears active game and sets lobby phase
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'game:mount', payload: { gameId: 'sumo-dash' } }),
    }));
    expect(activeGameId).toBe('sumo-dash');
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'room:phase', payload: { phase: 'lobby' } }),
    }));
    expect(phase).toBe('lobby');
    expect(activeGameId).toBeNull();

    link.close();
  } finally {
    globalThis.WebSocket = previousSocket;
  }
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
