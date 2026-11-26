import type { LIGHT_PHASE } from './constants.ts';

export type LightPhase = (typeof LIGHT_PHASE)[keyof typeof LIGHT_PHASE];

export type LightPlayerStatus = 'IN' | 'LOCKED' | 'OUT' | 'WATCHING';

export interface LastLightSimulation {
  readonly state: Float32Array;
  applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void;
  step(dt: number): void;
  startMatch(slots: number[], seed?: number): void;
  setConnectedMask(mask: number): void;
  getMatchTarget(): number;
}

export interface LightControlMessage {
  readonly type: string;
  readonly payload: unknown;
}

export interface LightPracticeStartPayload {
  readonly durationMs: 30000 | 20000;
  readonly breakNumber: number;
}

export interface LightRoundStartPayload {
  readonly roundNumber: number;
  readonly countdownMs: number;
  readonly scores: number[];
  readonly suddenDeath: boolean;
  readonly contenderMask: number;
}

export interface LightLockPayload {
  readonly lockedMask: number;
}

export interface LightBlowoutPayload {
  readonly lockedMask: number;
  readonly outMask: number;
  readonly practice: boolean;
}

export interface LightRoundEndPayload {
  readonly winnerIndex: number | null;
  readonly scores: number[];
  readonly matchOver: boolean;
  readonly suddenDeath: boolean;
  readonly void: boolean;
}

export interface LightStatePayload {
  readonly phase: LightPhase;
  readonly lockedMask: number;
  readonly contenderMask: number;
  readonly scores: number[];
}

export interface LightMatchEndPayload {
  readonly winnerIndex: number;
  readonly scores: number[];
}
