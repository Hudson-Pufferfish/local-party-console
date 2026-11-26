export const BOMB_CONSTANTS = {
  arenaRadius: 400,
  wallBounce: 0.65,
  rSpawn: 240,
  puckRadius: 28,
  mass: 1,
  aMove: 1800,
  mu: 4.2,
  vMax: 420,
  vMaxHolder: 455,
  dashSpeed: 880,
  dashActive: 0.18,
  dashCooldown: 1.5,
  steerDash: 0.3,
  restitution: 0.85,
  transferRecoilScale: 1.25,
  fuseDuration: 15.0,
  suddenDeathFuse: 7.5,
  transferCooldown: 0.5,
  blastRadius: 64,
  blastBreather: 0.85,
  disconnectFuseFloor: 2.0,
  warnThreshold: 5.0,
  criticalThreshold: 2.0,
  practiceInitial: 30.0,
  practiceBreak: 20.0,
  countdown: 3.0,
  roundEnd: 0.8,
  roundEndSuddenDeath: 1.5,
  minTargetScore: 3,
  targetMultiplier: 3,
  angleBlend: 12,
  deadzone: 0.12,
  maxPlayers: 8,
  stateFloats: 88,
  defaultSeed: 0xb0bb9a55,
} as const;

export const BOMB_HEADER = {
  tick: 0,
  phase: 1,
  phaseTimer: 2,
  arenaRadius: 3,
  bombHolder: 4,
  bombTimer: 5,
  transferCooldown: 6,
  roundFlags: 7,
} as const;

export const BOMB_PHASE = {
  countdown: 0,
  active: 1,
  roundEnd: 2,
  matchOver: 3,
  practice: 4,
} as const;

export const BOMB_ROUND_FLAG = {
  roundSuddenDeath: 1,
  matchSuddenDeath: 2,
} as const;

export const BOMB_PLAYER_BASE = 8;
export const BOMB_PLAYER_STRIDE = 10;

export const BOMB_FLAG_ALIVE = 1;
export const BOMB_FLAG_HOLDING = 2;
export const BOMB_FLAG_IS_BOT = 4;
export const BOMB_FLAG_DISCONNECTED = 8;
export const BOMB_FLAG_SD_CONTENDER = 16;
export const BOMB_FLAG_EXPLODED = 32;
