import { normalizeName } from '../../shared/src/name-service.ts';
import type { PlayerSlot, RoomKickPayload } from '../../shared/src/types/index.ts';

export function playerDisplayName(name: string): string {
  const normalized = normalizeName(name);
  return normalized === '' ? 'PLAYER' : normalized;
}

export function kickButtonLabel(name: string): string {
  return `Remove ${playerDisplayName(name)}`;
}

export function kickRequestFor(
  players: readonly PlayerSlot[],
  index: number,
  primary: boolean,
  inMatch: boolean,
): { type: 'room:kick'; payload: RoomKickPayload } | null {
  if (!primary || inMatch) return null;
  const target = players.find((player) => player.index === index);
  if (target === undefined) return null;
  return { type: 'room:kick', payload: { index } };
}
