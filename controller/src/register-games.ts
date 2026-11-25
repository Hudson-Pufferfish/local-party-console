import type { JSX } from '@solidjs/web';
import type { VoidComponent } from 'solid-js';
import { BombPassController } from '../../games/bomb-pass/src/controller-view.tsx';
import { BOMB_PASS_MANIFEST } from '../../games/bomb-pass/src/manifest.ts';
import { ColorClashController } from '../../games/color-clash/src/controller-view.tsx';
import { COLOR_CLASH_MANIFEST } from '../../games/color-clash/src/manifest.ts';
import { SumoController } from '../../games/sumo-dash/src/controller-view.tsx';
import { SUMO_DASH_MANIFEST } from '../../games/sumo-dash/src/manifest.ts';
import type { ControllerOrientation, GameManifest } from '../../shared/src/types/game.ts';

export interface ControllerViewProps {
  playerIndex: () => number;
  playerColor: () => string;
  connected: () => boolean;
  sendFastInput: (buffer: ArrayBufferView) => void;
  sendReliable: (payload: unknown) => void;
  onControlMessage?: (handler: (payload: unknown) => void) => () => void;
  requestFullscreen?: () => Promise<void>;
  orientation?: () => ControllerOrientation;
  manifest?: () => GameManifest;
}

export interface ControllerGameEntry {
  readonly manifest: GameManifest;
  readonly View: VoidComponent<ControllerViewProps>;
  readonly extraChrome?: VoidComponent<ControllerViewProps>;
}

export const controllerGames = new Map<string, ControllerGameEntry>();

export function registerControllerGame(entry: ControllerGameEntry): void {
  controllerGames.set(entry.manifest.id, entry);
}

export function listControllerManifests(): GameManifest[] {
  return Array.from(controllerGames.values()).map((entry) => entry.manifest);
}

export function lookupControllerEntry(id: string): ControllerGameEntry | undefined {
  return controllerGames.get(id);
}

export function clearControllerGames(): void {
  controllerGames.clear();
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
  const entry = controllerGames.get(gameId);
  return entry?.View ?? null;
}

export function renderControllerView(
  gameId: string,
  props: ControllerViewProps,
): JSX.Element {
  const entry = controllerGames.get(gameId);
  if (entry === undefined) return null;
  const Component = entry.View;
  return <Component {...props} />;
}
