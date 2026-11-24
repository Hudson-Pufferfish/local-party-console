import { expect, test } from 'vitest';
import { routeFastInput } from './policy';

test('drops an open channel when the buffer is above 64 bytes', () => {
  expect(
    routeFastInput({ channelOpen: true, channelAgeMs: 0, bufferedAmount: 65 }),
  ).toBe('drop');
  expect(
    routeFastInput({ channelOpen: true, channelAgeMs: 0, bufferedAmount: 64 }),
  ).toBe('dc');
});

test('uses binary ws after a closed channel is 3000 ms old', () => {
  expect(
    routeFastInput({ channelOpen: false, channelAgeMs: 2999, bufferedAmount: 0 }),
  ).toBe('wait');
  expect(
    routeFastInput({ channelOpen: false, channelAgeMs: 3000, bufferedAmount: 0 }),
  ).toBe('ws');
});
