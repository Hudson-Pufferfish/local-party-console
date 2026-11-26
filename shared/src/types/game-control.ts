export const ALLOWED_GAME_PREFIXES = ['sumo', 'bomb', 'color', 'cyber', 'pad'] as const;

export type AllowedGamePrefix = (typeof ALLOWED_GAME_PREFIXES)[number];

export const PAD_STATE_TYPE = 'pad:state' as const;

export interface GameControlMessage {
  readonly type: string;
  readonly payload: unknown;
}

export interface PadStatePayload {
  readonly slot: number;
  readonly labels?: readonly string[];
  readonly disabled?: number;
  readonly cooldownEndsAt?: readonly number[];
}

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_GAME_PREFIXES);
const MAX_PAD_BUTTONS = 4;
const MAX_SLOT = 7;

export function isGameControlPrefix(prefix: string): prefix is AllowedGamePrefix {
  return ALLOWED_SET.has(prefix);
}

export function isGameControlMessageType(type: string): boolean {
  const colon = type.indexOf(':');
  if (colon <= 0) return false;
  const prefix = type.slice(0, colon);
  return ALLOWED_SET.has(prefix);
}

export function parsePadStatePayload(payload: unknown): PadStatePayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = payload as {
    slot?: unknown;
    labels?: unknown;
    disabled?: unknown;
    cooldownEndsAt?: unknown;
  };
  if (
    typeof raw.slot !== 'number' ||
    !Number.isInteger(raw.slot) ||
    raw.slot < 0 ||
    raw.slot > MAX_SLOT
  ) {
    return null;
  }

  const out: {
    slot: number;
    labels?: string[];
    disabled?: number;
    cooldownEndsAt?: number[];
  } = { slot: raw.slot };

  if (Array.isArray(raw.labels)) {
    const count = Math.min(raw.labels.length, MAX_PAD_BUTTONS);
    const labels: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const entry = raw.labels[i];
      labels.push(typeof entry === 'string' ? entry : '');
    }
    out.labels = labels;
  }

  if (typeof raw.disabled === 'number' && Number.isFinite(raw.disabled)) {
    out.disabled = (raw.disabled | 0) & 0x0f;
  }

  if (Array.isArray(raw.cooldownEndsAt)) {
    const count = Math.min(raw.cooldownEndsAt.length, MAX_PAD_BUTTONS);
    const cooldownEndsAt: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const entry = raw.cooldownEndsAt[i];
      cooldownEndsAt.push(typeof entry === 'number' && Number.isFinite(entry) && entry > 0 ? entry : 0);
    }
    out.cooldownEndsAt = cooldownEndsAt;
  }

  return out;
}

export function readPadStateMessage(
  message: GameControlMessage | null | undefined,
  slot: number,
): PadStatePayload | null {
  if (message === null || message === undefined || message.type !== PAD_STATE_TYPE) {
    return null;
  }
  const parsed = parsePadStatePayload(message.payload);
  if (parsed === null || parsed.slot !== slot) return null;
  return parsed;
}
