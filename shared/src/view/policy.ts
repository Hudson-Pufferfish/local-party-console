import type { GameViewConfig, ScreenViewTarget } from '../types/game';

const HOLISTIC_STANDBY = 'STANDBY // THIS GAME USES HOLISTIC VIEW';

export function standbyCopy(view: ScreenViewTarget, config: GameViewConfig): string | null {
  if (config.mode === 'holistic' && view !== 'holistic') {
    return HOLISTIC_STANDBY;
  }
  return null;
}

export function canStart(connectedCount: number, minPlayers: number): boolean {
  return connectedCount >= minPlayers;
}
