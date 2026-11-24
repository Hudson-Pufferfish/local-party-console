import type { JSX } from '@solidjs/web';
import type { VoidComponent } from 'solid-js';
import { SumoController } from '../../games/sumo-dash/src/controller-view.tsx';
import { SUMO_DASH_MANIFEST } from '../../games/sumo-dash/src/manifest.ts';
import type { GameManifest } from '../../shared/src/types/game.ts';

export interface ControllerControl {
  type: string;
  payload: unknown;
}

export interface ControllerViewProps {
  color: string;
  name: string;
  slot: number;
  control: ControllerControl | null;
  onAxes: (x: number, y: number, timeStamp: number) => void;
  onButton: (down: boolean, timeStamp: number) => void;
}

export interface ControllerGame {
  manifest: GameManifest;
  View: VoidComponent<ControllerViewProps>;
}

export const controllerGames = new Map<string, ControllerGame>();

export type ThemeVars = JSX.CSSProperties;

export function localTheme(gameId: string): ThemeVars {
  const game = controllerGames.get(gameId);
  if (game === undefined) return {};
  const theme: ThemeVars = {};
  const tokens = game.manifest.themeTokens;
  for (const [key, value] of Object.entries(tokens)) {
    if (!key.startsWith('--') || typeof value !== 'string') continue;
    theme[key as `-${string}`] = value;
  }
  return theme;
}

controllerGames.set(SUMO_DASH_MANIFEST.id, {
  manifest: SUMO_DASH_MANIFEST,
  View: SumoController,
});

export function controllerView(gameId: string): VoidComponent<ControllerViewProps> | null {
  return controllerGames.get(gameId)?.View ?? null;
}
