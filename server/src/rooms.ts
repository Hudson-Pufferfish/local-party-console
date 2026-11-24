import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { PlayerSlot } from '@shared/types';
import { PLAYER_COLORS } from '../../shared/src/registry.ts';

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_SLOTS = 8;
const MAX_NAME = 16;

export interface ViewRecord {
  view: string;
  at: number;
}

export interface Slot {
  index: number;
  name: string;
  color: string;
  teamId: number | null;
  connected: boolean;
  sessionToken: string;
}

export interface Room {
  roomId: string;
  hostToken: string;
  slots: Array<Slot | null>;
  tokens: Map<string, number>;
  views: Map<string, ViewRecord>;
}

export type JoinResult =
  | { kind: 'joined'; index: number; sessionToken: string; players: PlayerSlot[] }
  | { kind: 'full' };

export interface RoomStore {
  rooms: Map<string, Room>;
}

export function createRoomStore(): RoomStore {
  return { rooms: new Map() };
}

export function createRoom(store: RoomStore): { roomId: string; hostToken: string } {
  let roomId = randomRoomId();
  while (store.rooms.has(roomId)) {
    roomId = randomRoomId();
  }
  const hostToken = randomBytes(16).toString('hex');
  const room: Room = {
    roomId,
    hostToken,
    slots: Array.from({ length: MAX_SLOTS }, () => null),
    tokens: new Map(),
    views: new Map(),
  };
  store.rooms.set(roomId, room);
  return { roomId, hostToken };
}

export function hostTokenMatches(room: Room, presented: string): boolean {
  const expected = Buffer.from(room.hostToken);
  const actual = Buffer.from(presented);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function joinRoom(room: Room, name: string, sessionToken?: string): JoinResult {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (sessionToken !== undefined && sessionToken !== '') {
    const existing = room.tokens.get(sessionToken);
    const slot = existing === undefined ? undefined : room.slots[existing];
    if (slot !== undefined && slot !== null) {
      slot.name = trimmed;
      slot.connected = true;
      return {
        kind: 'joined',
        index: slot.index,
        sessionToken: slot.sessionToken,
        players: publicPlayers(room),
      };
    }
  }
  const index = room.slots.findIndex((slot) => slot === null);
  if (index < 0) return { kind: 'full' };
  const color = PLAYER_COLORS[index];
  if (color === undefined) return { kind: 'full' };
  const issued = randomBytes(16).toString('hex');
  room.slots[index] = {
    index,
    name: trimmed,
    color,
    teamId: null,
    connected: true,
    sessionToken: issued,
  };
  room.tokens.set(issued, index);
  return { kind: 'joined', index, sessionToken: issued, players: publicPlayers(room) };
}

export function markSlotDisconnected(room: Room, index: number): void {
  const slot = room.slots[index];
  if (slot === undefined || slot === null) return;
  slot.connected = false;
}

export function publicPlayers(room: Room): PlayerSlot[] {
  const players: PlayerSlot[] = [];
  for (const slot of room.slots) {
    if (slot === null) continue;
    players.push({
      index: slot.index,
      name: slot.name,
      color: slot.color,
      teamId: slot.teamId,
      connected: slot.connected,
    });
  }
  return players;
}

function randomRoomId(): string {
  const bytes = randomBytes(4);
  let roomId = '';
  for (const byte of bytes) {
    roomId += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
  }
  return roomId;
}
