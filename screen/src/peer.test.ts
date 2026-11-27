import { expect, test } from 'vitest';
import { encodeHeartbeat } from '../../shared/src/sync/heartbeat.ts';
import { createPeerMap } from './peer.ts';

function wsHeartbeatFrame(prefixSlot: number, innerSlot: number, phoneTs: number): ArrayBuffer {
  const bytes = new Uint8Array(5);
  bytes[0] = prefixSlot;
  encodeHeartbeat(bytes.subarray(1, 5), innerSlot, phoneTs);
  return bytes.buffer;
}

test('handleBinary accepts matching 5-byte WS heartbeats and ignores mismatched or out-of-range slots', () => {
  const heartbeats: number[] = [];
  const peers = createPeerMap({
    onPacket() {},
    onHeartbeat(slot) {
      heartbeats.push(slot);
    },
    onOffset() {},
    onTier() {},
    onLongTask() {},
    isPrimary: () => true,
    onSdp() {},
    send() {},
  });

  // Out-of-range prefix slot is ignored.
  peers.handleBinary(wsHeartbeatFrame(8, 2, 100));
  expect(heartbeats).toEqual([]);
  expect(peers.mode(2)).toBe('idle');

  // Mismatched prefix slot vs inner heartbeat slot is ignored.
  peers.handleBinary(wsHeartbeatFrame(2, 3, 100));
  expect(heartbeats).toEqual([]);
  expect(peers.mode(2)).toBe('idle');

  // Matching prefix slot and inner heartbeat slot updates mode and triggers callback.
  peers.handleBinary(wsHeartbeatFrame(2, 2, 100));
  expect(heartbeats).toEqual([2]);
  expect(peers.mode(2)).toBe('ws');
});
