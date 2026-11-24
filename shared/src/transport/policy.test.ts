import { expect, test } from 'vitest';
import { inputDeliveries, routeFastInput } from './policy';

test('drops an open channel when the buffer is above 64 bytes', () => {
  expect(
    routeFastInput({ channelOpen: true, channelAgeMs: 0, bufferedAmount: 65 }),
  ).toBe('drop');
  expect(
    routeFastInput({ channelOpen: true, channelAgeMs: 0, bufferedAmount: 64 }),
  ).toBe('dc');
});

test('a full or unready data channel still delivers on the websocket', () => {
  expect(inputDeliveries('dc')).toEqual({ dc: true, ws: true });
  expect(inputDeliveries('drop')).toEqual({ dc: false, ws: true });
  expect(inputDeliveries('wait')).toEqual({ dc: false, ws: true });
  expect(inputDeliveries('ws')).toEqual({ dc: false, ws: true });
});

test('uses binary ws after a closed channel is 3000 ms old', () => {
  expect(
    routeFastInput({ channelOpen: false, channelAgeMs: 2999, bufferedAmount: 0 }),
  ).toBe('wait');
  expect(
    routeFastInput({ channelOpen: false, channelAgeMs: 3000, bufferedAmount: 0 }),
  ).toBe('ws');
});
