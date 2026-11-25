# Bomb Pass (`bomb-pass`) — Hot Potato Arena Game Spec

> **AI Agent Instruction:** Read `../SPEC.md` and `./README.md` before you implement this module. Implement **Bomb Pass** as a self-contained plugin under `/games/bomb-pass` that conforms to `GameDefinition`. Do not leak Bomb Pass rules, timers, or visuals into `/server`, `/screen`, or `/controller` shells.

---

## 1. Overview & `GameManifest` Contract

**Bomb Pass** is a 2-to-8 player top-down 2D hot-potato arena game. Chunky Neo-Brutalist pucks move and dash inside a solid circular steel arena. One live bomb ticks down from `15.0s`. Colliding with another alive puck passes the bomb after a `0.5s` transfer cooldown. When the fuse hits `0.0s`, the holder explodes and leaves the round. A new bomb arms on a remaining survivor until one puck stands. Rounds award ranked survival points until one player reaches the match threshold. Empty slots support heuristic bots through `applyInput`.

### Declarative Manifest (`manifest.ts`)
```typescript
import { APP_THEME } from '../../../shared/src/theme.ts';
import type { GameManifest } from '../../../shared/src/types/game.ts';

export const BOMB_PASS_MANIFEST: GameManifest = {
  id: 'bomb-pass',
  title: 'BOMB PASS',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: true, // Heuristic chase/flee policy lives in heuristic.ts.
  rendererType: 'phaser-2d',
  viewConfig: {
    mode: 'holistic',
    inputBufferMode: 'zero-buffer',
  },
  supportedOrientations: ['portrait', 'landscape'],
  themeTokens: {
    '--bg-surface': '#EAE6DF',               // Matte Warm Putty
    '--ink-primary': '#111111',              // Industrial Carbon
    '--accent-hazard': APP_THEME.yellowDeep, // '#C88A00' (warning ticks / fuse spark)
    '--accent-dash': APP_THEME.yellowWarm,   // '#E5A800' (dash cooldown arc)
    '--accent-spark': APP_THEME.yellowBright,// '#FFE14D' (transfer / blast sparks)
    '--accent-bomb': '#E10600',              // Industrial Signal Red (active bomb + phone danger alert)
    '--accent-ready': '#00C853',             // Hardware LED Green (safe status LED)
    '--arena-plate': '#D6D1C7',              // Brushed Steel Plate
  },
};
```

---

## 2. Functional Requirements (FR)

### FR-1: Arena Geometry & Solid Circular Boundary
* **Coordinate Space:** Authoritative 2D world centered at $(0, 0)$ in normalized units.
* **Fixed Arena Radius:** $R_{\text{arena}} = 400\text{ units}$. The wall does not shrink during the round.
* **Boundary Containment (`@shared/physics-2d/boundary`):**
  * Every tick during `PRACTICE` and `ROUND_ACTIVE`, clamp each `ALIVE` puck inside the circular arena by calling `clampRadialBoundary(body, R_arena, r_puck, wallBounce)` from `@shared/physics-2d/boundary`.
  * Set `wallBounce = 0.65` so pucks bank crisply off the steel rim without escaping or sticking.
* **Spawn Formation:** Active contenders $N \in [2, 8]$ spawn equidistantly on a circle of radius $R_{\text{spawn}} = 240\text{ units}$, facing inward toward $(0, 0)$:
  $$\theta_i = \frac{2\pi i}{N}, \quad (x_i, y_i) = (R_{\text{spawn}}\cos\theta_i,\ R_{\text{spawn}}\sin\theta_i)$$

### FR-2: Puck Movement, Steering, Dash & Collisions
* **Shared 2D Physics Primitives:** Reuse `integrateMotion` from `@shared/physics-2d/motion` and `resolveCircleBufferPairs` from `@shared/physics-2d/circle-collision`.
* **Puck Physical Constants:**
  * Radius: $r_{\text{puck}} = 28\text{ units}$
  * Base Mass: $m = 1.0$
  * Max Steering Acceleration: $a_{\text{move}} = 1800\text{ units/s}^2$
  * Linear Damping: $\mu = 4.2\text{ s}^{-1}$ applied per tick via `integrateMotion(scratchBody, dt, mu)`
  * Runner Max Speed: $v_{\max} = 420\text{ units/s}$
  * Bomb Holder Max Speed: $v_{\max,\text{holder}} = 455\text{ units/s}$ (gives the holder a small pursuit edge in open space)
* **Deadzone:** Clamp joystick input magnitude $\|\vec{u}\| < 0.12$ to $(0, 0)$.
* **Heading:** Nose-wedge angle blends smoothly toward non-zero joystick direction (`angleBlend = 12 rad/s`) and holds its last heading when idle.
* **Dash Mechanic:**
  * Trigger on the rising edge of `DASH` (`Bit 0` transitions `0 -> 1`) while `dashCooldown <= 0` and the puck is `ALIVE`.
  * Apply velocity burst $v_{\text{dash}} = 880\text{ units/s}$ along the stick vector (or facing angle when the stick is neutral), preserving the perpendicular velocity component.
  * Set `dashActiveTimer = 0.18s` (steering authority reduced by $70\%$) and `dashCooldown = 1.50s` (recharges linearly to $0$).
* **Puck-to-Puck Elastic Resolution:**
  * Resolve overlaps ($\|\vec{p}_j - \vec{p}_i\| < 2 r_{\text{puck}}$) with `resolveCircleBufferPairs` at restitution $e = 0.85$.
  * When a collision produces a bomb transfer, apply symmetric separation impulse scaling (`scaleI = 1.25`, `scaleJ = 1.25`) so the passer and receiver pop cleanly apart.

### FR-3: Bomb Mechanics (Assignment, Fuse, Transfer, Cooldown & Explosion)
* **Deterministic Random Initial Assignment:**
  * On transition from `COUNTDOWN` to `ROUND_ACTIVE` (and after each non-final explosion breather), select one `ALIVE` puck using a deterministic 32-bit PRNG (Mulberry32) owned by the simulation instance and seeded on `startMatch(slots, seed?)`. Never call `Math.random()` inside `step(dt)`.
  * Prefer `ALIVE` pucks that are connected (`(connectedMask & (1 << slot)) !== 0`). If all `ALIVE` pucks are disconnected, draw from all `ALIVE` pucks.
  * Set `bombHolder = chosenSlot`, `bombTimer = 15.0` (or `7.5` during Sudden Death), and `transferCooldown = 0.0`.
* **Ticking Fuse Timer:**
  * While `phase === ROUND_ACTIVE` and `bombHolder >= 0`, decrement `bombTimer` by `dt` each tick, clamped to $[0, 15.0]$.
  * Passing the bomb **does not reset `bombTimer`**. The fuse continues counting down across transfers until detonation.
  * Fuse urgency thresholds:
    * `> 5.0s`: normal tick cadence (1 Hz visual pulse).
    * `<= 5.0s`: warning cadence (3 Hz flash + `bomb:haptic('warn')` crossing cue).
    * `<= 2.0s`: critical cadence (8 Hz strobe + `bomb:haptic('critical')` crossing cue).
* **Collision Transfer & 0.5s Transfer Cooldown:**
  * While `phase === ROUND_ACTIVE`, `bombHolder >= 0`, and `transferCooldown <= 0`, any overlap between `bombHolder` and another `ALIVE` puck records a transfer candidate for the current tick.
  * After all pair physics resolve for the tick, apply at most **one** transfer (see FR-5 for simultaneous cluster tie-breaking).
  * On transfer to slot `target`:
    * Update `bombHolder = target`.
    * Set `transferCooldown = 0.50s`.
    * Set `effectTimer` (`[base + 7]`) on `target` to `0.50s` for visual lockout ring rendering.
  * While `transferCooldown > 0`, pucks still collide and bounce physically, but **no bomb transfer occurs**.
* **Explosion & Elimination:**
  * When `bombHolder >= 0` and `bombTimer <= 0`:
    1. Record detonation origin $(x_b, y_b)$ from `bombHolder`.
    2. Mark `bombHolder` as `ELIMINATED` (clear `ALIVE` bit, set `EXPLODED_THIS_ROUND` bit, record `eliminatedTick[bombHolder] = roundTick`, set `effectTimer = 0.85s` to animate the blast ring at $(x_b, y_b)$).
    3. **Point-Blank Blast Zone ($r_{\text{blast}} = 64\text{ units}$):** Mark every other `ALIVE` puck with $\sqrt{(x_k - x_b)^2 + (y_k - y_b)^2} \le r_{\text{blast}}$ as `ELIMINATED` on the exact same `roundTick` (covers pucks trapped against the holder during the `0.5s` transfer lockout).
    4. Clear `bombHolder = -1`, `bombTimer = 0`, `transferCooldown = 0`.
    5. Count remaining `ALIVE` pucks (`aliveCount`):
       * **`aliveCount >= 2`:** Stay in `ROUND_ACTIVE`, set `phaseTimer = 0.85s` (blast breather where survivors keep moving freely with no active bomb). When `phaseTimer <= 0`, assign a fresh `15.0s` bomb to a random `ALIVE` survivor.
       * **`aliveCount === 1`:** Award round points and transition to `ROUND_END` (`phaseTimer = 0.8s`).
       * **`aliveCount === 0`:** Trigger Sudden Death tiebreaker (see FR-5).

### FR-4: Round Flow, Scoring & Match Win Condition
* **Practice / Break (`PRACTICE`, `phaseEnum = 4`):**
  * Matches open with `10.0s` of practice on the full circular arena (move, dash, and wall-bounce freely; `bombHolder = -1`; zero eliminations; zero points).
  * After a scored non-final round, play enters a `5.0s` break before the next countdown. All contenders revive inside the solid boundary without teleporting surviving pucks; eliminated pucks revive on the spawn circle.
  * When the break timer hits `0`, all contenders reset onto the spawn ring and enter `COUNTDOWN`.
* **Countdown (`COUNTDOWN`, `phaseEnum = 0`):**
  * Lasts `3.0s`. Pucks hold position on $R_{\text{spawn}} = 240$. Joystick updates nose-wedge facing only. Held `DASH` does not fire on tick 0.
* **Round Active (`ROUND_ACTIVE`, `phaseEnum = 1`):**
  * Bomb arms immediately when `COUNTDOWN` ends. Play continues across eliminations until `aliveCount <= 1`.
* **Round End (`ROUND_END`, `phaseEnum = 2`):**
  * Holds for `0.8s` (or `1.5s` when announcing `SUDDEN DEATH`).
  * **Ranked Survival Scoring:** For $N$ joined players, each player's rank counts `better` = number of players still `ALIVE` or with a strictly higher `eliminatedTick`. Each player earns `N - 1 - better` points (sole survivor earns `N - 1`; first eliminated earns `0`; same-tick blast victims share the same `better` count).
  * **Match Threshold:** `targetScore = max(3, (N - 1) * 3)` (for 2 players: first to `3`; for 4 players: first to `9`).
  * If one unique player satisfies `score >= targetScore`, transition to `MATCH_OVER`.
  * If multiple players tie for the lead at `score >= targetScore`, set `MATCH_SUDDEN_DEATH` (`Bit 1` of `roundFlags`). Only tied leaders spawn in the next round, and the sole survivor earns `+1` point to win the match.
* **Match Over (`MATCH_OVER`, `phaseEnum = 3`):**
  * Displays `<TAG> WINS` banner, final scores in slot order, and host `PLAY AGAIN / RETURN TO LOBBY` actions (`bomb:rematch`).

### FR-5: Edge Cases (Mandatory Deterministic Rules)
1. **Simultaneous Collisions (Single-Transfer-Per-Tick Lock):**
   * Never mutate `bombHolder` inside the `(i, j)` pair loop of `resolveCircleBufferPairs`.
   * During the pair loop on tick $T$, record candidate collisions involving `bombHolder` (only when `transferCooldown <= 0`) into pre-allocated scalar scratch variables (`candSlot`, `candDistSq`, `candCloseSpeed`).
   * After all physical overlaps resolve, commit at most **one** transfer for tick $T$.
2. **Multi-Puck Cluster Transfers (3+ Pucks Touching Holder):**
   * When 2 or more `ALIVE` non-holder pucks overlap `bombHolder` on the same tick, pick the single recipient using strict deterministic priority:
     1. Smallest pre-separation center distance (`distSq` — deepest contact).
     2. If `|distSqA - distSqB| <= 1e-4`, highest closing speed toward the holder (`-vr`).
     3. If still tied, lowest player slot index (`0..7`).
   * Immediately set `transferCooldown = 0.50s` so remaining cluster pucks bounce off without re-transferring.
3. **Disconnects While Holding the Bomb (Auto-Pass to Closest Alive Player):**
   * The host session pushes an 8-bit `connectedMask` (`Bit i = 1` for connected humans and active bots; `0` for disconnected humans) into the simulation via the optional game-agnostic `ScreenSim.setConnectedMask?(mask: number)` seam.
   * At the start of each `ROUND_ACTIVE` tick, if `bombHolder >= 0` and `(connectedMask & (1 << bombHolder)) === 0`:
     1. Scan all other `ALIVE` slots (`j !== bombHolder`).
     2. Prefer `ALIVE` slots with `(connectedMask & (1 << j)) !== 0`; if none exist, consider all other `ALIVE` slots.
     3. Select the candidate with the smallest Euclidean distance to `bombHolder` (tie-break: lowest slot index).
     4. Transfer `bombHolder = target`, set `transferCooldown = 0.50s`, and apply a `2.0s` fairness floor to the fuse (`bombTimer = Math.max(bombTimer, 2.0)`) so the recipient always has time to react.
   * Per `SPEC.md` Seam 2, the disconnected puck stays in the arena with zeroed inputs and is **not** auto-eliminated; its `localStorage` `sessionToken` restores control on reconnect.
4. **Sudden Death When Last 2 (or More) Explode Simultaneously:**
   * If a detonation eliminates all remaining `ALIVE` pucks on the exact same tick (`aliveCount === 0`), award **zero** points for that detonation.
   * Set `ROUND_SUDDEN_DEATH` (`Bit 0` of `roundFlags`), mark only the players eliminated on that simultaneous final tick (`eliminatedTick[i] === roundTick`) as `SUDDEN_DEATH_CONTENDER`, and transition to `ROUND_END` (`1.5s` `SUDDEN DEATH` banner).
   * When `ROUND_END` expires, skip `PRACTICE` and jump straight to `COUNTDOWN` (`3.0s`) with only the sudden-death contenders on the spawn ring (other players stay parked offscreen).
   * Arm the bomb with a halved **`7.5s` Sudden Death fuse**. Repeat until one sole survivor stands, then clear `ROUND_SUDDEN_DEATH` and award round points.

### FR-6: Phone Controller Layout & Bomb Danger Indicator
* **Primitives & Ergonomics:** Built only from `/shared/ui` primitives (`<VirtualJoystick/>`, `<ArcadeButton/>`, `<PlayerBadge/>`). Supports `portrait` and `landscape`. All interactive targets stay $\ge 36\text{px}$ from screen edges with `setPointerCapture`.
* **Layout:**
  * **Top Bar:** `<PlayerBadge/>` (slot `P1`–`P8`, name, player color) + tabular monospace readout (`SAFE · 3 PTS`, `BOMB! 08.4s`, or `OUT · 3 PTS`).
  * **Move Zone:** `<VirtualJoystick label="MOVE"/>` mapped to `Int8` `axisX, axisY` (`-127..127`).
  * **Dash Control:** Single oversized `<ArcadeButton label="DASH"/>` mapped to `Byte 5` `Bit 0` with a hard-edged `1.5s` local cooldown fill bar.
* **Bomb Danger Indicator (Phone Screen Alert):**
  * Driven by reliable control-plane messages (`bomb:holder`, `bomb:explosion`, `bomb:round_start`) — **zero continuous `requestAnimationFrame` loops** on the phone.
  * When `holderIndex === slot`:
    * Set `data-bomb="true"` on the controller root.
    * Display a solid Industrial Signal Red (`#E10600`) high-contrast danger frame (`4px solid #E10600`) and a bold `HOLDING BOMB — PASS IT!` status strip with tabular seconds remaining (stepped local `250ms` display timer synced from `remainingMs`, zero blur, zero gradients).
    * Set `data-urgency="warn"` below `5.0s` and `data-urgency="critical"` below `2.0s` to step-flash the danger strip via CSS `steps(2)` keyframes.
    * Fire local haptics (`navigator.vibrate`) on receiving the bomb (`35ms`), crossing `2.0s` (`[40, 40, 40]`), passing the bomb away (`15ms` relief pulse), and explosion elimination (`80ms`).
  * When `holderIndex !== slot`, immediately clear `data-bomb="false"` and restore normal player-tinted surface styling.

### FR-7: Industrial Neo-Brutalist Visuals & Game Feel (Zero Art Assets)
* Render all visuals procedurally in Phaser 4 (`Graphics`, zero external sprites):
  * Matte Warm Putty (`#EAE6DF`) background and circular Brushed Steel Plate (`#D6D1C7`) at $R = 400$ with a thick `4px #111111` solid bumper rim and 24 inward bumper ticks.
  * Each `ALIVE` puck displays its P1–P8 fill, `3px #111111` stroke, hard `+5px, +5px` offset shadow, directional nose wedge, and radial `DASH` cooldown arc (`--accent-dash`).
  * **Bomb Holder Overlay:** Concentric Signal Red (`#E10600`) warning ring around the holder puck, clockwise depleting fuse arc (`bombTimer / fuseDuration`), and pulsed hard-edged red core badge. Frequency steps up at `<= 5.0s` and `<= 2.0s`.
  * **Transfer Lockout Ring:** While `transferCooldown > 0`, draw a crisp `#111111` / `#F4F1EA` dashed lockout ring around the holder so every player reads the `0.5s` cooldown clearly.
  * **Blast & Transfer Juice:** On bomb transfer, spawn hard-edged square yellow sparks (`#FFE14D`, `2px #111111` stroke) and trigger a subtle `0.35px` camera nudge. On explosion, draw an expanding hard-edged `#E10600` blast ring out to $r_{\text{blast}} = 64$, stamp a crater `X` at the blast point during the `0.85s` breather, and apply a `0.5px` camera nudge. Visual hit-stop never pauses `step(dt)`.

### FR-8: Heuristic Bot Policy (`heuristic.ts`)
Empty bot slots call `applyInput(botIndex, buttons, axisX, axisY)` at 60Hz (on even `tickId` ticks) from the host tab using zero allocations. Bot skill levels use `assignBotScores` (`1..100` scale, `easy: 11..20`, `medium: 30..50`, `hard: 50..70`) via `levelsForMask`, with $\text{share} = \text{skill}/100$ and $\text{nerf}(\text{base}, \text{mult}, \text{share}) = \text{base} + \text{share} \cdot \text{mult}$.

1. **Dead / Inactive Guard:** If the bot is not `ALIVE`, write `axisX = 0`, `axisY = 0`, `buttons = 0`.
2. **Holding the Bomb (`bombHolder === botIndex`) — CHASE:**
   * Select the nearest `ALIVE` opponent `j` (tie-break: lowest slot index).
   * Predict target position $\vec{p}_{\text{aim}} = \vec{p}_j + \text{nerf}(0.06, 0.14, \text{share}) \cdot \vec{v}_j$, clamped inside $0.92 \cdot R_{\text{arena}}$.
   * Rotate the aim direction by small slot-sided error $\text{nerf}(0.20, -0.18, \text{share})$ radians and apply stick pace $\text{nerf}(0.48, 0.52, \text{share})$.
   * Fire `DASH` (`Bit 0 = 1`) when `transferCooldown <= 0`, opponent distance $< \text{nerf}(90, 170, \text{share})$, and dot-product alignment $> \text{nerf}(0.94, -0.10, \text{share})$.
3. **Not Holding the Bomb (`bombHolder >= 0 && bombHolder !== botIndex`) — FLEE:**
   * Compute unit flee vector $\hat{f}$ directly away from the bomb holder.
   * **Wall-Slide Avoidance:** When $\|\vec{p}_{\text{bot}}\| > 0.72 \cdot R_{\text{arena}}$, blend $\hat{f}$ with a tangent vector around the circular wall (choosing the tangent side moving away from the holder's lateral position; tie-break by `botIndex % 2 === 0 ? 1 : -1`) plus an inward pull past $0.85 \cdot R_{\text{arena}}$ so the bot orbits away instead of trapping itself in corners.
   * Apply stick pace $\text{nerf}(0.42, 0.58, \text{share})$.
   * **Evade Dash:** Fire `DASH` when the holder is within panic distance $\text{nerf}(85, 95, \text{share})$ (or `bombTimer <= 3.0` and holder within $190$), provided the projected dash point stays inside $0.92 \cdot R_{\text{arena}}$.
4. **No Active Bomb (`bombHolder < 0`):**
   * Gently spread away from the closest `ALIVE` puck while staying inside $0.65 \cdot R_{\text{arena}}$, with `DASH = 0`.

### Scoreboard & Banner Presentation
* Right-side scoreboard lists all joined players in slot order (`<TAG> <SCORE>` with player color circle and `LIVE`/`AWAY` badge when disconnected).
* Header shows `THRESHOLD: <TARGET>` during normal play and `SUDDEN DEATH` during round or match sudden death.
* Above-arena banner shows `BREAK <N>`, `3 / 2 / 1`, `BOMB <SS.T>` (or `BOOM!` during the `0.85s` blast breather), `POINT`, `SUDDEN DEATH`, and `<TAG> WINS`.

### FR-9: Mid-Match Rejoin (Shared Screen + Relay Seams)
Bomb Pass consumes the Console OS mid-match rejoin path. It does **not** ship a game-local QR, token store, or join gate.

* **In-Match Rejoin QR (top-left):** While `phase === 'match'` on the primary holistic host tab, the shared screen shell renders `<MatchRejoinQr/>` (`screen/src/score-rules.tsx`) in the top-left corner with label `SCAN TO REJOIN`. The canvas reuses `session.attachQr` — the same QR target as the lobby. Bomb Pass must not draw a second QR inside `BombPassRenderer`.
* **`sessionToken` restore (LIVE-at-start only):** Phones store `sessionToken` in `localStorage` (`party-session-<room>`). A player who was **LIVE when the host started the match** (slot is in the relay `activeMatchSlots` set) may disconnect and later rejoin with that token. The relay returns the same slot index, marks `connected: true`, and re-sends `game:mount` / `room:phase: match` so the phone remounts `BombPassController` without a page reload.
* **Bomb auto-pass on holder disconnect:** If the disconnected slot held the bomb, FR-5 #3 runs on the next `ROUND_ACTIVE` tick via `setConnectedMask` (auto-pass to closest eligible `ALIVE` puck, `bombTimer = max(bombTimer, 2.0)`, `transferCooldown = 0.50`). The disconnected puck stays `ALIVE` with zeroed inputs until token rejoin restores control.
* **Strangers and lobby-AWAY rejected:** Mid-match `room:join` without a valid LIVE-at-start token (brand-new stranger, unknown token, or a slot that was AWAY / absent when the match started) receives `room:rejected` with reason `MATCH_IN_PROGRESS` (`MATCH IN PROGRESS — CANNOT JOIN MID-GAME`). Bomb Pass adds no server branch; the game-agnostic relay already enforces this for every game.

### FR-10: In-Match Exit (Shared `MatchExitControl` → `resetLobby`)
Bomb Pass consumes the shared single-screen match-exit control. It does **not** add a Sumo-only or Bomb-only exit HUD.

* **Host top-right `[x]`:** On the primary host tab during an active match, when the selected manifest uses `viewConfig.mode: 'holistic'` (Bomb Pass does), the shared screen shell shows `<MatchExitControl/>` (`screen/src/match-exit.tsx`) in the top-right corner. Secondary monitor tabs and non-match phases hide it (`canShowMatchExit(primary, match, manifest)`).
* **Confirm → `session.resetLobby()`:** Tapping `[x]` opens the shared confirm modal. Confirm calls `session.resetLobby()`, which tears down the renderer, clears match/lobby state, broadcasts `game:unmount` + `room:phase: lobby`, and returns every screen and phone to the unselected lobby carousel together. Cancel closes the modal and leaves the match running.
* **Shared seam only:** Do not wire a parallel exit button inside `games/bomb-pass/**`. Podium `RETURN TO LOBBY` already calls the same `resetLobby()` seam. Future `team-exclusive` coordinated exit (see `TODO(@agents)` in `match-exit.tsx`) also routes through `resetLobby()`; Bomb Pass stays holistic and needs no extra exit mode.

---

## 3. Non-Functional Requirements (NFR)

| Category | Requirement | Target / Enforcement |
| :--- | :--- | :--- |
| **Fixed Timestep Determinism** | Physics runs at a fixed $120\text{Hz}$ ($\Delta t = \frac{1}{120}\text{s}$). Identical seed + binary input stream produces bit-identical `Float32Array` snapshots. | Seeded Mulberry32 PRNG only; zero `Math.random()` or `Date.now()` inside `step(dt)`. |
| **Zero-Allocation Hot Path** | Neither `simulation.step(dt)`, `writeHeuristic(...)`, nor the phone `pointermove` handler allocates objects, arrays, or closures during gameplay. | Verified via static review and Chrome DevTools Allocation Profiler ($0\text{ B/frame}$). |
| **End-to-End Latency** | Total Motion-to-Photon over 5GHz LAN matches `SPEC.md` budgets. | **$< 25\text{ms}$ p50**, **$< 40\text{ms}$ p99** on modern phones; **$< 55\text{ms}$ p99** on 30Hz ULP phones. |
| **Mobile Ergonomics** | `<VirtualJoystick/>` and `<ArcadeButton/>` stay $\ge 36\text{px}$ from screen edges with `setPointerCapture`. | Zero iOS edge-swipe freezes; independent simultaneous multi-touch. |
| **Strict View Compliance** | Strictly enforces `mode: 'holistic'`. Opening `/screen?view=team-1` shows `STANDBY — THIS GAME USES HOLISTIC VIEW`. | Enforced by `/screen` viewport router. |
| **Weak-Phone Thermal Defense** | Phone controller runs no continuous `rAF` loop. Bomb danger animation uses compositor-friendly CSS steps and discrete control-plane events. | $0\%$ idle phone GPU utilization. |

---

## 4. Technical Contracts, Memory Layouts & Endpoints

### A. Data-Plane Binary Input Contract (8 Bytes — WebRTC UDP / `ws` Fallback)
Conforms strictly to `SPEC.md` Part 3.3:

```text
Byte 0..1 : [Uint16] seq         (0..65535)     -> Monotonic sequence number (drop/OOO detection)
Byte 2..3 : [Uint16] phoneTs     (ms mod 65536) -> One-way transit & jitter calculation
Byte 4    : [Uint8]  touchLag    (0.5ms steps)  -> Browser input lag (T_touch)
Byte 5    : [Uint8]  buttons     Bit 0 = DASH (1 = pressed, 0 = released)
                                 Bits 1..7 = Reserved (0)
Byte 6    : [Int8]   axisX       (-127..127)    -> Normalized X = axisX / 127.0
Byte 7    : [Int8]   axisY       (-127..127)    -> Normalized Y = axisY / 127.0
```

### B. Control-Plane WebSocket Contracts (`ws` JSON — Reliable TCP)
The primary host Chrome tab emits these envelopes via `eventsFromHeaderDiff`. Fastify relays `{ type, roomId, payload }` on `/ws?room=ABCD` without interpreting Bomb Pass rules.

| Event `type` | Direction | Payload Schema | Purpose |
| :--- | :--- | :--- | :--- |
| `game:mount` | Host $\rightarrow$ All | `{ gameId: 'bomb-pass', manifest, players: PlayerSlot[], botNames?: string[] }` | Mounts Phaser renderer on `/screen` and morphs all phones to `BombPassController`. |
| `bomb:round_start` | Host $\rightarrow$ All | `{ roundNumber: number, countdownMs: 3000, scores: number[], suddenDeath: boolean }` | Starts 3-2-1 countdown and resets phone status badges to `SAFE`. |
| `bomb:holder` | Host $\rightarrow$ All | `{ holderIndex: number, previousHolder: number, remainingMs: number, transferCooldownMs: number, reason: 'assign' \| 'transfer' \| 'disconnect' \| 'clear' }` | Activates or clears the phone Bomb Danger Indicator and syncs the phone countdown readout. |
| `bomb:explosion` | Host $\rightarrow$ All | `{ eliminatedIndices: number[], blastX: number, blastY: number, aliveCount: number, suddenDeathTriggered: boolean }` | Updates eliminated phones to `OUT` and triggers explosion feedback. |
| `bomb:haptic` | Host $\rightarrow$ All | `{ intensity: 'transfer' \| 'warn' \| 'critical' \| 'explosion' \| 'out', targetSlot: number \| null }` | Triggers targeted or global phone vibration/Taptic cues. |
| `bomb:round_end` | Host $\rightarrow$ All | `{ winnerIndex: number \| null, scores: number[], matchOver: boolean, suddenDeath: boolean }` | Updates phone score readout and signals match completion or sudden-death replay. |
| `bomb:rematch` | Host $\rightarrow$ All | `{ action: 'restart' \| 'lobby' }` | Restarts match cleanly or returns room to Lobby Carousel. |

### C. Flat Simulation State Buffer (`Float32Array` SoA Layout)
Pre-allocated once on game mount (`MAX_PLAYERS = 8`). Uses the exact platform snapshot size (`88 floats` = **352 bytes**) for zero-change compatibility with `HostLoop`, `BroadcastChannel` mirrors, and Stretch 2 128-byte-aligned `SharedArrayBuffer`.

* **Global Arena Header (Indices `0..7` — 32 bytes):**
  ```text
  [0] tickId            (monotonic fixed-step tick counter)
  [1] phaseEnum         (0=COUNTDOWN, 1=ROUND_ACTIVE, 2=ROUND_END, 3=MATCH_OVER, 4=PRACTICE)
  [2] phaseTimer        (seconds remaining in phase; during ROUND_ACTIVE holds blast breather timer when bombHolder === -1, else elapsed round seconds)
  [3] arenaRadius       (constant solid circular wall radius = 400.0)
  [4] bombHolder        (active holder slot index 0..7, or -1 when no bomb is armed)
  [5] bombTimer         (seconds remaining on active bomb fuse, 0.0 .. 15.0)
  [6] transferCooldown  (seconds remaining on bomb transfer lockout, 0.0 .. 0.50)
  [7] roundFlags        (Bit0=ROUND_SUDDEN_DEATH, Bit1=MATCH_SUDDEN_DEATH)
  ```
* **Per-Player State Stride (`10` floats per player $\times$ `8` slots = `80` floats, Indices `8..87`):**
  For player `i` (`0..7`), base offset is `base = 8 + i * 10`:
  ```text
  [base + 0] x               (world X position; retains blast X while effectTimer > 0)
  [base + 1] y               (world Y position; retains blast Y while effectTimer > 0)
  [base + 2] vx              (velocity X)
  [base + 3] vy              (velocity Y)
  [base + 4] angle           (facing angle in radians)
  [base + 5] dashCooldown    (0.0 .. 1.50s)
  [base + 6] dashActiveTimer (0.0 .. 0.18s)
  [base + 7] effectTimer     (0.0 .. 0.85s: transfer flash while ALIVE, blast ring decay when EXPLODED)
  [base + 8] flags           (Bit0=ALIVE, Bit1=HOLDING_BOMB, Bit2=IS_BOT, Bit3=DISCONNECTED, Bit4=SUDDEN_DEATH_CONTENDER, Bit5=EXPLODED_THIS_ROUND)
  [base + 9] score           (accumulated match points)
  ```
* **Flags Source of Truth:** `flags` bit 0 (`ALIVE`) is the source of truth for living pucks. Header `bombHolder` (`state[4]`) and `flags` bit 1 (`HOLDING_BOMB`) stay strictly synchronized on every tick.
* **Total Snapshot Size:** `88 floats` = **352 bytes**.

### D. Route & Viewport Endpoints
No new HTTP endpoints are required beyond the Console OS routes:
* **Primary Display:** `GET /screen?room={CODE}&view=holistic` (mounts `BombPassRenderer` via lazy `import()`).
* **Secondary Displays:** `GET /screen?room={CODE}&view=team-{N}` (renders platform Standby Screen).
* **Controllers:** `GET /controller?room={CODE}` (dynamically mounts `BombPassController` on `game:mount`).

---

## 5. Finite State Machines (FSM)

### A. Match & Round Lifecycle FSM
```text
                  [Host taps START]
                         │
                         ▼
                 ┌───────────────┐
       ┌────────►│   PRACTICE    │ (10s opening / 5s between rounds:
       │         └───────┬───────┘  solid arena, no bomb, no points)
       │                 │ timer <= 0, spawn reset
       │                 ▼
       │         ┌───────────────┐◄──────────────────────────────┐
       │         │   COUNTDOWN   │ (3.0s: locked on spawn ring,  │
       │         └───────┬───────┘  facing only)                 │
       │                 │ timer <= 0, assign random bomb        │
       │                 ▼                                       │
       │         ┌───────────────┐                               │
       │    ┌───►│ ROUND_ACTIVE  │ (120Hz physics, 15s fuse,     │
       │    │    │  (BOMB LIVE)  │  0.5s transfer cooldown)      │
       │    │    └───────┬───────┘                               │
       │    │            │ bombTimer <= 0 (detonate holder       │
       │    │            │ + point-blank blast zone)             │
       │    │            ▼                                       │
       │    │     { aliveCount? }                                │
       │    │     /      │      \                                │
       │    │  >=2      ==1     ==0 (simultaneous last-2 wipe)   │
       │    │   │        │        │                              │
       │    │   ▼        │        ▼                              │
       │    │ [0.85s     │   set ROUND_SUDDEN_DEATH              │
       │    │  blast     │   (0 pts, contenders = final victims) │
       │    │  breather] │        │                              │
       │    └───┘        ▼        ▼                              │
       │         ┌───────────────────────┐                       │
       │         │       ROUND_END       │ (0.8s / 1.5s banner)  │
       │         └───┬───────┬───────┬───┘                       │
       │             │       │       │                           │
       │   normal,   │       │       └── ROUND_SUDDEN_DEATH ─────┘
       │   no winner │       │           (7.5s fuse, skip PRACTICE)
       └─────────────┘       │
                             ▼ unique leader >= targetScore
                     ┌───────────────┐
                     │  MATCH_OVER   │ (Podium + Play Again /
                     └───────┬───────┘  Return to Lobby)
                             │
                   [bomb:rematch action]
```

### B. Per-Puck Action FSM
| Current State | Trigger / Condition | Next State | Side Effects |
| :--- | :--- | :--- | :--- |
| `SPAWN_LOCKED` | `phase === ROUND_ACTIVE` | `MOVING` or `HOLDING_BOMB` | Enables movement and dash; selected slot receives bomb. |
| `MOVING` | `DASH` rising edge & `dashCooldown <= 0` | `DASHING` | Applies $v_{\text{dash}}$ burst; `dashActiveTimer = 0.18`, `dashCooldown = 1.50`. |
| `MOVING` / `DASHING` | Overlap with `bombHolder` & `transferCooldown <= 0` (wins tie-break) | `TRANSFER_LOCKED` | Becomes `bombHolder`; `transferCooldown = 0.50`; `effectTimer = 0.50`; recoil scale `1.25x`. |
| `TRANSFER_LOCKED` | `transferCooldown <= 0` | `HOLDING_BOMB` | Can now pass the bomb on contact. |
| `HOLDING_BOMB` | Overlap with `ALIVE` puck & `transferCooldown <= 0` | `MOVING` | Clears `HOLDING_BOMB` bit; recoil scale `1.25x`; emits `bomb:holder`. |
| `HOLDING_BOMB` / `TRANSFER_LOCKED` | Slot disconnects (`(connectedMask & (1 << i)) === 0`) | `DISCONNECTED_IDLE` | Auto-passes bomb to closest eligible `ALIVE` puck (`bombTimer = max(bombTimer, 2.0)`); zeroes inputs. |
| `HOLDING_BOMB` / `TRANSFER_LOCKED` / `MOVING` | `bombTimer <= 0` and (is holder OR within $r_{\text{blast}} = 64$) | `ELIMINATED` | Clears `ALIVE` bit; sets `EXPLODED_THIS_ROUND`; `effectTimer = 0.85`; ignores inputs until next round/break. |

---

## 6. Strict System & Physics Invariants

Every PR or AI-generated change to `bomb-pass` must preserve these invariants:

1. **INV-1 (No NaN / Infinity State):** For every tick $t$ and index $k \in [0, 87]$, `Number.isFinite(state[k]) === true`. Exact-center overlap ($\|\vec{p}_j - \vec{p}_i\| = 0$) falls back to deterministic unit vector $(\cos(i), \sin(i))$.
2. **INV-2 (Strict Radial Containment):** After every `PRACTICE` and `ROUND_ACTIVE` tick, every `ALIVE` puck satisfies $\sqrt{x_i^2 + y_i^2} \le R_{\text{arena}} - r_{\text{puck}}$ via `clampRadialBoundary`.
3. **INV-3 (Single Bomb Conservation):** During `ROUND_ACTIVE`, either `bombHolder === -1` (blast breather) and zero pucks have `HOLDING_BOMB`, OR `bombHolder` is an integer in `[0, 7]` whose `ALIVE` bit is `1` and **exactly one** puck has `HOLDING_BOMB`.
4. **INV-4 (Monotonic Timers & Lockout Integrity):** `bombTimer`, `transferCooldown`, `dashCooldown`, `dashActiveTimer`, and `effectTimer` stay clamped to $[0, \max]$ and never go negative. While `transferCooldown > 0`, puck collisions never change `bombHolder`.
5. **INV-5 (Single Transfer Per Tick & Deterministic Cluster Tie-Break):** At most one collision transfer occurs per tick. Multi-puck simultaneous contact always resolves by smallest `distSq`, then highest closing speed, then lowest slot index.
6. **INV-6 (Disconnect Auto-Pass Safety):** If `bombHolder` is disconnected while at least one other `ALIVE` puck exists, `step(dt)` auto-passes the bomb to the closest eligible `ALIVE` puck on the next tick with `bombTimer >= 2.0s`. Disconnected pucks are never auto-eliminated.
7. **INV-7 (Elimination Immutability & Sudden Death Score Consistency):** Once `ELIMINATED` in a round, inputs cannot revive or move the puck until the next break/countdown. Simultaneous final-survivor explosions award `0` points and set `ROUND_SUDDEN_DEATH`.
8. **INV-8 (Zero-Allocation Tick):** Executing `10,000` consecutive `simulation.step(1/120)` ticks produces `0` dynamic object allocations inside the physics loop.
9. **INV-9 (Bit-Exact Determinism):** Replaying the same seed and 8-byte input log produces bit-identical `Float32Array` snapshots at tick $N$.
10. **INV-10 (Strict View Isolation):** Mounting `bomb-pass` on `/screen?view=team-1` never instantiates `BombPassRenderer`; only `/screen?view=holistic` renders the arena.

---

## 7. Testing & Verification Plan

### 1. Deterministic Unit Tests (`vitest`)
* **Solid Boundary Containment (`INV-2`):** Dash a puck radially at $v_{\text{dash}} = 880$ into the rim and assert $\sqrt{x^2 + y^2} \le R_{\text{arena}} - r_{\text{puck}}$ and inward velocity reflection.
* **Bomb Assignment & 15s Fuse (`INV-3`, `INV-4`):** Start a seeded match, step past `PRACTICE` and `COUNTDOWN`, assert `bombHolder` is a valid `ALIVE` slot and `bombTimer === 15.0`. Hold without contact for `15.0s` and assert the holder explodes (`ALIVE === 0`) and remaining survivors enter the `0.85s` breather before a new bomb arms.
* **Transfer & 0.5s Cooldown (`INV-4`):** Collide holder `P0` with `P1`. Assert `bombHolder === 1`, `transferCooldown === 0.50`, and `bombTimer` is preserved. Force immediate second overlap `0.1s` later and assert `bombHolder` stays `1`. Force overlap at `0.55s` and assert transfer back to `P0`.
* **Multi-Puck Cluster Tie-Break (`INV-5`):** Place `P1` (`dist = 40`) and `P2` (`dist = 48`) overlapping holder `P0` on the same tick. Assert bomb transfers only to `P1`. Test equal-distance tie-break by closing speed and by lowest slot index.
* **Disconnect Auto-Pass (`INV-6`):** With `P0` holding the bomb (`bombTimer = 0.8s`), `P1` at distance `120`, and `P2` at distance `260`, mark `P0` disconnected via `setConnectedMask`. Step once and assert `bombHolder === 1`, `bombTimer === 2.0`, `transferCooldown === 0.50`, and `P0` remains `ALIVE`.
* **Simultaneous Last-2 Explosion -> Sudden Death (`INV-7`):** With 2 alive pucks locked inside $r_{\text{blast}} = 64$ while `transferCooldown > 0`, expire `bombTimer`. Assert both explode on the same tick, `0` points are awarded, `ROUND_SUDDEN_DEATH` is set, and the next countdown launches directly with a `7.5s` fuse.
* **Heuristic Bot Chase & Flee (`heuristic.test.ts`):** Verify a bot holding the bomb steers toward the nearest alive puck and dashes in range; verify a non-holder bot steers away from the bomb holder and slides tangentially along the wall when near $0.85 \cdot R_{\text{arena}}$ instead of pinning into the rim.

### 2. State Machine & Property-Based / Fuzz Tests
* **10,000-Tick 8-Player Fuzz Simulation:** Feed deterministic pseudo-random binary inputs and periodic simulated disconnects into `BombPassSimulation` for `10,000` ticks across multiple rounds. Assert `INV-1` through `INV-7` after every single tick.
* **Determinism Replay Verification (`INV-9`):** Run two simulations with identical seed and input sequence; assert byte-exact `Float32Array` equality at tick `5,000`.
* **Illegal FSM Transitions:** Verify `applyInput()` is a no-op in `ROUND_END` and `MATCH_OVER`, aim-only in `COUNTDOWN`, and ignored for `ELIMINATED` slots.

### 3. Hardware, Network & Latency Verification Checklist (M5 Pro Mac + Phones)
* **Phone Bomb Danger Indicator & Multi-Touch Check:** On iPhone Safari and Android Chrome, steer continuously with `<VirtualJoystick/>` while tapping `<ArcadeButton label="DASH"/>`. Pass and receive the bomb 5 times; verify the red danger border, countdown strip, and haptics toggle cleanly with zero dropped touch tracking and zero edge-swipe freezes.
* **Disconnect Auto-Pass & Rejoin Check (FR-5 #3 + FR-9):** Lock the phone of the current bomb holder mid-round; verify the bomb auto-passes immediately to the closest alive player on `/screen`. Unlock / rescan the top-left `SCAN TO REJOIN` QR with the same phone; confirm `sessionToken` restores the original slot and control. Attempt a stranger join and a lobby-AWAY token join mid-match; both must receive `MATCH_IN_PROGRESS`.
* **In-Match Exit Check (FR-10):** On the primary host tab during a live Bomb Pass match, tap the top-right `[x]` (`MatchExitControl`), confirm, and verify `resetLobby()` returns the lobby carousel on every screen and phone (`game:unmount` + `room:phase: lobby`). Cancel must leave the match running.
* **WebRTC & Fallback Check:** Verify `UDP-DIRECT` input on 5GHz LAN and `WS-FALLBACK` within 3s when UDP is blocked.
* **Strict Holistic Standby Check:** Open `/screen?room=ABCD&view=holistic` on Monitor 1 and `/screen?room=ABCD&view=team-1` on Monitor 2; launch `bomb-pass` and confirm Monitor 2 stays on `STANDBY — THIS GAME USES HOLISTIC VIEW` (`INV-10`).
