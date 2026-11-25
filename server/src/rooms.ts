import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { PlayerSlot, RoomPhase, RoomRejectReason } from '@shared/types';
import {
  normalizeName,
  validatePlayerName,
} from '../../shared/src/name-service.ts';
import { PLAYER_COLORS } from '../../shared/src/registry.ts';

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_SLOTS = 8;

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
  phase: RoomPhase;
  slots: Array<Slot | null>;
  activeMatchSlots: Set<number>;
  tokens: Map<string, number>;
  revokedTokens: Set<string>;
  views: Map<string, ViewRecord>;
}

export type JoinResult =
  | { kind: 'joined'; index: number; sessionToken: string; players: PlayerSlot[] }
  | { kind: 'full' }
  | { kind: 'kicked' }
  | { kind: 'rejected'; reason: RoomRejectReason };

export type KickResult =
  | { kind: 'kicked'; index: number; players: PlayerSlot[] }
  | { kind: 'ignored' };

export type LeaveResult =
  | { kind: 'left'; index: number; players: PlayerSlot[] }
  | { kind: 'ignored' };

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
    phase: 'lobby',
    slots: Array.from({ length: MAX_SLOTS }, () => null),
    activeMatchSlots: new Set(),
    tokens: new Map(),
    revokedTokens: new Set(),
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
  let existingSlot: Slot | null = null;
  if (sessionToken !== undefined && sessionToken !== '') {
    if (room.revokedTokens.has(sessionToken)) return { kind: 'kicked' };
    const existing = room.tokens.get(sessionToken);
    const slot = existing === undefined ? undefined : room.slots[existing];
    if (slot !== undefined && slot !== null) {
      existingSlot = slot;
    }
  }

  if (room.phase === 'match') {
    if (existingSlot === null || !room.activeMatchSlots.has(existingSlot.index)) {
      return { kind: 'rejected', reason: 'MATCH_IN_PROGRESS' };
    }
  }

  const normalized = normalizeName(name);
  const candidateName = existingSlot !== null && normalized === '' ? existingSlot.name : normalized;
  const otherSlots: Slot[] = [];
  for (const slot of room.slots) {
    if (slot === null || slot === existingSlot) continue;
    otherSlots.push(slot);
  }
  const validation = validatePlayerName(candidateName, otherSlots);
  if (!validation.valid) {
    return { kind: 'rejected', reason: validation.reason };
  }

  if (existingSlot !== null) {
    existingSlot.name = candidateName;
    existingSlot.connected = true;
    return {
      kind: 'joined',
      index: existingSlot.index,
      sessionToken: existingSlot.sessionToken,
      players: publicPlayers(room),
    };
  }

  const index = room.slots.findIndex((slot) => slot === null);
  if (index < 0) return { kind: 'full' };
  const color = PLAYER_COLORS[index];
  if (color === undefined) return { kind: 'full' };
  const issued = randomBytes(16).toString('hex');
  room.slots[index] = {
    index,
    name: normalized,
    color,
    teamId: null,
    connected: true,
    sessionToken: issued,
  };
  room.tokens.set(issued, index);
  return { kind: 'joined', index, sessionToken: issued, players: publicPlayers(room) };
}

export function setRoomPhase(room: Room, phase: RoomPhase): void {
  room.phase = phase;
  room.activeMatchSlots.clear();
  if (phase === 'match') {
    for (const slot of room.slots) {
      if (slot !== null && slot.connected) {
        room.activeMatchSlots.add(slot.index);
      }
    }
  }
}

export function kickSlot(room: Room, index: number): KickResult {
  if (room.phase !== 'lobby') return { kind: 'ignored' };
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SLOTS) return { kind: 'ignored' };
  const slot = room.slots[index];
  if (slot === undefined || slot === null) return { kind: 'ignored' };
  room.tokens.delete(slot.sessionToken);
  room.revokedTokens.add(slot.sessionToken);
  room.slots[index] = null;
  return { kind: 'kicked', index, players: publicPlayers(room) };
}

export function leaveSlot(room: Room, index: number): LeaveResult {
  if (room.phase !== 'lobby') return { kind: 'ignored' };
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SLOTS) return { kind: 'ignored' };
  const slot = room.slots[index];
  if (slot === undefined || slot === null) return { kind: 'ignored' };
  room.tokens.delete(slot.sessionToken);
  room.slots[index] = null;
  return { kind: 'left', index, players: publicPlayers(room) };
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
