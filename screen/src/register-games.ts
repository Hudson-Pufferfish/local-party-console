import { BOMB_PASS_MANIFEST } from '../../games/bomb-pass/src/manifest.ts';
import { COLOR_CLASH_MANIFEST } from '../../games/color-clash/src/manifest.ts';
import { SUMO_DASH_MANIFEST } from '../../games/sumo-dash/src/manifest.ts';
import type { Envelope } from '../../shared/src/types/envelope.ts';
import type { GameManifest, PlayerSlot } from '../../shared/src/types/game.ts';
import type { BotLevels, WriteBotInput } from './bot-fill.ts';
import type { ScreenSim } from './host-loop.ts';

export interface ArenaRenderer {
  draw(): void;
  destroy(): void;
}

export interface ScoreRow {
  readonly slot: number;
  readonly color: string;
  readonly name?: string;
  readonly score?: number | string;
  readonly text?: string;
  readonly status?: 'LIVE' | 'AWAY';
  readonly ratio?: number;
}

export interface ScoreRuleRow {
  readonly label: string;
  readonly value: string;
}

export interface ScoreRules {
  readonly rows: readonly ScoreRuleRow[];
}

export interface ScreenGameRuntime {
  createSim(): ScreenSim;
  eventsFromHeaderDiff?: (prev: Float32Array, next: Float32Array) => Envelope[];
  createRenderer?: (canvas: HTMLCanvasElement, readState: () => Float32Array, readAux?: () => Uint8Array | null) => ArenaRenderer;
  writeBotInput?: WriteBotInput;
  botLevels?: BotLevels;
  scoreboardHeader?: (state: Float32Array) => string;
  scoreboardRows?: (
    state: Float32Array,
    names: readonly string[],
    players?: readonly PlayerSlot[],
  ) => ScoreRow[];
  scoreRules?: (state: Float32Array) => ScoreRules | null;
  bannerCopy?: (state: Float32Array, names: readonly string[]) => string;
  rematchEventType?: string;
}

export interface ScreenGameEntry {
  readonly manifest: GameManifest;
  readonly load: () => Promise<ScreenGameRuntime>;
}

export interface ScreenGameLoader {
  register(entry: ScreenGameEntry): void;
  get(id: string): ScreenGameEntry | undefined;
  getLoaded(id: string): ScreenGameRuntime | undefined;
  load(id: string): Promise<ScreenGameRuntime>;
  preload(id: string): void;
  listManifests(): GameManifest[];
}

export function createScreenGameLoader(entries: readonly ScreenGameEntry[] = []): ScreenGameLoader {
  const registryMap = new Map<string, ScreenGameEntry>();
  const loaded = new Map<string, ScreenGameRuntime>();
  const inflight = new Map<string, Promise<ScreenGameRuntime>>();

  for (const entry of entries) {
    registryMap.set(entry.manifest.id, entry);
  }

  function load(id: string): Promise<ScreenGameRuntime> {
    const cached = loaded.get(id);
    if (cached !== undefined) return Promise.resolve(cached);

    const pending = inflight.get(id);
    if (pending !== undefined) return pending;

    const entry = registryMap.get(id);
    if (entry === undefined) {
      return Promise.reject(new Error(`Unknown game: ${id}`));
    }

    const promise = entry.load().then((runtime) => {
      loaded.set(id, runtime);
      inflight.delete(id);
      return runtime;
    }, (error: unknown) => {
      inflight.delete(id);
      throw error;
    });

    inflight.set(id, promise);
    return promise;
  }

  return {
    register(entry: ScreenGameEntry): void {
      registryMap.set(entry.manifest.id, entry);
    },
    get(id: string): ScreenGameEntry | undefined {
      return registryMap.get(id);
    },
    getLoaded(id: string): ScreenGameRuntime | undefined {
      return loaded.get(id);
    },
    load,
    preload(id: string): void {
      void load(id).catch(() => {});
    },
    listManifests(): GameManifest[] {
      return Array.from(registryMap.values()).map((entry) => entry.manifest);
    },
  };
}

export interface StartGuardOptions {
  load: (id: string) => Promise<ScreenGameRuntime>;
  onLoadingChange: (loading: boolean) => void;
  onError?: (error: unknown) => void;
}

export interface StartGuard {
  readonly loading: boolean;
  run: (
    id: string,
    canLaunch: () => boolean,
    launch: (runtime: ScreenGameRuntime) => void,
  ) => Promise<boolean>;
}

export function createStartGuard(options: StartGuardOptions): StartGuard {
  let loading = false;
  return {
    get loading() {
      return loading;
    },
    async run(
      id: string,
      canLaunch: () => boolean,
      launch: (runtime: ScreenGameRuntime) => void,
    ): Promise<boolean> {
      if (loading || !canLaunch()) return false;
      loading = true;
      options.onLoadingChange(true);
      try {
        const runtime = await options.load(id);
        if (!canLaunch()) return false;
        launch(runtime);
        return true;
      } catch (error: unknown) {
        options.onError?.(error);
        return false;
      } finally {
        loading = false;
        options.onLoadingChange(false);
      }
    },
  };
}

export const screenGames = createScreenGameLoader([
  {
    manifest: SUMO_DASH_MANIFEST,
    load: async () => {
      const mod = await import('../../games/sumo-dash/src/screen-runtime.ts');
      return mod.createSumoScreenRuntime();
    },
  },
  {
    manifest: BOMB_PASS_MANIFEST,
    load: async () => {
      const mod = await import('../../games/bomb-pass/src/screen-runtime.ts');
      return mod.createBombPassScreenRuntime();
    },
  },
  {
    manifest: COLOR_CLASH_MANIFEST,
    load: async () => {
      const mod = await import('../../games/color-clash/src/screen-runtime.ts');
      return mod.createColorClashScreenRuntime();
    },
  },
]);

export function listScreenManifests(): GameManifest[] {
  return screenGames.listManifests();
}
