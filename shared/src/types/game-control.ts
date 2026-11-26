export const ALLOWED_GAME_PREFIXES = ['sumo', 'bomb', 'color', 'cyber', 'pad'] as const;

export type AllowedGamePrefix = (typeof ALLOWED_GAME_PREFIXES)[number];

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_GAME_PREFIXES);

export function isGameControlPrefix(prefix: string): prefix is AllowedGamePrefix {
  return ALLOWED_SET.has(prefix);
}

export function isGameControlMessageType(type: string): boolean {
  const colon = type.indexOf(':');
  if (colon <= 0) return false;
  const prefix = type.slice(0, colon);
  return ALLOWED_SET.has(prefix);
}
