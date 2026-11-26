export const LAST_LIGHT_CONSTANTS = {
  scoredMinSec: 3.0,
  scoredMaxSec: 12.0,
  practiceMinSec: 1.0,
  practiceMaxSec: 3.5,
  practiceRevealSec: 0.6,
  practiceGuardSec: 4.1,
  practiceInitial: 30.0,
  practiceBreak: 20.0,
  countdown: 3.0,
  roundEnd: 0.8,
  dimStartLuminance: 1.0,
  dimEndLuminance: 0.2,
  flickerDip: 0.22,
  flickerMinLuminance: 0.12,
  hazardShapeK: 2.0,
  minTargetScore: 3,
  targetMultiplier: 3,
  maxPlayers: 8,
  stateFloats: 88,
  stepHz: 120,
  defaultSeed: 0x1a571167,
} as const;

export const LIGHT_HEADER = {
  tick: 0,
  phase: 1,
  phaseTimer: 2,
  lampElapsed: 3,
  lampFlags: 4,
  activeMask: 5,
  blowoutCount: 6,
  winnerSlot: 7,
} as const;

export const LIGHT_PHASE = {
  countdown: 0,
  active: 1,
  roundEnd: 2,
  matchOver: 3,
  practice: 4,
} as const;

export const LAMP_FLAG = {
  lit: 1,
  blown: 2,
  flicker: 4,
  practiceBlowout: 8,
  voidRound: 16,
  suddenDeath: 32,
} as const;

export const LIGHT_PLAYER_BASE = 8;
export const LIGHT_PLAYER_STRIDE = 10;

export const LIGHT_PLAYER_OFFSET = {
  flags: 0,
  lockTick: 1,
  score: 2,
  lastRoundPoints: 3,
} as const;

export const LIGHT_FLAG = {
  active: 1,
  locked: 2,
  isBot: 4,
  contender: 8,
  out: 16,
  disconnected: 32,
  joined: 64,
} as const;
