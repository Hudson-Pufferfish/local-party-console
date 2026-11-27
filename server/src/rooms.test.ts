import { expect, test } from 'vitest';
import { createRoom, createRoomStore, ROOM_ALPHABET } from './rooms.ts';

const ROOM_ID_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;

test('createRoom generates unique 4-character room IDs from ROOM_ALPHABET', () => {
  const store = createRoomStore();
  const allowed = new Set(ROOM_ALPHABET);
  const seen = new Set<string>();

  for (let i = 0; i < 100; i += 1) {
    const { roomId } = createRoom(store);
    expect(roomId).toHaveLength(4);
    expect(roomId).toMatch(ROOM_ID_PATTERN);
    for (const ch of roomId) {
      expect(allowed.has(ch)).toBe(true);
    }
    seen.add(roomId);
  }

  expect(seen.size).toBe(100);
  expect(store.rooms.size).toBe(100);
});
