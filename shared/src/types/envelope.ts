export interface Envelope {
  type: string;
  roomId: string;
  payload: unknown;
}

export type RoomPhase = 'lobby' | 'match';

export interface RoomPhasePayload {
  phase: RoomPhase;
}

export interface RoomKickPayload {
  index: number;
}

export interface RoomKickedPayload {
  reason: 'kicked';
}
