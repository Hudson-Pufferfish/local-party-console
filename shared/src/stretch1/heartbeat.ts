export const HEARTBEAT_MS = 40;
export const HEARTBEAT_MAGIC = 0xa5;

export function encodeHeartbeat(target: Uint8Array, slot: number, phoneTs: number): void {
  target[0] = HEARTBEAT_MAGIC;
  target[1] = slot & 0xff;
  target[2] = phoneTs & 0xff;
  target[3] = (phoneTs >> 8) & 0xff;
}

export function heartbeatSlot(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== HEARTBEAT_MAGIC) return null;
  const slot = bytes[1] ?? 0;
  if (slot > 7) return null;
  return slot;
}
