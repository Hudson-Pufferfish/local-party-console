# Color Clash (`color-clash`) — Territory Painter Game Specification

> **AI Agent Instruction:** Read `../SPEC.md` and `./README.md` before implementing this module. **Color Clash** is Game #1 (a fast territory-painting arena game). Implement it strictly as a self-contained plugin under `/games/color-clash` conforming to `GameDefinition`. Zero game-specific logic may leak into `/server`, `/screen`, or `/controller` shells.

---

## 1. Overview & `GameManifest` Contract

**Color Clash** is a 2-to-8 player top-down 2D territory painter. Neo-Brutalist pucks glide across a square matte studio floor and stamp their player color onto a $40 \times 40$ paint grid (`1,600` cells). Players trigger a 3-second **BOOST** charge to carve a wide paint trail across unpainted tiles and steal rival turf. Matches run in a multi-round format with 45-second scored rounds until a player reaches the match target. There is no elimination. The player who owns the highest percentage of the grid when the clock hits zero wins the round. A tie for first place triggers a **30-second Tiebreak Sudden Death (`OVERTIME`)** with a Golden Tile instant-win objective or most painted cells at expiry.

### Declarative Manifest (`manifest.ts`)
```typescript
import { APP_THEME } from '../../../shared/src/theme.ts';
import type { GameManifest } from '../../../shared/src/types/game.ts';

export const COLOR_CLASH_MANIFEST: GameManifest = {
  id: 'color-clash',
  title: 'COLOR CLASH',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: true, // Heuristic policy lives in heuristic.ts.
  rendererType: 'phaser-2d',
  viewConfig: {
    mode: 'holistic',
    inputBufferMode: 'zero-buffer',
  },
  supportedOrientations: ['portrait', 'landscape'],
  themeTokens: {
    '--bg-surface': '#F4F1EA',      // Matte Studio Paper
    '--ink-primary': '#111111',     // Industrial Carbon
    '--arena-plate': '#CFC9BE',     // Neutral Concrete Canvas (contrasts with P7 #111111 and P8 #F4F1EA)
    '--grid-unpainted': '#CFC9BE',  // Unclaimed Tile Fill
    '--grid-line': '#B8B1A4',       // Subtle Matte Grid Seam
    '--accent-boost': APP_THEME.yellow,        // #F5C518 Signal Yellow (BOOST active ring & bar)
    '--accent-golden': APP_THEME.yellowBright, // #FFE14D Spark Yellow (Overtime Golden Tile)
    '--accent-hazard': APP_THEME.yellowDeep,   // #C88A00 Ochre Yellow (final 10s timer pulse)
    '--accent-ready': '#00C853',    // Hardware LED Green (BOOST ready indicator)
    '--accent-splash': '#FF4D00',   // Vibrant Paint Accent (fallback splash chrome)
  },
};
```

> **Color Palette Invariant:** Player paint colors come strictly from `PLAYER_COLORS` (`P1`–`P8`: `#FF4D00`, `#00C853`, `#2979FF`, `#E10600`, `#FF2BD6`, `#00B7C2`, `#111111`, `#F4F1EA`). Yellow stays reserved for global app chrome, `BOOST` feedback, and the `OVERTIME` Golden Tile. `--grid-unpainted` (`#CFC9BE`) keeps strong visual contrast against both `P7` (`#111111`) and `P8` (`#F4F1EA`).

---

## 2. Functional Requirements (FR)

### FR-1: Arena & $40 \times 40$ Paint Grid Geometry
* **Coordinate Space:** Authoritative 2D square arena centered at $(0, 0)$ in world units.
* **Arena Dimensions:**
  * Side length: $W = H = 800\text{ units}$ ($x \in [-400, +400]$, $y \in [-400, +400]$).
  * Grid resolution: $G = 40$ columns $\times$ $40$ rows (`1,600` total cells).
  * Cell size: $S_{\text{cell}} = \frac{800}{40} = 20\text{ units}$ per cell.
* **World-to-Grid Mapping:**
  * Column index: $\text{col} = \text{clamp}\left(\left\lfloor\frac{x + 400}{20}\right\rfloor,\ 0,\ 39\right)$.
  * Row index: $\text{row} = \text{clamp}\left(\left\lfloor\frac{y + 400}{20}\right\rfloor,\ 0,\ 39\right)$.
  * Linear cell index: $c = \text{row} \times 40 + \text{col} \in [0, 1599]$.
  * Cell center in world coordinates: $c_x = -400 + (\text{col} + 0.5) \times 20$, $c_y = -400 + (\text{row} + 0.5) \times 20$.
* **Cell Ownership Encoding (`Uint8Array`):**
  * `0` = Unpainted (`--grid-unpainted`).
  * `1..8` = Owned by player slot `value - 1` (`P1`–`P8`).
  * Any active puck can paint over both unpainted cells (`0`) and opponent-owned cells (`!= slot + 1`).
* **Boundary Containment:**
  * Every tick, contain every active puck inside the square arena with `clampBoxBoundary(body, 800, 800, r_puck, 0.35)` from `@shared/physics-2d` (`shared/src/physics-2d/boundary.ts`).
  * Apply `clampBoxBoundary` after motion integration and again after puck-to-puck collision separation so no puck ever leaves $[-376, +376]$.
* **Spawn Formation:**
  * Active players $N \in [2, 8]$ spawn equidistantly on a circle of radius $R_{\text{spawn}} = 260\text{ units}$, facing inward toward $(0, 0)$:
    $$\theta_i = \frac{2\pi i}{N}, \quad (x_i, y_i) = (R_{\text{spawn}}\cos\theta_i,\ R_{\text{spawn}}\sin\theta_i)$$
  * The grid starts 100% unpainted (`0`) during `COUNTDOWN`. Stamping starts on tick 1 of `ROUND_ACTIVE`.

### FR-2: Puck Movement, Steering & Collisions
* **Puck Physical Constants:**
  * Physical radius: $r_{\text{puck}} = 24\text{ units}$.
  * Base mass: $m = 1.0$.
  * Normal max steering acceleration: $a_{\text{move}} = 1900\text{ units/s}^2$.
  * Linear drag: $\mu = 4.5\text{ s}^{-1}$, integrated with `integrateMotion(body, dt, 4.5)` from `@shared/physics-2d`.
  * Normal max speed: $v_{\max} = 400\text{ units/s}$.
  * Wall bounce restitution: $e_{\text{wall}} = 0.35$ (passed to `clampBoxBoundary`).
* **Deadzone & Heading:**
  * Clamp joystick magnitude $\|\vec{u}\| < 0.12$ to $(0, 0)$ to remove thumb jitter.
  * Update facing `angle` smoothly toward any non-zero steering vector; hold the last angle when idle.
* **Puck-to-Puck Collisions:**
  * Resolve pairwise overlaps with `resolveCircleBufferPairs` from `@shared/physics-2d` using restitution $e = 0.75$ and equal mass.
  * **Boost Shove:** When a boosting puck (`boostActiveTimer > 0`) hits a non-boosting puck, scale the non-boosting puck's knockback impulse by **$1.35\times$** and set `hitStopFrames = 2` (visual freeze only; simulation keeps stepping).
  * **Mutual Boost Clash:** When two boosting pucks collide, scale both recoil impulses by **$1.25\times$** and set `hitStopFrames = 2`.
  * Collisions never eliminate a puck. They only contest lanes and paint space.

### FR-3: Boost Mechanic (3-Second Wide-Trail Paint Charge) & Cell Stamping
* **Trigger:** Rising edge of `BOOST` (`Bit 0` transitions `0 -> 1`) while `boostCooldown <= 0`, `boostActiveTimer <= 0`, and the puck is active during `ROUND_ACTIVE` or `OVERTIME`.
* **Boost Timers:**
  * `boostActiveTimer` sets to $3.00\text{s}$ and counts down linearly to $0$.
  * `boostCooldown` sets to $8.00\text{s}$ and counts down linearly to $0$ (leaving $5.00\text{s}$ of recharge after the 3-second charge ends).
* **Boost Effects (while `boostActiveTimer > 0`):**
  * Paint stamp radius expands from normal $r_{\text{paint}} = 24\text{ units}$ to wide-trail $r_{\text{boost}} = 54\text{ units}$ (~$2.25\times$ width, covering ~21 cells per stamp instead of ~5).
  * Max speed increases to $v_{\text{boost}} = 560\text{ units/s}$ and steering acceleration increases to $a_{\text{boost}} = 2400\text{ units/s}^2$.
  * Steering authority stays at $85\%$ so players can steer wide paint arcs around corners.
  * Sets `BOOSTING` flag (`Bit 1`) on the player's `flags` field.
* **Paint Stamping & Cell Overlap Resolution:**
  * On every `ROUND_ACTIVE` and `OVERTIME` tick, compute each active puck's stamp radius $r_s$ (`54` if boosting, else `24`).
  * Bound the candidate cells to $[\text{col}_{\min}, \text{col}_{\max}] \times [\text{row}_{\min}, \text{row}_{\max}]$ around $(x_i, y_i) \pm r_s$.
  * A puck covers cell $c$ when $(c_x - x_i)^2 + (c_y - y_i)^2 \le r_s^2$.
  * At 120Hz, maximum travel per tick is $\frac{560}{120} \approx 4.67\text{ units} \ll 20\text{ units}$, so single-tick disc stamping leaves zero trail gaps.
  * **Simultaneous Cell Overlap Rule (Order-Independent):** Maintain two pre-allocated scratch arrays (`cellStampTick: Int32Array(1600)` and `cellStampDistSq: Float32Array(1600)`, plus `cellStampBoost: Uint8Array(1600)`). If two or more pucks cover the same cell $c$ on the same `tickId`:
    1. A boosting puck (`boostActiveTimer > 0`) beats a non-boosting puck.
    2. If both have the same boost state, the puck with the strictly smaller squared distance to cell center $(c_x, c_y)$ wins the cell.
    3. If squared distances are equal, the lower slot index wins.
  * **Incremental Ownership Accounting:** Maintain `cellCounts: Uint16Array(8)` in $O(1)$ per cell change. When `grid[c]` changes from `oldOwner` to `newOwner`:
    * If `oldOwner > 0`, decrement `cellCounts[oldOwner - 1]`.
    * Increment `cellCounts[newOwner - 1]`.
    * Write `grid[c] = newOwner`.
    * Sync `paintPct = (cellCounts[i] * 100) / 1600` into each player's state stride at the end of the tick. (Internal cell counts are tracked in `cellCounts`, while `[base + 9]` stores accumulated match points).

### FR-4: Multi-Round Match Flow, Scoring, Tiebreak Sudden Death & Podium
* **Multi-Round Match Structure:**
  1. **`PRACTICE` (`phaseEnum = 4`):**
     * Matches open with `30.0s` (`practiceInitial`) of practice on the arena (move and boost freely; zero points awarded).
     * After a scored round where no player reached the match target, play enters a `20.0s` (`practiceBreak`) break before the next countdown.
     * When the practice timer expires, all players reset onto the spawn circle and enter `COUNTDOWN`.
  2. **`COUNTDOWN` (`phaseEnum = 0`, `3.0s`):** Pucks stand locked on the spawn circle. The $40 \times 40$ grid is blank. The top banner displays `3`, `2`, `1`.
  3. **`ROUND_ACTIVE` (`phaseEnum = 1`, `45.0s`):** Physics, paint stamping, and `BOOST` are live. The scoreboard displays each player's points and match threshold.
  4. **End-of-Round Evaluation (`phaseTimer <= 0`):**
     * Find `maxCells = max(paintCells[i])` across joined slots.
     * Count how many joined slots hold `paintCells[i] === maxCells`.
     * **Unique Leader (`leaderCount === 1`):** Set `winnerSlot` to the leader and transition to `ROUND_END` (`0.8s`).
     * **Tie for First Place (`leaderCount >= 2`):** Transition directly to **Tiebreak Sudden Death (`OVERTIME`, `30.0s`)**.
  5. **Tiebreak Sudden Death (`OVERTIME`, `phaseEnum = 5`, `30.0s`):**
     * Set `CONTENDER` (`Bit 3`) on every tied leader and keep them active.
     * Park all non-tied players off-arena (`ACTIVE = 0`, `CONTENDER = 0`) so non-contenders cannot kingmake. Their existing painted cells stay frozen on the grid (contenders can paint over them).
     * Keep all painted territory on the grid. Reset contender `boostCooldown = 0` and `boostActiveTimer = 0` so tied leaders enter overtime on equal footing.
     * **Golden Tile Spawn:** Deterministically choose one `goldenCell` index $\in [0, 1599]$ inside the inner arena (`col ∈ [6, 33]`, `row ∈ [6, 33]`) that maximizes minimum distance to all contender pucks, breaking ties deterministically by `(tickId + cellIndex) % 1600`. Store `goldenCell` in header `[4]`.
     * **Instant Win (Golden Tile):** The first contender puck whose normal or boosted stamp disc covers `goldenCell` claims it immediately, sets `winnerSlot = i`, sets `hitStopFrames = 2`, and transitions to `ROUND_END`.
     * **Overtime Expiry (`phaseTimer <= 0`):** If no contender claimed the Golden Tile in `30.0s`, compare `paintCells` among contenders only. The contender with the most painted cells wins. If contenders still tie on exact `paintCells`, the contender who reached that cell count earliest (`lastPeakTick`) wins; if still tied, the lower slot index wins. Set `winnerSlot` and transition to `ROUND_END`.
  6. **`ROUND_END` (`phaseEnum = 2`, `0.8s`):**
     * Freeze puck velocities and award round points.
     * **Point Allocation:** For $N$ joined players, 1st place (`winnerSlot`) receives $N - 1$ points. Other players receive points ranked by cell coverage ($N - 1 - \text{better}$).
     * **Match Target:** `targetScore = max(3, (N - 1) * 3)`.
     * **Decisive Sudden Death:** If multiple players tie at or above the threshold (`score >= targetScore`), the match enters Sudden Death: non-contenders below the top score are parked off-arena (`FLAG_ACTIVE = 0`), and only tied leaders take the floor. Each subsequent sudden death round awards `+1` point exclusively to the round winner (`winnerSlot`) until one unique leader emerges.
     * If one unique player satisfies `score >= targetScore`, transition to `MATCH_OVER`.
     * Otherwise, transition to `PRACTICE` (`20.0s` break) before the next round.
  7. **`MATCH_OVER` (`phaseEnum = 3`):** Present final match results and standings alongside host **PLAY AGAIN** and **RETURN TO LOBBY** controls.

### FR-5: Phone Controller Layout & Feedback
* **Orientation:** Supports both `portrait` and `landscape` via the platform controller stage.
* **Controls (Strict `/shared/ui` Primitives Only):**
  * **Top Bar:** `<PlayerBadge/>` displaying slot (`P1`–`P8`) and player name, paired with a **Paint Color Splash Indicator** (crisp `2.5px solid #111111` Neo-Brutalist paint-splatter swatch filled with `var(--player-color)` that stamps a solid yellow rim while `BOOST` is active) and tabular percentage + boost readout (`24.5% · READY`, `24.5% · BOOSTING`, `24.5% · RECHARGE`, or `OVERTIME`).
  * **Left Zone:** `<VirtualJoystick label="MOVE"/>` mapping continuous steering to `Int8` `[-127, 127]` (`Bytes 6..7`).
  * **Right Zone:** Oversized `<ArcadeButton label="BOOST"/>` mapped to `Bit 0` (`Byte 5`, `hapticMs: 20`), paired with a hard-edged charge/cooldown meter (`3.0s` active yellow drain bar followed by `5.0s` recharge fill bar).
* **Feedback & Haptics:**
  * Local press starts the visual charge/cooldown bar immediately when ready to avoid extra network traffic; host `color:boost` and `color:match_start` / `color:overtime` control-plane messages keep state synchronized.
  * The local `BOOST` tap (`hapticMs: 20`) owns the press buzz through `navigator.vibrate()` or the iOS switch Taptic fallback.
  * On boost shove impact or Golden Tile capture, the host sends `color:haptic` (`'heavy' | 'golden'`) and the phone plays `navigator.vibrate()` / iOS Taptic switch feedback.
  * All interactive targets stay inset **$\ge 36\text{px}$** from screen edges with `setPointerCapture`. Zero continuous `rAF` loops on the phone.

### FR-6: Disconnect & Mid-Match Rejoin (`SCAN TO REJOIN`)
* If a phone disconnects or stops sending input (`>= 100ms` silence), the host loop zeroes that slot's `axisX`, `axisY`, and `buttons`. The scoreboard marks that human slot `AWAY`.
* The disconnected puck decelerates naturally to rest under drag (`4.5 s⁻¹`) and stays on the arena.
* **Territory Persistence:** All grid cells already painted by that player **remain claimed**. Opponents may paint over those cells during normal play, and any cells still owned by the disconnected player count toward their final percentage and rank. Rejoin never clears, resets, or rewrites the paint grid.
* **In-Match Rejoin QR (shared `/screen` chrome):** During `PRACTICE` / `COUNTDOWN` / `ROUND_ACTIVE` / `OVERTIME` / `ROUND_END` / `MATCH_OVER`, the primary holistic host tab keeps the shared top-left `<MatchRejoinQr/>` panel (`screen/src/score-rules.tsx`) labeled **`SCAN TO REJOIN`**. The QR targets the same room controller URL as the lobby. Color Clash must not invent a game-private rejoin QR.
* **`sessionToken` Restore (LIVE-at-start only):** A phone that was **LIVE (connected) when the host started the match** stores its `sessionToken` in `localStorage` and may reconnect mid-match by scanning the rejoin QR (or refreshing). The relay restores that exact slot index, name, color, boost timers, and painted territory; control resumes immediately. The puck is never replaced by a bot.
* **Rejected Joiners (`MATCH_IN_PROGRESS`):** Strangers with no valid token, unknown/forged tokens, and players who were **lobby-`AWAY` (disconnected) at match start** (not in the relay `activeMatchSlots` set) receive `room:rejected` with reason `MATCH_IN_PROGRESS` and the controller notice `MATCH IN PROGRESS — CANNOT JOIN MID-GAME`. They do not gain a slot, paint cells, or input path.
* No bot replaces a disconnected human slot.

### FR-7: Industrial Neo-Brutalist Visuals & Game Feel (Zero Art Assets)
* All visuals render procedurally in Phaser 4 (`Graphics` + a single pre-allocated `40 × 40` offscreen canvas texture blitted crisp with nearest-neighbor scaling so 1,600 tiles render in 1 draw call at 120fps):
  * Matte Studio Paper outer frame (`#F4F1EA`) with a thick `4px #111111` square arena wall and corner registration marks.
  * Unpainted tiles use `--grid-unpainted` (`#CFC9BE`) separated by crisp `1px` `--grid-line` seams (`#B8B1A4`).
  * Painted tiles use solid `PLAYER_COLORS[owner - 1]` fills with zero alpha blur. For `P8` (`#F4F1EA`), render a subtle `1px #111111` corner tick inside painted cells so bright white paint stays razor-sharp against the matte paper chrome.
  * Each puck renders with its `PLAYER_COLORS[i]` fill, `3px #111111` border, hard offset shadow (`+5px, +5px`), directional paint-roller nose bar, and a radial `BOOST` charge/cooldown arc around its rim.
  * **Boost Visuals:** While `boostActiveTimer > 0`, draw a solid dashed `--accent-boost` (`#F5C518`) outer brush-radius ring (`54` units) and emit pooled hard-edged square paint-drop particles (no blur, zero per-frame allocations).
  * **Overtime Golden Tile:** Render the target cell with a bold `--accent-golden` (`#FFE14D`) fill, pulsing `3px #111111` crosshair brackets, and a corner star mark.
  * **Hit-Stop & Shake:** Boost collisions and Golden Tile capture set `hitStopFrames = 2` (visual freeze only; `step(dt)` keeps running) and a soft subpixel shake capped at `0.5px` (`0.5 -> 0.25 -> 0`).

### FR-8: In-Match Host Exit (`MatchExitControl` → `resetLobby`)
* Color Clash is `viewConfig.mode: 'holistic'`, so it is a single-screen game under the shared `/screen` exit policy (`canShowMatchExit` / `isSingleScreenGame` in `screen/src/match-exit.tsx`).
* During an active match on the **primary** host tab, the shared top-right **`[×]`** `<MatchExitControl/>` is visible. Secondary holistic tabs and lobby phase hide it.
* Host taps `[×]` → shared confirm modal (`QUIT MATCH?` / `QUIT TO LOBBY`) → on confirm calls **`session.resetLobby()`** (unselects game, resets bots/match/scores, tears down the renderer, broadcasts unmount + lobby phase). Cancel closes the modal and leaves the match running.
* **Do not invent a Color-Clash-only exit control, confirm dialog, or teardown path.** Consume the shared screen infrastructure (item #104: `screen/src/match-exit.tsx` `MatchExitControl` + `session.resetLobby()`). Multi-screen (`team-exclusive`) coordinated exit is out of scope for this holistic game and remains a platform TODO on the shared seam.
* Podium **RETURN TO LOBBY** on `MATCH_OVER` also calls `session.resetLobby()`; **PLAY AGAIN** uses the existing rematch path (`color:rematch` / `playAgain`) and must not duplicate exit teardown.

### Heuristic Bot
An empty bot slot calls `applyInput(botIndex, buttons, axisX, axisY)` at 60Hz inside the host loop (evaluated on even `tickId` ticks and held on odd ticks). Skill levels use the shared `1..100` scale (`LEVEL_SCALE = 100`) drawn without replacement via `assignBotScores` (`easy: 11..20`, `medium: 30..50`, `hard: 50..70`). `share = skill / 100`, `nerf(base, mult, share) = base + share * mult`. Zero heap allocations inside `writeHeuristic`.

1. **Overtime Golden Tile Priority:** During `OVERTIME` (`phaseEnum === 4`) when `goldenCell >= 0` and the bot is a contender (`(flags & 8) !== 0`), aim directly at the Golden Tile center `(gx, gy)`. Fire `BOOST` (`Bit 0 = 1`) when `boostCooldown <= 0`, distance `> 80` units, and heading alignment `dot > 0.85`.
2. **Coarse $8 \times 8$ Sector Scan:** Divide the $40 \times 40$ grid into `64` sectors of $5 \times 5$ cells. For each sector, count `unpainted` cells (`0`) and `opponent` cells (`!= 0 && != botIndex + 1`). Score each sector with:
   $$\text{value} = \frac{\text{unpainted} \cdot 1.0 + \text{opponent} \cdot w_{\text{opp}}}{\text{dist} + 160}$$
   where $w_{\text{opp}} = \text{nerf}(0.75, 0.70, \text{share})$ so higher-skill bots aggressively paint over rival territory while lower-skill bots prefer open canvas. Keep the sector with the highest value (lower sector index breaks ties).
3. **Steering & Wall Margin:** Clamp the chosen sector center to `[-350, +350]` to prevent wall grinding. Turn the steer angle by a small slot-sided wobble of $\text{nerf}(0.26, -0.22, \text{share})$ radians. Scale stick magnitude to $\text{nerf}(0.55, 0.45, \text{share})$ of full `127`.
4. **Dense-Cluster `BOOST` Trigger:** Sample the $5 \times 5$ cell cluster (`25` cells) centered `80` units ahead along the bot's steering vector. Count non-owned cells (`grid[c] !== botIndex + 1`). Fire `BOOST` (`Bit 0 = 1`) when `boostCooldown <= 0`, non-owned count $\ge \text{Math.round}(\text{nerf}(18, -6, \text{share}))$ (`12..18` cells), and alignment clears $\text{nerf}(0.92, -0.12, \text{share})$.

### Scoreboard, Round End & Match Over
* **Scoreboard Header:** Displays `THRESHOLD: X` or `SUDDEN DEATH` (or `OVERTIME MM:SS` during golden tile sudden death).
* **Guide Lines and Payout Table (`ScoreRulesPanel`):** Left column always shows four guide lines (how to steer, boost duration and recharge, round win condition, and overtime rule) plus the rank payout table (`1ST: +(N-1) PTS`, `2ND: +(N-2) PTS`, etc., or `+1 PTS` in sudden death).
* **Live Round Ranking (`RoundRanking`):** Under the guide, shows real-time ranking by paint percent during rounds, with a preview of points each place pays. At round end, the ranking freezes for 2.0 s with real earned points (`+N`), then the `+N` values transfer into the right column totals (0.6 s animation), and the right column re-sorts by total. During breaks, shows the last round's final result.
* **Right Column Match Totals (`ScoreboardPanel`):** Shows threshold header and player rows sorted by total (highest first, ties by slot), with player puck color circle, short tag, match score, and connection status badge (`LIVE` / `AWAY`). When a round is transferring, each row briefly shows an incoming `+N` chip.
* **Top Banner (`bannerCopy`):** Shows `BREAK X` during practice, `3`, `2`, `1` during `COUNTDOWN`, `OVERTIME — CLAIM GOLDEN TILE` on overtime start, `POINT` during `ROUND_END`, and `<TAG> WINS` on `MATCH_OVER`.

---

## 3. Non-Functional Requirements (NFR)

| Category | Requirement | Target / Enforcement |
| :--- | :--- | :--- |
| **Fixed Timestep Determinism** | Physics and grid stamping run at a fixed $120\text{Hz}$ ($\Delta t = \frac{1}{120}\text{s} \approx 8.333\text{ms}$). Identical roster + binary input stream produces bit-identical `Float32Array` and `Uint8Array` buffers. | Zero `Math.random()` inside `step(dt)`; zero wall-clock `Date.now()` dependencies. |
| **Zero-Allocation Hot Path** | Neither `GameSimulation.step(dt)`, `writeHeuristic()`, nor the phone `pointermove` handler may allocate objects, arrays, or closures during gameplay. | Verified via Chrome DevTools Allocation Profiler ($0\text{ B/frame}$ heap churn). |
| **Grid Render Budget** | Painting all `1,600` cells plus up to `8` pucks and particles must stay within one frame budget on M5 Pro and DisplayLink monitors. | Single `40 × 40` offscreen canvas texture upload (1 draw call); `< 1.5ms` GPU frame time. |
| **End-to-End Latency** | Total Motion-to-Photon over 5GHz LAN. | **$< 25\text{ms}$ p50**, **$< 40\text{ms}$ p99** on modern phones; **$< 55\text{ms}$ p99** on 30Hz ULP phones. |
| **Mobile Ergonomics** | `<VirtualJoystick label="MOVE"/>` and `<ArcadeButton label="BOOST"/>` strictly inset **$\ge 36\text{px}$** from screen edges; `setPointerCapture` locked per `pointerId`. | Zero iOS Safari edge-swipe freezes; zero dropped multi-touch events. |
| **Strict View Compliance** | Strictly enforces `mode: 'holistic'`. Opening `/screen?view=team-1` shows `STANDBY — THIS GAME USES HOLISTIC VIEW` with $0\%$ render cost. | Enforced by `/screen` viewport router. |
| **Weak-Phone Compatibility** | Event-driven phone controller (zero continuous `rAF` loops). | $0\%$ idle phone GPU utilization. |

---

## 4. Technical Contracts, Memory Layouts & Endpoints

### A. Data-Plane Binary Input Contract (8 Bytes — WebRTC UDP / `ws` Fallback)
Conforms strictly to `SPEC.md` Part 3.3. Sent at up to $60\text{Hz}$ (or $30\text{Hz}$ in ULP mode):

```text
Byte 0..1 : [Uint16] seq         (0..65535)     -> Monotonic sequence number (drop/OOO detection)
Byte 2..3 : [Uint16] phoneTs     (ms mod 65536) -> One-way transit & jitter calculation
Byte 4    : [Uint8]  touchLag    (0.5ms steps)  -> Browser input lag (T_touch)
Byte 5    : [Uint8]  buttons     Bit 0 = BOOST (1 = pressed, 0 = released)
                                 Bits 1..7 = Reserved (0)
Byte 6    : [Int8]   axisX       (-127..127)    -> Normalized X = axisX / 127.0 (MOVE X)
Byte 7    : [Int8]   axisY       (-127..127)    -> Normalized Y = axisY / 127.0 (MOVE Y)
```

### B. Control-Plane WebSocket Contracts (`ws` JSON — Reliable TCP)
The host Chrome tab is the authority for these payloads. Fastify relays `{ type, roomId, payload }` on `/ws?room=ABCD` without interpreting Color Clash rules.

| Event `type` | Direction | Payload Schema | Purpose |
| :--- | :--- | :--- | :--- |
| `game:mount` | Server $\rightarrow$ All | `{ gameId: 'color-clash', manifest, players: PlayerSlot[], botNames?: string[] }` | Mounts Phaser renderer on `/screen` and morphs all phones to `ColorClashController`. |
| `color:match_start` | Server $\rightarrow$ All | `{ durationMs: 45000, countdownMs: 3000 }` | Resets phone percentage readouts to `0.0%` and clears boost cooldown bars. |
| `color:boost` | Server $\rightarrow$ All | `{ playerIndex: number, activeMs: 3000, cooldownMs: 8000 }` | Syncs phone splash-badge boost pulse and charge bar for the activating player. |
| `color:scores` | Server $\rightarrow$ All | `{ percents: number[] }` *(throttled to 4Hz max)* | Updates lightweight tabular `%` readout on phone top bars without saturating TCP. |
| `color:overtime` | Server $\rightarrow$ All | `{ contenderMask: number, goldenCell: number, durationMs: 30000 }` | Switches phone status to `OVERTIME` (contenders) or `WATCHING` (parked slots). |
| `color:haptic` | Server $\rightarrow$ Phone | `{ playerIndex?: number, intensity: 'heavy' \| 'golden' }` | Fires vibration / Taptic Engine feedback on boost shove or Golden Tile capture. |
| `color:match_end` | Server $\rightarrow$ All | `{ winnerIndex: number, percents: number[], cells: number[], overtime: boolean }` | Locks final reveal percentages and transitions to `MATCH_OVER` podium. |
| `color:rematch` | Host $\rightarrow$ Server | `{ action: 'restart' \| 'lobby' }` | Restarts match cleanly or returns all clients to Lobby Carousel. |

### C. Flat Simulation State Buffer (`Float32Array`) + Paint Grid Buffer (`Uint8Array`)
Pre-allocated once on game mount (`MAX_PLAYERS = 8`). Uses the exact 88-float primary state contract (`352 bytes`) plus an auxiliary `1,600-byte` `Uint8Array` grid buffer carried through the game-agnostic `auxState` seam (`ScreenSim.auxState`, `BroadcastChannel` snapshot payload, and Stretch 2 `SharedArrayBuffer`).

#### 1. Primary State Buffer — `Float32Array(88)` (`352 bytes`)
* **Global Arena Header (Indices `0..7` — 32 bytes):**
  ```text
  [0] tickId            (monotonic fixed-step counter)
  [1] phaseEnum         (0=COUNTDOWN, 1=ROUND_ACTIVE, 2=ROUND_END, 3=MATCH_OVER, 4=PRACTICE, 5=OVERTIME)
  [2] phaseTimer        (seconds remaining in current phase)
  [3] arenaSize         (800.0 world units, square side length)
  [4] goldenCell        (-1 when inactive; 0..1599 linear cell index during OVERTIME)
  [5] activeMask        (8-bit bitmask of active pucks on the floor)
  [6] hitStopFrames     (visual freeze counter 0..2)
  [7] winnerSlot        (-1 while undecided; 0..7 once match winner is locked)
  ```
* **Per-Player State Stride (`10` floats per player $\times$ `8` slots = `80` floats, Indices `8..87`):**
  For player `i` (`0..7`), base offset is `base = 8 + i * 10`:
  ```text
  [base + 0] x                (world X position, clamped to [-376, +376])
  [base + 1] y                (world Y position, clamped to [-376, +376])
  [base + 2] vx               (velocity X)
  [base + 3] vy               (velocity Y)
  [base + 4] angle            (facing angle in radians)
  [base + 5] boostCooldown    (0.0 .. 8.00s; ready when 0)
  [base + 6] boostActiveTimer (0.0 .. 3.00s; wide-trail active when > 0)
  [base + 7] paintPct         (0.0 .. 100.0 cached ownership percentage = cellCounts / 16)
  [base + 8] flags            (Bit0=ACTIVE, Bit1=BOOSTING, Bit2=IS_BOT, Bit3=CONTENDER)
  [base + 9] score            (accumulated match points)
  ```
  `flags` bit 0 is the source of truth for whether a puck is active on the floor. Header `activeMask` is rewritten from those bits every tick.

#### 2. Paint Grid Buffer — `Uint8Array(1600)` (`1,600 bytes`)
```text
Length      : 1600 bytes (GRID_W * GRID_H = 40 * 40)
Indexing    : grid[row * 40 + col], row in [0..39], col in [0..39]
Cell Values : 0      = Unpainted
              1..8   = Owned by player slot (value - 1), colored via PLAYER_COLORS[value - 1]
```

#### 3. Snapshot Footprint & Multi-Monitor Seam
* **Total Snapshot Size:** `352 bytes` (`Float32Array(88)`) + `1,600 bytes` (`Uint8Array(1600)`) = **`1,952 bytes`**.
* **v1 Sync (`BroadcastChannel`):** `ScreenSim` exposes optional `readonly auxState?: Uint8Array`. `host-loop.ts` copies `state` and `auxState` into pre-allocated snapshot buffers and publishes both on `BroadcastChannel` (`{ epoch, bytes, auxBytes }`) so secondary holistic monitors render the exact paint grid with zero extra physics.
* **Stretch 2 Mapping (`SharedArrayBuffer`):** Primary state (`352B`, padded to `384B` / 3 cache lines) followed immediately by the grid (`1,600B`, padded to `1,664B` / 13 cache lines) inside each 128-byte-aligned triple-buffer slot.

### D. Route & Viewport Endpoints
No new HTTP endpoints are required beyond the Console OS routes:
* **Primary Display:** `GET /screen?room={CODE}&view=holistic` (mounts `ColorClashRenderer`).
* **Secondary Displays:** `GET /screen?room={CODE}&view=team-{N}` (renders platform Standby Screen).
* **Controllers:** `GET /controller?room={CODE}` (dynamically mounts `ColorClashController` on `game:mount`).

---

## 5. Finite State Machines (FSM)

### A. Match Lifecycle FSM
```text
                  [Host taps START]
                         │
                         ▼
                 ┌───────────────┐
                 │   PRACTICE    │ (30.0s opening / 20.0s mid-match break:
                 └───────┬───────┘  move, boost freely, zero points)
                         │ timer <= 0
                         ▼
                 ┌───────────────┐
                 │   COUNTDOWN   │ (3.0s: pucks locked on spawn circle,
                 └───────┬───────┘  blank 40x40 grid, facing only)
                         │ timer <= 0
                         ▼
                 ┌───────────────┐
                 │ ROUND_ACTIVE  │ (45.0s: 120Hz physics, grid stamping,
                 └───────┬───────┘  3s wide-trail BOOST, live % HUD)
                         │ timer <= 0
              ┌──────────┴──────────┐
              │                     │
      [unique leader]      [tie for 1st place]
              │                     │
              │                     ▼
              │             ┌───────────────┐
              │             │   OVERTIME    │ (30.0s: tied contenders only,
              │             └───────┬───────┘  Golden Tile instant win OR
              │                     │          most painted at timer <= 0)
              │   [Golden Tile OR   │
              │    timer <= 0]      │
              └──────────┬──────────┘
                         ▼
                 ┌───────────────┐
                 │   ROUND_END   │ (0.8s: award round points, check match
                 └───────┬───────┘  target threshold & sudden death)
                         │
         ┌───────────────┴───────────────┐
         │ [unique winner >= target]     │ [no unique winner yet]
         ▼                               ▼
 ┌───────────────┐               ┌───────────────┐
 │  MATCH_OVER   │               │   PRACTICE    │
 └───────┬───────┘               └───────────────┘
         │
[color:rematch action]
```

### B. Per-Puck Action FSM
| Current State | Trigger / Condition | Next State | Side Effects |
| :--- | :--- | :--- | :--- |
| `SPAWN_LOCKED` | `phase === ROUND_ACTIVE` | `MOVING` | Enables steering, `BOOST`, and normal-radius (`24`) grid stamping. |
| `MOVING` | `BOOST` rising edge & `boostCooldown <= 0` | `BOOSTING` | Sets `boostActiveTimer = 3.00`, `boostCooldown = 8.00`; expands stamp radius to `54`; sets `BOOSTING` bit; emits `color:boost`. |
| `BOOSTING` | `boostActiveTimer <= 0` | `RECHARGING` | Restores normal stamp radius (`24`) and speed cap (`400`); clears `BOOSTING` bit. |
| `RECHARGING` | `boostCooldown <= 0` | `MOVING` | Re-enables `BOOST` trigger. |
| `MOVING` / `BOOSTING` / `RECHARGING` | `phase === OVERTIME` & slot is not tied for 1st | `PARKED_NON_CONTENDER` | Clears `ACTIVE` and `CONTENDER` bits; ignores inputs; keeps already-painted cells on the grid. |
| *Any Active State* | `phase === ROUND_END` or `MATCH_OVER` | `FROZEN` | Ignores inputs; halts movement and stamping; preserves grid and scores. |

---

## 6. Strict System & Physics Invariants

Every PR or AI-generated change to `color-clash` must preserve these invariants:

1. **INV-1 (No NaN / Infinity State):** For all ticks $t$ and all indices $k \in [0, 87]$, `Number.isFinite(state[k]) === true`. Exact-center puck overlap falls back to deterministic separation normal $(\cos(i), \sin(i))$.
2. **INV-2 (Box Boundary Containment):** For every active puck $i$ on every tick, $|x_i| \le 400 - r_{\text{puck}} = 376$ and $|y_i| \le 400 - r_{\text{puck}} = 376$, enforced via `clampBoxBoundary` from `@shared/physics-2d`.
3. **INV-3 (Grid Domain & Count Conservation):** Every byte in `grid` (`Uint8Array(1600)`) satisfies `0 <= grid[c] <= 8`. For every slot $i$, `state[base + 7]` (`paintPct`) equals `(cellCount * 100) / 1600`, and $\sum_{i=0}^{7} \text{cellCount}_i \le 1600$. `state[base + 9]` stores the player's accumulated match score.
4. **INV-4 (Monotonic Boost Timers):** `boostActiveTimer` stays clamped to $[0, 3.00]$ and `boostCooldown` stays clamped to $[0, 8.00]$. While `boostActiveTimer > 0`, `boostCooldown >= boostActiveTimer`. Neither value ever goes negative.
5. **INV-5 (Order-Independent Same-Tick Overlap):** When multiple pucks cover the same grid cell on the same tick, the winning owner depends only on `(boostActive, distSq, slotIndex)` — never on loop iteration direction.
6. **INV-6 (Guaranteed Finite Termination):** Every round reaches `ROUND_END` within at most `3.0 + 45.0 + 30.0 = 78.0` simulated seconds (opening round adds `30.0s` practice, mid-match rounds add `20.0s` practice break). Deterministic tiebreak ordering and sudden death contender filtering ensure finite match termination even when players remain idle or tied.
7. **INV-7 (Zero-Allocation Hot Path):** Executing `10,000` consecutive `simulation.step(1/120)` ticks and `writeHeuristic()` calls produces $0$ dynamic object allocations inside the physics and bot loops.
8. **INV-8 (Bit-Exact Determinism):** Replaying the same 8-byte input sequence from the same starting roster in the same Chrome build produces bit-identical `Float32Array(88)` and `Uint8Array(1600)` buffers at tick $N$.
9. **INV-9 (Strict View Isolation):** Mounting `color-clash` when a monitor is open on `/screen?view=team-1` never runs `ColorClashRenderer`; only `/screen?view=holistic` renders the arena.

---

## 7. Testing & Verification Plan

### 1. Deterministic Unit Tests (`vitest`)
* **Grid Stamping & Count Conservation (`INV-3`):** Move a puck across the $40 \times 40$ grid, verify exact cell coordinates are marked with `slot + 1`, overwrite them with a second puck, and assert cell counts for both players matches a full brute-force count of `grid` and $\sum \text{cellCounts}_i \le 1600$.
* **Same-Tick Cell Overlap Resolution (`INV-5`):** Place two pucks equidistant and asymmetric over a shared cell on the same tick; verify the boosting puck beats a non-boosting puck, and the closer puck beats a farther puck regardless of slot order.
* **Box Boundary Containment (`INV-2`):** Drive a puck at full boosted velocity into all four corners and walls; assert $|x| \le 376$, $|y| \le 376$, and outward velocity reflects by `WALL_BOUNCE = 0.35`.
* **Boost Edge Trigger & 3s Wide Trail (`INV-4`):** Hold `Bit 0 = 1` across multiple ticks; verify only one `3.00s` boost fires on the `0 -> 1` rising edge, stamped cell footprint expands from radius `24` to `54`, and re-trigger stays locked until `boostCooldown` reaches `0` (`8.00s` total).
* **Disconnect Persistence (`FR-6`):** Paint cells with slot 0, then feed zero inputs for 5 seconds; verify slot 0's puck decelerates to rest inside bounds and its painted cells remain owned until an opponent paints over them. Rejoin restore must not mutate `auxState` ownership for that slot except via normal opponent stamping.
* **Multi-Round Match End & 30s Overtime Tiebreak (`INV-6`):**
  * Unique leader at `45.0s` transitions directly to `ROUND_END` (0.8s) -> `MATCH_OVER` (if target reached) or `PRACTICE` (20.0s break).
  * Tied leaders at `45.0s` transition to `OVERTIME` (`30.0s`) with a valid `goldenCell` (`0..1599`) and non-tied slots parked (`ACTIVE = 0`) while keeping their cells on the board.
  * Moving a tied contender onto `goldenCell` awards an immediate win and enters `ROUND_END`.
  * Letting `30.0s` expire resolves the round winner by most painted cells (or deterministic tiebreak if still equal).
* **Heuristic Bot Policy:**
  * Place a bot beside an unpainted cluster and assert it steers toward the unpainted sector and fires `BOOST` when facing a dense cluster.
  * During `OVERTIME`, assert a contender bot steers directly toward `goldenCell`.

### 2. State Machine & Property-Based / Fuzz Tests
* **10,000-Tick Fuzz Simulation:** Feed deterministic pseudo-random 8-player binary inputs (`Uint8` bitmasks and `Int8` axes) into `ColorClashSimulation` across multiple full matches (including forced tiebreaks). Assert `INV-1` through `INV-6` after every tick.
* **Determinism Replay Verification (`INV-8`):** Record a 45-second randomized 8-player input log, reset `ColorClashSimulation`, replay the bytes, and assert byte-for-byte equality on both `state` (`Float32Array`) and `auxState` (`Uint8Array`).
* **Illegal FSM Transitions:** Verify `applyInput()` is a strict no-op during `COUNTDOWN`, `ROUND_END`, and `MATCH_OVER`, and for parked non-contenders during `OVERTIME`.

### 3. Hardware, Network & Latency Verification Checklist (M5 Pro Mac + Phones)
* **Controller Paint Splash & Multi-Touch Check:** On both iPhone (Safari) and Android (Chrome), verify portrait and landscape layouts show the player's exact `PLAYER_COLORS` splash indicator, `<VirtualJoystick label="MOVE"/>`, and `<ArcadeButton label="BOOST"/>` inset $\ge 36\text{px}$ from screen edges. Steer continuously while tapping `BOOST`; verify zero lost joystick tracking and accurate `3s` active / `5s` recharge meter animation.
* **8-Player Grid Frame-Time Check:** Launch a full 8-player match (humans + bots) on `/screen?view=holistic` and open a second `/screen?view=holistic` tab to verify `BroadcastChannel` syncs both `Float32Array(88)` and `Uint8Array(1600)` cleanly at 60/120fps with `< 1.5ms` render time and `0 B/frame` hot-path heap allocations.
* **Strict Holistic Standby Check (`INV-9`):** Open `/screen?view=team-1` beside `/screen?view=holistic` and launch `color-clash`; verify the team monitor displays `STANDBY — THIS GAME USES HOLISTIC VIEW`.
* **Mid-Match Rejoin Check (`FR-6`):** With 2+ LIVE humans at START, disconnect one phone mid-`ROUND_ACTIVE`, confirm top-left **`SCAN TO REJOIN`** QR stays visible, scan/reconnect with the stored `sessionToken`, and verify the same slot resumes MOVE/BOOST with painted cells intact. Attempt a stranger join and a lobby-`AWAY`-at-start token join; both must receive `MATCH_IN_PROGRESS`.
* **In-Match Exit Check (`FR-8`):** On the primary host tab during `color-clash`, confirm top-right `[×]` `<MatchExitControl/>` opens `QUIT MATCH?`, **CANCEL** leaves the match live, and **QUIT TO LOBBY** calls `session.resetLobby()` (lobby carousel returns, phones unmount Color Clash). Secondary tabs must not show the exit control.
