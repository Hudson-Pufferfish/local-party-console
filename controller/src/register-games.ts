import type { JSX } from '@solidjs/web';
import type { VoidComponent } from 'solid-js';
import { BombPassController } from '../../games/bomb-pass/src/controller-view.tsx';
import { BOMB_PASS_MANIFEST } from '../../games/bomb-pass/src/manifest.ts';
import { ColorClashController } from '../../games/color-clash/src/controller-view.tsx';
import { COLOR_CLASH_MANIFEST } from '../../games/color-clash/src/manifest.ts';
import { SumoController } from '../../games/sumo-dash/src/controller-view.tsx';
import { SUMO_DASH_MANIFEST } from '../../games/sumo-dash/src/manifest.ts';
import type { ControllerOrientation, GameManifest } from '../../shared/src/types/game.ts';
import type { PadStatePayload } from '../../shared/src/types/game-control.ts';

export interface ControllerControl {
  type: string;
  payload: unknown;
}

export interface ControllerViewProps {
  color: string;
  name: string;
  slot: number;
  control: ControllerControl | null;
  padState?: PadStatePayload | null;
  onAxes: (x: number, y: number, timeStamp: number) => void;
  onButton: (down: boolean, timeStamp: number, buttonIndex?: number) => void;
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

controllerGames.set(BOMB_PASS_MANIFEST.id, {
  manifest: BOMB_PASS_MANIFEST,
  View: BombPassController,
});

controllerGames.set(COLOR_CLASH_MANIFEST.id, {
  manifest: COLOR_CLASH_MANIFEST,
  View: ColorClashController,
});

export function controllerView(gameId: string): VoidComponent<ControllerViewProps> | null {
  return controllerGames.get(gameId)?.View ?? null;
}

export function controllerSupportedOrientations(
  gameId: string,
): readonly ControllerOrientation[] | undefined {
  return controllerGames.get(gameId)?.manifest.supportedOrientations;
}
