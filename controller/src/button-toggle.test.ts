import { afterEach, expect, test, vi } from 'vitest';
import { bindTransport, markJoined, markUnjoined, sendButton, setSendClock } from './send-input.ts';

afterEach(() => {
  markUnjoined();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('sendButton encodes lower nibble as held state and upper nibble as toggle counters for buttons 0..3', () => {
  vi.useFakeTimers();
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  let now = 5000.4;
  vi.stubGlobal('performance', { now: () => now });

  const packets: number[] = [];
  bindTransport({
    readRoute: () => 'ws',
    sendDc: () => false,
    sendWs: (buffer) => {
      const view = new DataView(buffer.slice(0));
      packets.push(view.getUint8(5));
      return true;
    },
  });

  markJoined();
  setSendClock({ slot: 0, offsetMs: 0, tier: '60' });

  // 1. Tap Button 0 (A)
  sendButton(true, now, 0);
  now += 20;
  vi.advanceTimersByTime(20);
  expect(packets[packets.length - 1]).toBe(0x11); // Toggle bit 0 = 1, Held bit 0 = 1 (0x11)

  // 2. Release Button 0 (A)
  sendButton(false, now, 0);
  now += 20;
  vi.advanceTimersByTime(20);
  expect(packets[packets.length - 1]).toBe(0x10); // Toggle bit 0 stays 1, Held bit 0 = 0 (0x10)

  // 3. Tap Button 1 (B)
  sendButton(true, now, 1);
  now += 20;
  vi.advanceTimersByTime(20);
  // Toggle: bit 0 is 1, bit 1 flips to 1 -> toggleBits = 0b0011 (3).
  // Held: bit 1 is 1 -> heldBits = 0b0010 (2).
  // Byte 5 = (3 << 4) | 2 = 0x32
  expect(packets[packets.length - 1]).toBe(0x32);

  // 4. Tap Button 0 (A) again while Button 1 is held
  sendButton(true, now, 0);
  now += 20;
  vi.advanceTimersByTime(20);
  // Toggle: bit 0 flips from 1 -> 0, bit 1 stays 1 -> toggleBits = 0b0010 (2).
  // Held: bit 0 is 1, bit 1 is 1 -> heldBits = 0b0011 (3).
  // Byte 5 = (2 << 4) | 3 = 0x23
  expect(packets[packets.length - 1]).toBe(0x23);

  // 5. Release both
  sendButton(false, now, 0);
  sendButton(false, now, 1);
  now += 20;
  vi.advanceTimersByTime(20);
  // Toggle remains 0b0010 (2), Held = 0
  // Byte 5 = 0x20
  expect(packets[packets.length - 1]).toBe(0x20);
});
