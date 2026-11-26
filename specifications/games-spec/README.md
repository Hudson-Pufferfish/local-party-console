# Games Specification Index (`games-spec/`)

> **AI Agent Instruction:** This directory contains the individual design and technical specifications for games running on the Party Console Platform (see `../SPEC.md` for core system architecture, transport, telemetry, and UI invariants).
>
> **CRITICAL EXTENSIBILITY MANDATE:** Currently, only **Sumo Dash** is specified as our v1 vertical slice and latency benchmark. However, **many additional games with vastly different genres, 2D/3D renderers, controller layouts, player/bot caps, and strict single-monitor or multi-monitor team view requirements will be added in the future.** Do **NOT** hardcode game-specific rules, physics loops, controller UIs, or camera logic into the core Console OS (`/server`, `/screen` shell, or `/controller` shell). Every game must be implemented as a self-contained, pluggable module registered via the shared `GameDefinition` contract.

---

## 1. Active Game Index

| ID | Game Title | Spec File | Status | Engine | Players / Bots | View Mode | Input Buffer Mode |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `sumo-dash` | **Sumo Dash** | [`./sumo-dash.md`](./sumo-dash.md) | **Live** *(heuristic bots)* | 2D (`Phaser 4`) | 2–8 humans + bots | `holistic` | `zero-buffer` |
| `bomb-pass` | **Bomb Pass** | [`./bomb-pass.md`](./bomb-pass.md) | **Live** *(heuristic bots)* | 2D (`Phaser 4`) | 2–8 humans + bots | `holistic` | `zero-buffer` |
| `color-clash` | **Color Clash** | [`./color-clash.md`](./color-clash.md) | **Live** *(heuristic bots)* | 2D (`Phaser 4`) | 2–8 humans + bots | `holistic` | `zero-buffer` |
| `cyber-citadel` | **Cyber-Citadel Defense** | [`./cyber-citadel.md`](./cyber-citadel.md) | **Design** *(spec only, not implemented)* | 2D (`Phaser 4`) | 1–8 humans + bots (co-op) | `holistic` | `zero-buffer` |

All active games are registered in the desktop host lobby carousel (`screen/src/register-games.ts`) and mount into the universal `<HolisticMatchShell>`.
Rows with status **Design** have a spec only. They are not registered in `screen/src/register-games.ts` or `controller/src/register-games.ts` yet.

---

## 2. The Extensibility Contract (Required for All Games)

A **GameDefinition** is the plugin: `GameManifest` + `GameSimulation` + `ScreenRenderer` + `ControllerView`. The manifest is data. The other three are code. Every game module exports all four:

### A. Declarative Manifest (`GameManifest`) & Strict Binary View Enforcement
Every game registers metadata so the Lobby Router, Team Manager, and Multi-Monitor Enforcer can configure rooms dynamically. **View mode is strictly binary (`holistic` OR `team-exclusive`)**—if a game concept supports both single-screen play and isolated multi-monitor team play, register them as two distinct game modes/manifests rather than mixing fallback logic inside one renderer:

```typescript
export type GameViewConfig =
  | {
      mode: 'holistic';
      inputBufferMode: 'zero-buffer' | 'adaptive-1tick';
    }
  | {
      mode: 'team-exclusive';
      requiredTeams: number; // Strictly enforced (e.g., 2 -> must have team-1 AND team-2 connected)
      allowHolisticSpectator: boolean; // If true, /holistic is allowed ONLY as a neutral scoreboard/radar
      inputBufferMode: 'zero-buffer' | 'adaptive-1tick';
    };

export interface GameManifest {
  id: string;
  title: string;
  minPlayers: number;
  maxPlayers: number; // Up to platform cap of 8
  supportsTeams: boolean;
  maxTeams: number;
  supportsBots: boolean;
  rendererType: 'phaser-2d' | 'three-3d';
  viewConfig: GameViewConfig;
  themeTokens: Record<string, string>; // Industrial Neo-Brutalist CSS variable overrides
}
```

* **Enforcement Invariants:**
  * **`mode: 'holistic'`:** Requires `/screen?view=holistic`. Any open `team-N` monitor tabs automatically display a standby state (`STANDBY — THIS GAME USES HOLISTIC VIEW`).
  * **`mode: 'team-exclusive'`:** The Lobby **Start Game** trigger is hard-locked until all `requiredTeams` viewports (`team-1..N`) are connected and heartbeating. If `allowHolisticSpectator === false`, any `/holistic` tab remains in standby to prevent accidental screen-peeking.

### B. Authoritative Simulation (`GameSimulation`)
* v1 runs one tick loop in the **host Chrome tab** (`Float32Array`). Other monitor tabs do not step physics. Stretch 2 moves the loop into a `SharedWorker` and a 128-byte-aligned `SharedArrayBuffer` (Rust/WASM).
* Pre-allocates a Struct-of-Arrays buffer for `MAX_PLAYERS = 8`. `step(dt)` allocates nothing.
* Consumes the 8-byte input via `applyInput(playerIndex, buttonsBitmask, axisX, axisY)`. v1 callers are human packets only. v1.1 heuristic bots and Stretch 4 ONNX bots use the same function.

### C. Decoupled Read-Only Viewport (`ScreenRenderer`)
* Mounted inside the `/screen` SolidJS `<canvas ref>` shell.
* Parameterized by the active viewport target (`'holistic'` or `'team-N'`) as dictated by the game's `GameViewConfig`.
* Strictly read-only. v1 reads `BroadcastChannel` snapshots from the host tab. Stretch 2 reads the shared buffer. The renderer never writes authoritative state. Hit-stop pauses drawing. It does not pause `step`.

### D. Morphing Phone Controller (`ControllerView`)
* Dynamically mounted by the `/controller` SolidJS shell upon receiving the `game:mount` control-plane event—zero page reloads.
* Built strictly from the 6 Industrial Neo-Brutalism primitives in `/shared/ui` (`<ArcadeButton/>`, `<VirtualJoystick/>`, `<SwipeZone/>`, `<PlayerBadge/>`, `<GameCard/>`, `<HudModal/>`), respecting the $\ge 36\text{px}$ iOS edge-gesture safe zone and zero-allocation `pointermove` hot path.
* Maps all player interactions into the fixed 8-byte binary packet (`Byte 5`: 8-bit button mask, `Bytes 6..7`: `Int8x2` quantized axes) without altering the underlying `GameTransport`.

---

## 3. Adding a New Game (Developer & Agent Checklist)

When introducing a new game to `games-spec/`:
1. Create `games-spec/<game-id>.md` defining:
   * Core gameplay loop, win/loss conditions, and round pacing.
   * `GameManifest` and strict `GameViewConfig` (`holistic` vs. `team-exclusive`, plus camera/fog-of-war rules for `team-exclusive` games).
   * Exact `Float32Array` flat-buffer memory layout per entity/player.
   * Phone controller layout and byte-level mapping for `Byte 5` (buttons) and `Bytes 6..7` (axes).
   * Bot rules only when `supportsBots` is true. `sumo-dash` sets `supportsBots: true`. The heuristic is in that file.
2. Add the game to the **Active Game Index** table above.
3. Register the game in `screen/src/register-games.ts` by adding an entry to the `screenGames` array (manifest and load function), and in `controller/src/register-games.ts` by calling `controllerGames.set()` with the manifest and controller View component.