export const PHASE_COUNTDOWN = 0;
export const PHASE_ROUND_ACTIVE = 1;
export const PHASE_ROUND_END = 2;
export const PHASE_MATCH_OVER = 3;
export const PHASE_PRACTICE = 4;
export const PHASE_OVERTIME = 5;

export const FLAG_ACTIVE = 1;
export const FLAG_BOOSTING = 2;
export const FLAG_IS_BOT = 4;
export const FLAG_CONTENDER = 8;

export const COLOR_CLASH_CONSTANTS = {
  maxPlayers: 8,
  stateFloats: 88,
  headerFloats: 8,
  playerStride: 10,
  arenaSize: 800,
  halfArena: 400,
  gridSize: 40,
  gridCells: 1600,
  cellSize: 20,
  puckRadius: 24,
  maxCoord: 376,
  rSpawn: 260,
  aMove: 1900,
  mu: 4.5,
  vMax: 400,
  wallBounce: 0.35,
  deadzone: 0.12,
  angleBlend: 14,
  restitution: 0.75,
  boostShove: 1.35,
  mutualBoost: 1.25,
  hitStopFrames: 2,
  boostActive: 3.0,
  boostCooldown: 8.0,
  boostSpeed: 560,
  boostAccel: 2400,
  boostSteer: 0.85,
  paintRadius: 24,
  boostPaintRadius: 54,
  minTargetScore: 3,
  targetMultiplier: 3,
  practiceInitial: 30.0,
  practiceBreak: 20.0,
  countdown: 3.0,
  roundDuration: 45.0,
  roundEnd: 0.8,
  overtimeDuration: 30.0,
  finalReveal: 3.0,
  goldenMargin: 6,
} as const;
