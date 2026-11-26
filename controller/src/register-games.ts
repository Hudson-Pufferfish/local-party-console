import type { JSX } from '@solidjs/web';
import type { VoidComponent } from 'solid-js';
import { BOMB_PASS_MANIFEST } from '../../games/bomb-pass/src/manifest.ts';
import { COLOR_CLASH_MANIFEST } from '../../games/color-clash/src/manifest.ts';
import { CYBER_CITADEL_MANIFEST } from '../../games/cyber-citadel/src/manifest.ts';
import { LAST_LIGHT_MANIFEST } from '../../games/last-light/src/manifest.ts';
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

export interface ControllerGameEntry {
  readonly manifest: GameManifest;
  readonly load: () => Promise<VoidComponent<ControllerViewProps>>;
}

export interface ControllerGameLoader {
  readonly entries: Map<string, ControllerGameEntry>;
  register(entry: ControllerGameEntry): void;
  get(id: string): ControllerGameEntry | undefined;
  getLoaded(id: string): VoidComponent<ControllerViewProps> | undefined;
  load(id: string): Promise<VoidComponent<ControllerViewProps>>;
}

export function createControllerGameLoader(
  initial: readonly ControllerGameEntry[] = [],
): ControllerGameLoader {
  const entries = new Map<string, ControllerGameEntry>();
  const loaded = new Map<string, VoidComponent<ControllerViewProps>>();
  const inflight = new Map<string, Promise<VoidComponent<ControllerViewProps>>>();

  for (const entry of initial) {
    entries.set(entry.manifest.id, entry);
  }

  function load(id: string): Promise<VoidComponent<ControllerViewProps>> {
    const cached = loaded.get(id);
    if (cached !== undefined) return Promise.resolve(cached);

    const pending = inflight.get(id);
    if (pending !== undefined) return pending;

    const entry = entries.get(id);
    if (entry === undefined) {
      return Promise.reject(new Error(`Unknown controller game: ${id}`));
    }

    const promise = entry.load().then(
      (View) => {
        loaded.set(id, View);
        inflight.delete(id);
        return View;
      },
      (error: unknown) => {
        inflight.delete(id);
        throw error;
      },
    );

    inflight.set(id, promise);
    return promise;
  }

  return {
    entries,
    register(entry: ControllerGameEntry): void {
      entries.set(entry.manifest.id, entry);
    },
    get(id: string): ControllerGameEntry | undefined {
      return entries.get(id);
    },
    getLoaded(id: string): VoidComponent<ControllerViewProps> | undefined {
      return loaded.get(id);
    },
    load,
  };
}

export const controllerGameLoader = createControllerGameLoader([
  {
    manifest: SUMO_DASH_MANIFEST,
    load: async () => {
      const mod = await import('../../games/sumo-dash/src/controller-view.tsx');
      return mod.SumoController;
    },
  },
  {
    manifest: BOMB_PASS_MANIFEST,
    load: async () => {
      const mod = await import('../../games/bomb-pass/src/controller-view.tsx');
      return mod.BombPassController;
    },
  },
  {
    manifest: COLOR_CLASH_MANIFEST,
    load: async () => {
      const mod = await import('../../games/color-clash/src/controller-view.tsx');
      return mod.ColorClashController;
    },
  },
  {
    manifest: LAST_LIGHT_MANIFEST,
    load: async () => {
      const mod = await import('../../games/last-light/src/controller-view.tsx');
      return mod.LastLightController;
    },
  },
  {
    manifest: CYBER_CITADEL_MANIFEST,
    load: async () => {
      const mod = await import('../../games/cyber-citadel/src/controller-view.tsx');
      return mod.CyberCitadelController;
    },
  },
]);

export const controllerGames = controllerGameLoader.entries;

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

export function controllerView(gameId: string): VoidComponent<ControllerViewProps> | null {
  return controllerGameLoader.getLoaded(gameId) ?? null;
}

export function loadControllerView(gameId: string): Promise<VoidComponent<ControllerViewProps>> {
  return controllerGameLoader.load(gameId);
}

export function controllerSupportedOrientations(
  gameId: string,
): readonly ControllerOrientation[] | undefined {
  return controllerGames.get(gameId)?.manifest.supportedOrientations;
}
