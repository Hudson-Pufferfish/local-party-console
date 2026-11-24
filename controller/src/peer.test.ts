import { afterEach, expect, test, vi } from 'vitest';
import { connectPhone, joinNotice } from './peer.ts';

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

test('a join while the socket is still connecting is queued and marked down', () => {
  expect(joinNotice('queued')).toBe('LINK // DOWN');
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
