import type { GameManifest } from './types/game';

export const PLAYER_COLORS = [
  '#FF4D00',
  '#00C853',
  '#F5C518',
  '#E10600',
  '#FF2BD6',
  '#00B7C2',
  '#111111',
  '#F4F1EA',
] as const;

export class GameRegistry {
  readonly #ids: string[] = [];
  readonly #manifests = new Map<string, GameManifest>();

  register(manifest: GameManifest): void {
    if (!this.#manifests.has(manifest.id)) {
      this.#ids.push(manifest.id);
    }
    this.#manifests.set(manifest.id, manifest);
  }

  list(): GameManifest[] {
    const manifests: GameManifest[] = [];
    for (const id of this.#ids) {
      const manifest = this.#manifests.get(id);
      if (manifest !== undefined) {
        manifests.push(manifest);
      }
    }
    return manifests;
  }

  get(id: string): GameManifest | undefined {
    return this.#manifests.get(id);
  }
}
