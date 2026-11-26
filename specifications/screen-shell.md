# Screen Shell Architecture (`<HolisticMatchShell>`)

> **AI Agent Instruction:** This document is the platform contract for the reusable single-screen `/screen` match UI (`<HolisticMatchShell>`). Game modules (`games-spec/<id>.md`) own game rules, simulation state, score payloads, banner text, the arena renderer, and phone controllers. Game modules must **not** fork rejoin QR, match exit, scoreboard layout, or podium controls. Read [`SPEC.md`](./SPEC.md) for transport and simulation authority. Read [`games-spec/README.md`](./games-spec/README.md) for `GameDefinition`.

---

## 1. Purpose

Single-screen (`holistic`) party games share the same match frame on `/screen`. Sumo Dash, Bomb Pass, and Color Clash all render an `800x800` arena canvas surrounded by the same platform controls.

The platform bundles that shared match UI into one SolidJS component: **`<HolisticMatchShell>`** in `screen/src/components/holistic/holistic-match-shell.tsx`.

**Rule:** Game code supplies data and draws inside the arena canvas. `<HolisticMatchShell>` owns the layout and controls around the canvas.

---

## 2. `<HolisticMatchShell>` Anatomy

`<HolisticMatchShell>` renders `<section class="match" data-game={props.gameId}>` and bundles seven elements in fixed DOM order:

| # | Element | Source | Placement | Behavior |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **`MatchRejoinQr`** | `screen/src/score-rules.tsx` | Right column above `ScoreboardPanel` | Displays the borderless `128x128` room QR canvas with label `SCAN TO REJOIN`. Calls `onQr(canvas)` to reuse the lobby QR target. |
| 2 | **`MatchExitControl`** | `screen/src/match-exit.tsx` | Top-right `×` button | Visible when `canShowMatchExit(primary, match, manifest)` is true. Opens `ConfirmModal`, then calls `onExit()`. |
| 3 | **HUD banner** | `<p class="match-banner">` | Top row above arena | Renders game-authored status text (`props.banner`), such as countdowns, timers, or winner callouts. |
| 4 | **`ScoreRulesPanel` (guide lines and payout table) and `RoundRanking`** | `screen/src/score-rules.tsx` | Left column: `ScoreRulesPanel` (guide lines and payout table) and `RoundRanking` (live round ranking) under it | Mounted only when `props.scoreRules !== null` or `props.roundPanel !== null`. When the game provides `createRoundRanking`, both the guide and the live ranking appear. |
| 5 | **Arena `<canvas>`** | `<canvas width={800} height={800}>` | Center grid cell | Direct child of `.match` so `.match > canvas` rules in `screen/src/styles/match.css` apply unchanged. Calls `onMatchCanvas(canvas)` to attach the active `ArenaRenderer`. |
| 6 | **`ScoreboardPanel`** | `screen/src/score-rules.tsx` | Right of arena | Renders `props.scoreHeader` and match totals, sorted by total when the game provides `createRoundRanking`. Shows player color dot, label text, score, and optional `LIVE` / `AWAY` status badge. |
| 7 | **Podium buttons** | `<div class="podium">` | Bottom row below arena | Mounted only when `props.primary && props.matchOver`. Renders **`PLAY AGAIN`** (`onPlayAgain`) and **`RETURN TO LOBBY`** (`onExit`). |

Keep `<canvas width={800} height={800}>` as a direct child of `<section class="match">`. Existing CSS (`.match > canvas`) and tests rely on that selector so the rejoin QR canvas does not inherit arena sizing.

### Round Ranking Panel

Games that provide `createRoundRanking` in their `ScreenGameRuntime` (Color Clash and Sumo Dash) get a live round ranking panel under the guide on the left side. The panel shows:

- **Stage**: `idle` (practice or countdown), `live` (round running), or `final` (round over).
- During a live round: player rankings by the game metric (e.g. paint percent in Color Clash, live survival and bottom-up knockout locks in Sumo Dash), with a preview of points each place pays.
- At round end: the ranking freezes for 2.0 s, showing real earned points per player, then updates and re-sorts the right column by match total.
- During breaks and practice: the last round's final result stays visible, while `LIVE` / `AWAY` status updates in real time.

The `+N` values shown at round end are real, computed from the difference between totals before and after. The screen never shows a guessed payout.

AWAY players show the `AWAY` badge and rank normally by their real result. AWAY is display-only and does not change how players score or rank.

---

## 3. Component Seam (`HolisticMatchShellProps`)

```typescript
export interface HolisticMatchShellProps {
  gameId: string;
  primary: boolean;
  match: boolean;
  matchOver: boolean;
  manifest: GameManifest | undefined;
  banner: string;
  scoreHeader: string;
  scoreRows: readonly ScoreRow[];
  scoreRules: ScoreRules | null;
  roundPanel: RoundPanelOutput | null;
  onQr: (canvas: HTMLCanvasElement) => void;
  onMatchCanvas: (canvas: HTMLCanvasElement) => void;
  onExit: () => void;
  onPlayAgain: () => void;
}
```

### Data Flow

```text
Game module (games/<id>/src/screen-runtime.ts)
  -> ScreenGameRuntime hooks (createSim, createRenderer, scoreboardHeader, scoreboardRows, scoreRules, bannerCopy, rematchEventType, createRoundRanking)
  -> screen/src/session.ts (runs host loop, attaches canvas + QR, publishes Solid signals)
  -> screen/src/app.tsx (passes session signals and callbacks)
  -> screen/src/components/holistic/holistic-match-shell.tsx (<HolisticMatchShell>)
```

### Exit and Rematch Seams

- **Exit (`onExit`):** Calls `session.resetLobby()`. That single function tears down the renderer and host loop, clears match and lobby state, and sends `game:unmount` and `room:phase: lobby`.
- **Rematch (`onPlayAgain`):** Calls `session.playAgain()`. That function restarts the active game loop with the current roster, clears `matchOver`, and emits the game's `rematchEventType`.

Do not add per-game exit or rematch UI inside `games/<id>/`.

---

## 4. Ownership Boundaries

### Platform shell owns (`screen/src/`)

- Lobby carousel, game selection, bot controls, and `START` button (`lobby.tsx`, `register-games.ts`).
- Match layout and chrome (`components/holistic/holistic-match-shell.tsx`, `score-rules.tsx`, `match-exit.tsx`, `confirm-modal.tsx`, `styles/match.css`).
- Rejoin QR attachment, exit confirmation, and podium actions.
- Lazy loading of game runtimes via Vite dynamic `import()` in `screen/src/register-games.ts`.
- Round ranking panel model and timing (`round-panel-model.ts`).

### Game modules own (`games/<id>/src/`)

- Declarative `GameManifest` (`manifest.ts`), imported eagerly by `screen/src/register-games.ts`.
- Lazy `ScreenGameRuntime` factory (`screen-runtime.ts`) and optional game-specific CSS.
- Authoritative `GameSimulation` (`simulation.ts`) and optional heuristic bot policy (`heuristic.ts`).
- Read-only `ArenaRenderer` (`renderer.ts`) mounted onto the `800x800` canvas.
- Pure presentation mappers (`scoreboardHeader`, `scoreboardRows`, `scoreRules`, `bannerCopy`, `eventsFromHeaderDiff`) and `rematchEventType`.
- Optional `createRoundRanking` adapter for live round ranking and round-end freeze and transfer.
- Phone controller view (`controller.tsx`).

---

## 5. Integration Checklist for Single-Screen Games

Sumo Dash is the initial consumer of `<MatchShell>`. Bomb Pass and Color Clash mount into the same seam.

When adding a new single-screen game:

1. Export a `GameManifest` with `viewConfig.mode: 'holistic'` in `games/<id>/src/manifest.ts`.
2. Register the manifest eagerly and load `screen-runtime.ts` lazily with `import()` in `screen/src/register-games.ts`.
3. Implement `ScreenGameRuntime` hooks (`createSim`, `createRenderer`, `scoreboardHeader`, `scoreboardRows`, `scoreRules`, `bannerCopy`, `rematchEventType`, and optionally `createRoundRanking`).
4. Do **not** edit `screen/src/app.tsx` or `screen/src/components/holistic/holistic-match-shell.tsx` to add game-specific branches.
5. Set the simulation phase header to `MATCH_OVER` (`3`) when the match ends so `HostLoop` sets `matchOver` and `<HolisticMatchShell>` shows the podium buttons.
6. Cite this file from `specifications/games-spec/<id>.md` instead of restating match chrome rules.

---

## 6. Code Map

| Concern | Path |
| :--- | :--- |
| Reusable match shell | `screen/src/components/holistic/holistic-match-shell.tsx` |
| App composition | `screen/src/app.tsx` |
| Rejoin QR, rules, scoreboard, and round ranking panels | `screen/src/score-rules.tsx` |
| Round panel model (freeze and transfer timing) | `screen/src/round-panel-model.ts` |
| In-match exit control and modal | `screen/src/match-exit.tsx`, `screen/src/confirm-modal.tsx` |
| Match layout styles | `screen/src/styles/match.css` |
| Lazy game loader and `ScreenGameRuntime` | `screen/src/register-games.ts` |
| Host session and canvas binding | `screen/src/session.ts`, `screen/src/host-loop.ts` |
| Initial consumer (`sumo-dash`) | `games/sumo-dash/src/screen-runtime.ts` |

Cook plan: `plans/261125-0307-screen-host-infrastructure/`.
