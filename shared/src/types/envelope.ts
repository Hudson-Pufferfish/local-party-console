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

export type RoomRejectReason = 'EMPTY' | 'DUPLICATE' | 'MATCH_IN_PROGRESS';

export interface RoomRejectedPayload {
  reason: RoomRejectReason;
}
