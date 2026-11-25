import { expect, test } from 'vitest';
import { ntpDelay, ntpOffset } from './clock';
import { encodeHeartbeat, heartbeatSlot } from './heartbeat';
import { nextJitter, oneWayMs, percentile } from './metrics';
import { pickPointerSample } from './samples';
import { nextDelayMs, phaseWaitMs } from './tdma';
import { sendIntervalMs, tierFor } from './tier';

test('ntp offset, tdma phase, tier, and heartbeat bytes', () => {
  expect(ntpOffset(1000, 1010, 1012, 1024)).toBe(-1);
  expect(ntpDelay(1000, 1010, 1012, 1024)).toBe(22);
  expect(phaseWaitMs(0, 3)).toBe(6);
  expect(phaseWaitMs(7, 3)).toBeCloseTo(15.6, 3);
  expect(nextDelayMs(0, 0, 10, 16.6)).toBeCloseTo(6.6, 3);
  expect(tierFor({ power: 'low-power', cores: 8 })).toBe('30');
  expect(tierFor({ power: 'ok', cores: 4 })).toBe('30');
  expect(tierFor({ power: 'ok', cores: 8 })).toBe('60');
  expect(tierFor({ power: 'ok', cores: 0 })).toBe('60');
  expect(sendIntervalMs('60')).toBe(16.6);
  expect(sendIntervalMs('30')).toBe(1000 / 30);
  const bytes = new Uint8Array(4);
  encodeHeartbeat(bytes, 3, 0x1234);
  expect(Array.from(bytes)).toEqual([0xa5, 3, 0x34, 0x12]);
  expect(heartbeatSlot(bytes)).toBe(3);
  expect(heartbeatSlot(new Uint8Array([0, 3, 0, 0]))).toBeNull();
});

test('one-way unwrap, jitter, percentile, and pointer sample', () => {
  expect(oneWayMs(5000, 4990, 0)).toBe(10);
  expect(oneWayMs(65636, 65500, 0)).toBe(136);
  expect(nextJitter(0, 16)).toBe(1);
  expect(percentile([10, 20, 40], 3, 50)).toBe(20);
  expect(percentile([10, 20, 40], 3, 99)).toBe(40);
  const fallback = { clientX: 1, clientY: 1, timeStamp: 5 };
  const coalesced = { clientX: 2, clientY: 3, timeStamp: 6 };
  const predicted = { clientX: 9, clientY: 8, timeStamp: 7 };
  expect(pickPointerSample(fallback, [coalesced], [predicted])).toBe(predicted);
  expect(pickPointerSample(fallback, [coalesced], []).clientX).toBe(2);
});
