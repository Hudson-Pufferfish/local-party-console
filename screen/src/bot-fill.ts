import { DEFAULT_BOT_DIFFICULTY, type BotDifficulty } from '../../shared/src/bot-difficulty.ts';
import type { PlayerSlot } from '../../shared/src/types/game.ts';

export const NOTICE_OVER_CAP = 'exceed max — modify bot count';
export const NOTICE_NO_HUMAN = 'need minimum one real player';

const MASK_LEN = 8;

export type BotLobbyState = { botCount: number; difficulty: BotDifficulty; locked: boolean };
export type StartBlock = 'no-human' | 'below-min' | 'over-cap';

export interface BotRoster {
  slots: number[];
  botMask: Uint8Array;
}

export function createBotLobby(): BotLobbyState {
  return { botCount: 0, difficulty: DEFAULT_BOT_DIFFICULTY, locked: false };
}

export function lockBotCount(state: BotLobbyState): BotLobbyState {
  if (state.locked) return state;
  return { botCount: state.botCount, difficulty: state.difficulty, locked: true };
}

export function unlockBotCount(state: BotLobbyState): BotLobbyState {
  if (!state.locked) return state;
  return { botCount: state.botCount, difficulty: state.difficulty, locked: false };
}

export function nextBotDifficulty(
  state: BotLobbyState,
  difficulty: BotDifficulty,
  supportsBots: boolean,
): BotLobbyState {
  if (state.locked || !supportsBots || state.difficulty === difficulty) return state;
  return { botCount: state.botCount, difficulty, locked: false };
}

export function clampBotCount(requested: number, humans: number, maxPlayers: number): number {
  const seats = Math.max(0, maxPlayers - Math.max(0, humans));
  if (!Number.isFinite(requested)) return 0;
  let value = Math.trunc(requested);
  if (value < 0) value = 0;
  if (value > seats) value = seats;
  return value;
}

export function nextBotCount(
  state: BotLobbyState,
  requested: number,
  humans: number,
  maxPlayers: number,
  supportsBots: boolean,
): BotLobbyState {
  if (state.locked || humans <= 0 || !supportsBots) return state;
  const clamped = clampBotCount(requested, humans, maxPlayers);
  if (requested > clamped) {
    const lowered = Math.trunc(requested);
    if (!Number.isFinite(requested) || lowered >= state.botCount || lowered < 0) return state;
    return { botCount: lowered, difficulty: state.difficulty, locked: false };
  }
  if (clamped === state.botCount) return state;
  return { botCount: clamped, difficulty: state.difficulty, locked: false };
}

export function startBlockReason(input: {
  humans: number;
  bots: number;
  minPlayers: number;
  maxPlayers: number;
  supportsBots: boolean;
}): StartBlock | null {
  const bots = input.supportsBots ? input.bots : 0;
  if (input.humans <= 0) return 'no-human';
  if (input.humans + bots > input.maxPlayers) return 'over-cap';
  if (input.humans + bots < input.minPlayers) return 'below-min';
  return null;
}

export function startNotice(reason: StartBlock | null): string {
  if (reason === 'over-cap') return NOTICE_OVER_CAP;
  if (reason === 'no-human') return NOTICE_NO_HUMAN;
  return '';
}

export function rosterForStart(
  players: readonly PlayerSlot[],
  manifest: { minPlayers: number; maxPlayers: number; supportsBots: boolean },
  botCount: number,
): BotRoster | null {
  let humans = 0;
  for (const player of players) {
    if (player.connected) humans += 1;
  }
  if (startBlockReason({
    humans,
    bots: botCount,
    minPlayers: manifest.minPlayers,
    maxPlayers: manifest.maxPlayers,
    supportsBots: manifest.supportsBots,
  }) !== null) {
    return null;
  }

  const occupied = new Uint8Array(MASK_LEN);
  const slots: number[] = [];
  for (const player of players) {
    const index = player.index;
    if (index !== (index | 0) || index < 0 || index >= manifest.maxPlayers || index >= MASK_LEN) {
      return null;
    }
    if (player.connected && occupied[index] === 0) slots.push(index);
    occupied[index] = 1;
  }

  const botMask = new Uint8Array(MASK_LEN);
  if (manifest.supportsBots && botCount > 0) {
    let placed = 0;
    const limit = manifest.maxPlayers < MASK_LEN ? manifest.maxPlayers : MASK_LEN;
    for (let index = 0; index < limit; index += 1) {
      if (placed === botCount) break;
      if (occupied[index] === 1) continue;
      occupied[index] = 1;
      botMask[index] = 1;
      slots.push(index);
      placed += 1;
    }
    if (placed !== botCount) return null;
  }
  return { slots, botMask };
}

export interface BotFillSim {
  readonly state: Float32Array;
  applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void;
}

export type WriteBotInput = (
  state: Float32Array,
  botIndex: number,
  axisX: Int8Array,
  axisY: Int8Array,
  buttons: Uint8Array,
  level?: number,
) => void;

export type BotLevels = (mask: Uint8Array, difficulty?: BotDifficulty) => Uint8Array;

export interface BotFill {
  arm(mask: Uint8Array, difficulty?: BotDifficulty): void;
  fill(slot: number, sim: BotFillSim): boolean;
}

export function createBotFill(write: WriteBotInput, levelsFor?: BotLevels): BotFill {
  const axisX = new Int8Array(MASK_LEN);
  const axisY = new Int8Array(MASK_LEN);
  const buttons = new Uint8Array(MASK_LEN);
  const botMask = new Uint8Array(MASK_LEN);
  const levelBySlot = new Uint8Array(MASK_LEN);
  return {
    arm(mask: Uint8Array, difficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY): void {
      for (let index = 0; index < MASK_LEN; index += 1) {
        botMask[index] = mask[index] ?? 0;
      }
      const levels = levelsFor?.(botMask, difficulty);
      for (let index = 0; index < MASK_LEN; index += 1) {
        levelBySlot[index] = levels?.[index] ?? 0;
      }
    },
    fill(slot: number, sim: BotFillSim): boolean {
      if (botMask[slot] !== 1) return false;
      const stored = levelBySlot[slot] ?? 0;
      const level = stored === 0 ? undefined : stored;
      if ((sim.state[0] & 1) === 0) write(sim.state, slot, axisX, axisY, buttons, level);
      sim.applyInput(slot, buttons[slot] ?? 0, axisX[slot] ?? 0, axisY[slot] ?? 0);
      return true;
    },
  };
}

export function botMaskAfterHumanLeave(mask: Uint8Array, humanSlot: number): Uint8Array {
  const next = new Uint8Array(MASK_LEN);
  for (let index = 0; index < MASK_LEN; index += 1) {
    next[index] = mask[index] ?? 0;
  }
  if (humanSlot >= 0 && humanSlot < MASK_LEN && next[humanSlot] === 0) {
    next[humanSlot] = 0;
  }
  return next;
}
