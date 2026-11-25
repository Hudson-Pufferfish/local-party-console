export const MAX_PLAYER_NAME_LENGTH = 16;

export type NameRejectReason = 'EMPTY' | 'DUPLICATE';

export type NameValidationResult =
  | { valid: true; reason?: undefined }
  | { valid: false; reason: NameRejectReason };

export function normalizeName(raw: string): string {
  return raw.trim().toUpperCase().slice(0, MAX_PLAYER_NAME_LENGTH);
}

export function validatePlayerName(
  name: string,
  currentPlayers: readonly { name: string }[],
): NameValidationResult {
  const normalized = normalizeName(name);
  if (normalized.length < 1) {
    return { valid: false, reason: 'EMPTY' };
  }
  for (const player of currentPlayers) {
    if (normalizeName(player.name) === normalized) {
      return { valid: false, reason: 'DUPLICATE' };
    }
  }
  return { valid: true };
}

export function generateBotName(existingNames: readonly string[]): string {
  const used = new Set<string>();
  for (const name of existingNames) {
    const normalized = normalizeName(name);
    if (normalized !== '') used.add(normalized);
  }
  let index = 1;
  while (used.has(`P${index}`)) {
    index += 1;
  }
  return `P${index}`;
}
