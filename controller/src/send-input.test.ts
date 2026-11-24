import { afterEach, expect, test, vi } from 'vitest';
import { bindTransport, markJoined, sendAxes, sendButton, setSendClock } from './send-input.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a late send window still delivers a held stick and a dash', () => {
  vi.useFakeTimers();
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  let now = 5000.4;
  vi.stubGlobal('performance', { now: () => now });
  const axes: number[] = [];
  const dashes: number[] = [];
  bindTransport({
    readRoute: () => 'ws',
    sendDc: () => false,
    sendWs: (buffer) => {
      const view = new DataView(buffer.slice(0));
      axes.push(view.getInt8(6));
      dashes.push(view.getUint8(5) & 1);
      return true;
    },
  });
  markJoined();
  setSendClock({ slot: 0, offsetMs: 0, tier: '60' });
  sendAxes(1, 0, now);
  sendButton(true, now);
  now += 40;
  vi.advanceTimersByTime(40);
  expect(axes.some((axis) => axis === 127)).toBe(true);
  expect(dashes).toContain(1);
  const sent = axes.length;
  now += 40;
  vi.advanceTimersByTime(40);
  expect(axes.length).toBeGreaterThan(sent);
  expect(axes[axes.length - 1]).toBe(127);
});
