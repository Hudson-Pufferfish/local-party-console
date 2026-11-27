import { afterEach, expect, test, vi } from 'vitest';
import type { FastInputRoute } from '../../shared/src/transport/policy.ts';
import {
  bindTransport,
  markJoined,
  markUnjoined,
  sendAxes,
  sendButton,
  setSendClock,
  setSeq,
} from './send-input.ts';

let baseNow = 5000.4;

afterEach(() => {
  markUnjoined();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  baseNow += 1000;
});

function setupRoute(route: FastInputRoute, sendDcResult: boolean) {
  vi.useFakeTimers();
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  let now = baseNow;
  vi.stubGlobal('performance', { now: () => now });
  const dcPackets: Uint8Array[] = [];
  const wsPackets: Uint8Array[] = [];
  bindTransport({
    readRoute: () => route,
    sendDc: (buffer) => {
      dcPackets.push(new Uint8Array(buffer.slice(0)));
      return sendDcResult;
    },
    sendWs: (buffer) => {
      wsPackets.push(new Uint8Array(buffer.slice(0)));
      return true;
    },
  });
  setSeq(0);
  markJoined();
  setSendClock({ slot: 0, offsetMs: 0, tier: '60' });
  return {
    dcPackets,
    wsPackets,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
      vi.advanceTimersByTime(ms);
    },
  };
}

test('a late send window still delivers a held stick and a dash', () => {
  const ctx = setupRoute('ws', false);
  sendAxes(1, 0, ctx.now());
  sendButton(true, ctx.now());
  ctx.advance(40);
  const axes = ctx.wsPackets.map((bytes) => new DataView(bytes.buffer).getInt8(6));
  const dashes = ctx.wsPackets.map((bytes) => new DataView(bytes.buffer).getUint8(5) & 1);
  expect(ctx.dcPackets.length).toBe(0);
  expect(axes.some((axis) => axis === 127)).toBe(true);
  expect(dashes).toContain(1);
  const sent = ctx.wsPackets.length;
  ctx.advance(40);
  expect(ctx.wsPackets.length).toBeGreaterThan(sent);
  expect(new DataView(ctx.wsPackets[ctx.wsPackets.length - 1]!.buffer).getInt8(6)).toBe(127);
});

test('route dc sends once on data channel and never on websocket when sendDc succeeds', () => {
  const ctx = setupRoute('dc', true);
  sendAxes(1, 0, ctx.now());
  ctx.advance(17);
  expect(ctx.dcPackets.length).toBe(1);
  expect(ctx.wsPackets.length).toBe(0);
  expect(ctx.dcPackets[0]!.byteLength).toBe(8);
});

test('route dc falls back to websocket with the same 8-byte snapshot when sendDc fails', () => {
  const ctx = setupRoute('dc', false);
  sendAxes(1, 0, ctx.now());
  ctx.advance(17);
  expect(ctx.dcPackets.length).toBe(1);
  expect(ctx.wsPackets.length).toBe(1);
  expect(ctx.dcPackets[0]!.byteLength).toBe(8);
  expect(ctx.wsPackets[0]).toEqual(ctx.dcPackets[0]);
});

test.each<FastInputRoute>(['drop', 'wait', 'ws'])(
  'route %s skips data channel and sends once on websocket',
  (route) => {
    const ctx = setupRoute(route, true);
    sendAxes(1, 0, ctx.now());
    ctx.advance(17);
    expect(ctx.dcPackets.length).toBe(0);
    expect(ctx.wsPackets.length).toBe(1);
    expect(ctx.wsPackets[0]!.byteLength).toBe(8);
  },
);
