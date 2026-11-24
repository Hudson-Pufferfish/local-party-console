import { expect, test } from 'vitest';
import { decode, encodeInto } from './input-packet';

test('encodes and decodes one 8-byte input packet', () => {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);

  encodeInto(
    {
      seq: 0x1234,
      phoneTs: 1000,
      touchLag: 8,
      buttons: 0x01,
      axisX: -10,
      axisY: 127,
    },
    view,
  );

  const bytes = new Uint8Array(buffer);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join(' ')
    .toUpperCase();

  expect(hex).toBe('34 12 E8 03 08 01 F6 7F');
  expect(decode(view)).toEqual({
    seq: 0x1234,
    phoneTs: 1000,
    touchLag: 8,
    buttons: 0x01,
    axisX: -10,
    axisY: 127,
  });
});
