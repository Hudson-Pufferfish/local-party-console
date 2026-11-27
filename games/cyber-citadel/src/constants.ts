export const MAX_BOSSES = 4;

export const CYBER_CITADEL_CONSTANTS = {
  arenaSize: 800,
  halfArena: 400,
  gridCols: 40,
  gridRows: 40,
  gridCells: 1600,
  cellSize: 20,
  maxPlayers: 8,
  maxBosses: MAX_BOSSES,
  totalWaves: 8,
  tickRate: 120,
  dt: 1 / 120,
  defaultSeed: 0x517cc1b7,

  // Core & EMP ring
  coreRadius: 48,
  empRingRadius: 130,
  coreMaxHp: 1000,
  waveBreakCoreHealPct: 0.1,

  // Phase timers
  countdownSec: 3.0,
  waveBreakSec: 15.0,
  flankTelegraphSec: 2.0,

  // Player stats & lifecycle
  playerRadius: 24,
  playerMaxHp: 100,
  playerSpeed: 300,
  downedCrawlFactor: 0.25,
  bleedOutSec: 15.0,
  soloBleedOutSec: 5.0,
  respawnSec: 8.0,
  soloRespawnSec: 4.0,
  soloWeightThreshold: 1.5,
  respawnCoreCostPct: 0.03,
  respawnWaveCapPct: 0.12,
  reviveRange: 64,
  reviveChannelSec: 2.5,
  reviveRestoreHp: 60,
  awayTakeoverSec: 3.0,
  standbyBotLevel: 40,

  // Auto-fire
  autoFireRange: 260,
  autoFireCadenceSec: 0.2,
  autoFireDamage: 12,
  autoFireCosHalfSq: 0.25, // cos^2(60 deg) for 120 deg forward cone
  autoFireStickinessRatioSq: 0.81, // 0.9^2 for 10% closer Core distance
  autoFireTracerTicks: 8,

  // Button A: RAIL (LASER)
  railCooldownSec: 2.5,
  railDamage: 90,
  railHalfWidth: 24,
  railKnockback: 140,
  railSnapCosHalfSq: 0.8213938048432697, // cos^2(25 deg) for 50 deg priority snap cone
  railFanHalfAngle: 0.174532925, // 10 deg spread for V-shape beams (3 rays: -10 deg, 0, +10 deg)
  railTracerTicks: 18,
  bruteShieldBreakSec: 3.0,

  // Button B: DASH
  dashCooldownSec: 1.8,
  dashDurationSec: 0.16,
  dashSpeed: 680,
  dashStaggerRadius: 52,
  dashStaggerImpulse: 180,
  bruteSpinSec: 1.0,

  // Button X: SHIELD (barricade)
  barricadeMaxPerPlayer: 2,
  barricadeTtlSec: 8.0,
  barricadeHp: 180,
  shieldCooldownSec: 1.5,

  // Button Y: EMP
  empChargeSec: 3.0,
  empDecayRatePerSec: 0.1,
  empBlastRadius: 360,
  empDroneDamage: 250,
  empBruteStunSec: 4.0,

  // Enemy defaults
  droneBaseHp: 30,
  droneSpeed: 115,
  droneDps: 18,
  droneRadius: 12,
  droneAttackRange: 18,

  fastDroneBaseHp: 22,
  fastDroneSpeed: 165,
  fastDroneDps: 14,
  fastDroneRadius: 10,

  bruteBaseHp: 220,
  bruteSpeed: 72,
  bruteDps: 28,
  bruteAggroRadius: 220,
  bruteRadius: 22,
  bruteShieldCosHalfSq: 0.25, // cos^2(60 deg) for 120 deg frontal arc

  carrierBaseHp: 110,
  carrierSpeed: 58,
  carrierRadius: 18,
  carrierSpawnIntervalSec: 3.5,

  bossBaseHp: 600,
  bossSpeed: 15,
  bossEnrageSpeed: 25,
  bossRadius: 44,
  bossMeleeDps: 45,
  bossLaserDps: 52,
  bossLaserRange: 340,
  bossLaserSweepSpeed: 0.55, // rad/sec
  bossLaserHalfWidth: 16,
  bossDualDashWindowSec: 1.0,
  bossVulnerableSec: 5.0,
  bossArmorDamageScale: 0.35,
  bossPhase2Threshold: 0.66,
  bossPhase3Threshold: 0.33,
  bossCarrierCooldownSec: 14.0,
} as const;

export const CYBER_HEADER = {
  tickId: 0,
  phaseEnum: 1,
  phaseTimer: 2,
  wave: 3,
  coreHp: 4,
  empCharge: 5,
  empFiredCount: 6,
  bossPhase: 7,
} as const;

export const CYBER_PHASE = {
  COUNTDOWN: 0,
  WAVE_ACTIVE: 1,
  WAVE_BREAK: 2,
  MATCH_OVER: 3,
} as const;

export const CYBER_PLAYER_BASE = 8;
export const CYBER_PLAYER_STRIDE = 10;
export const CYBER_STATE_FLOATS = 88;

export const CYBER_PLAYER_OFFSET = {
  x: 0,
  y: 1,
  heading: 2,
  hp: 3,
  flags: 4,
  downTimer: 5,
  railCooldown: 6,
  dashCooldown: 7,
  reviveChannel: 8,
  barricades: 9,
} as const;

export const CYBER_FLAG = {
  ACTIVE: 1 << 0,
  DOWNED: 1 << 1,
  IS_BOT: 1 << 2,
  DISCONNECTED: 1 << 3,
  EMP_JOINED: 1 << 4,
  STANDBY_BOT: 1 << 5,
  RESPAWNING: 1 << 6,
  JOINED: 1 << 7,
} as const;

export const BUTTON_BIT = {
  RAIL: 1 << 0,
  DASH: 1 << 1,
  SHIELD: 1 << 2,
  REVIVE_EMP: 1 << 3,
} as const;

export const AUX_LAYOUT = {
  ENEMIES_OFFSET: 0,
  ENEMY_STRIDE: 8,
  MAX_ENEMIES: 160,
  ENEMIES_BYTES: 1280,

  PROJECTILES_OFFSET: 1280,
  PROJECTILE_STRIDE: 6,
  MAX_PROJECTILES: 256,
  PROJECTILES_BYTES: 1536,

  BARRICADES_OFFSET: 2816,
  BARRICADE_STRIDE: 6,
  MAX_BARRICADES: 24,
  BARRICADES_BYTES: 144,

  META_OFFSET: 2960,
  META_BYTES: 112,

  // Meta sub-field offsets (absolute byte indices inside auxState)
  META_FLANK_GLOW: 2960, // 4 x u8 (N, E, S, W)
  META_BOSS_LASER_ANGLE: 2964, // u16
  META_BOSS_WEAK_MASK: 2966, // u8
  META_BOSS_HP_PCT: 2967, // u8
  META_SQUAD_DAMAGE: 2968, // u32
  META_ENEMIES_REMAINING: 2972, // u16
  META_EMP_JOINED: 2974, // u8
  META_EMP_REQUIRED: 2975, // u8
  META_BRUTE_HEADING: 2976, // 32 x u8
  META_BOSS_SLOTS: 3008, // 4 x 4 B (enemyIdx+1 u8, weakMask u8, laserAngle u16)
  META_BOSS_SLOT_STRIDE: 4,
  META_RESERVED: 3024, // 48 bytes

  AUX_CORE_BYTES: 3072,
  FLOW_DEBUG_OFFSET: 3072,
  FLOW_DEBUG_BYTES: 1600,
  AUX_DEBUG_BYTES: 4672,
} as const;

export const ENEMY_TYPE = {
  EMPTY: 0,
  DRONE: 1,
  FAST_DRONE: 2,
  BRUTE: 3,
  BOSS: 4,
  CARRIER: 5,
} as const;

export const ENEMY_STATE_FLAG = {
  ALIVE: 1 << 0,
  SHIELD_UP: 1 << 1,
  SPUN: 1 << 2,
  STUNNED: 1 << 3,
  ENRAGED: 1 << 4,
  LASER_SWEEP: 1 << 5,
} as const;

export const PROJECTILE_FLAG = {
  RAIL_BEAM: 1 << 3,
  BOSS_LASER: 1 << 4,
  ENEMY_SHOT: 1 << 5,
  SHIELD_SPARK: 1 << 6,
  ACTIVE: 1 << 7,
} as const;

export const BARRICADE_FLAG = {
  ACTIVE: 1 << 0,
  UNDER_ATTACK: 1 << 1,
  ORIENT_VERT: 1 << 2,
} as const;

export const BOSS_WEAK_FLAG = {
  FLANK_A_HIT: 1 << 0,
  FLANK_B_HIT: 1 << 1,
  VULNERABLE: 1 << 2,
} as const;
