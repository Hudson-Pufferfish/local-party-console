# Sumo Dash (`sumo-dash`) — v1 Vertical Slice & Latency Benchmark Spec

> **AI Agent Instruction:** Read `../SPEC.md` and `./README.md` before implementing this module. **Sumo Dash** is Game #0 (our v1 vertical slice and end-to-end latency testbed). Implement it strictly as a self-contained plugin under `/games/sumo-dash` conforming to `GameDefinition`. Zero game-specific logic may leak into `/server`, `/screen`, or `/controller` shells.

---

## 1. Overview & `GameManifest` Contract

**Sumo Dash** is a fast-paced, 2-to-8 player top-down 2D arena brawler where chunky Neo-Brutalist pucks steer and dash to knock opponents off a shrinking circular steel platform. Rounds last 15–30 seconds; first player to **5 round wins** takes the match. v1 is human players only. v1.1 fills empty slots with the heuristic bot.

### Declarative Manifest (`manifest.ts`)
```typescript
import type { GameManifest } from '@shared/types';

export const SUMO_DASH_MANIFEST: GameManifest = {
  id: 'sumo-dash',
  title: 'SUMO DASH',
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
  themeTokens: {
    '--bg-surface': '#EAE6DF',      // Matte Warm Putty
    '--ink-primary': '#111111',     // Industrial Carbon
    '--accent-hazard': '#FF4D00',   // Safety Orange
    '--accent-ready': '#00C853',    // Hardware LED Green
    '--arena-plate': '#D6D1C7',     // Brushed Steel Plate
  },
};
```

---

## 2. Functional Requirements (FR)

### FR-1: Arena Geometry & Shrinking Hazard Ring
* **Coordinate Space:** Authoritative 2D world centered at $(0, 0)$ in normalized meters/units.
* **Initial Arena Radius:** $R_0 = 400\text{ units}$.
* **Minimum Arena Radius:** $R_{\min} = 110\text{ units}$, held, then a closing floor $R_{\text{floor}} = 26$.
* **Shrinking Cadence:**
  * For the first $5.0\text{s}$ of `ROUND_ACTIVE`, $R(t) = R_0$ (safe opening skirmish).
  * After that the hazard ring shrinks continuously at $v_{\text{shrink}} = 14\text{ units/s}$ until $R_{\min}$.
  * It holds at $R_{\min}$ for $4.0\text{s}$. If everyone is still in, it closes at $36\text{ units/s}$ down to $R_{\text{floor}}$. On that small ring, if more than one puck would leave in the same tick, only the outermost is out, so the round still awards a point. At the floor the outermost puck is out, one at a time.
  * A dashed orange warning ring ($R_{\text{target}}$) previews the next $3.0\text{s}$ of shrinkage so players can read ledge positioning.
* **Spawn Formation:** Active players $N \in [2, 8]$ spawn equidistantly on a circle of radius $R_{\text{spawn}} = 240\text{ units}$, facing inward toward $(0, 0)$:
  $$\theta_i = \frac{2\pi i}{N}, \quad (x_i, y_i) = (R_{\text{spawn}}\cos\theta_i,\ R_{\text{spawn}}\sin\theta_i)$$

### FR-2: Puck Movement, Steering & Friction
* **Puck Physical Constants:**
  * Radius: $r_{\text{puck}} = 28\text{ units}$
  * Base Mass: $m = 1.0$
  * Max Steering Acceleration: $a_{\text{move}} = 1800\text{ units/s}^2$
  * Linear Damping (Ice/Steel Drag): $\mu = 4.2\text{ s}^{-1}$ applied per tick as $\vec{v} \leftarrow \vec{v} \cdot e^{-\mu \Delta t}$
  * Normal Max Speed: $v_{\max} = 420\text{ units/s}$
* **Deadzone:** Joystick input magnitude $\|\vec{u}\| < 0.12$ is clamped to $(0, 0)$ to eliminate thumb jitter.
* **Heading:** Puck nose-wedge angle smoothly tracks the non-zero joystick vector (or retains its last heading when idle).

### FR-3: Dash / Ram Mechanic & Elastic Knockback
* **Trigger:** Rising edge of `DASH` button (`Bit 0` transitions `0 -> 1`) while `dashCooldown <= 0` and puck is `ALIVE`.
* **Dash Impulse:**
  * Instant velocity burst of $v_{\text{dash}} = 920\text{ units/s}$ along the current steering direction (or facing angle if joystick is neutral).
  * `dashActiveTimer` set to $0.18\text{s}$ (high-impact ramming window; steering reduced by $70\%$ during dash).
  * `dashCooldown` set to $1.50\text{s}$ (recharges linearly to $0$).
* **Puck-to-Puck Collision Resolution:**
  * Overlap detected when $\|\vec{p}_j - \vec{p}_i\| < 2 r_{\text{puck}}$.
  * Separate overlapping pucks symmetrically along the collision normal $\hat{n} = \frac{\vec{p}_j - \vec{p}_i}{\|\vec{p}_j - \vec{p}_i\|}$.
  * Apply elastic impulse along $\hat{n}$ with restitution $e = 0.85$.
  * **Dash Ram Multiplier:** If Puck $i$ has `dashActiveTimer > 0` and Puck $j$ does not, multiply knockback impulse applied to Puck $j$ by **$1.75\times$** and set Puck $j$'s `stunTimer = 0.22s` (briefly reduces steering authority by $60\%$).
  * **Mutual Dash Clash:** If both pucks are dashing, apply **$1.4\times$** symmetric recoil to both pucks and trigger a clash spark + hit-stop.

### FR-4: Ring-Out Elimination, Scoring & Match Win Condition
* **Ring-Out Rule:** A puck is immediately marked `ELIMINATED` the tick its center crosses the outer hazard line:
  $$\sqrt{x_i^2 + y_i^2} > R_{\text{arena}}(t)$$
* **Round Resolution:**
  * When `aliveCount <= 1`, transition to `ROUND_END` (last standing puck receives $+1$ point). If every puck still alive would leave on the same tick while the ring is above $R_{\min}$, nobody is eliminated and no point is awarded: centers are pulled just inside the ring and outward speed is cancelled, so the round does not restart.
  * Display round winner banner for $2.5\text{s}$, then reset arena for the next round.
* **Match Victory:** First player to reach **5 points** transitions the match to `MATCH_OVER`, displaying final podium standings, match telemetry summary, and a **Play Again / Return to Lobby** control for the host.

### FR-5: Phone Controller Layout & Feedback
* **Layout (Landscape Forced via Pre-Flight Strip):**
  * **Left Half:** `<VirtualJoystick/>` (continuous $X, Y$ mapped to `Int8` $[-127, 127]$).
  * **Right Half:** Single oversized `<ArcadeButton label="DASH"/>` (`Bit 0`).
  * **Top Bar (Slim):** `<PlayerBadge/>` showing assigned slot color (`P1`–`P8`), current score, and `ALIVE / OUT` status LED.
* **Cooldown & State Feedback:**
  * While `dashCooldown > 0`, the `DASH` button renders a crisp hard-edged fill bar synced from lightweight control-plane cooldown events (or local $1.5\text{s}$ visual timer triggered on press to avoid extra network traffic).
  * On heavy collision or elimination, the Host sends a tiny reliable haptic cue (`sumo:haptic`) triggering `navigator.vibrate(25)` / iOS Taptic switch feedback.

### FR-6: Disconnect
If a phone stops sending input, that slot's axes and buttons become zero until the `localStorage` session token reconnects. The puck is not eliminated by the disconnect. v1 has no bot to take the slot.

### FR-7: Industrial Neo-Brutalist Visuals & Game Feel (Zero Art Assets)
* All visuals rendered procedurally in Phaser 4 (`Graphics` / generated Canvas textures):
  * Matte Warm Putty background (`#EAE6DF`), circular steel plate (`#D6D1C7`) with thick `4px #111111` rim and radial degree ticks.
  * Each puck rendered with its P1–P8 high-contrast fill, `3px #111111` border, hard offset shadow (`+5px, +5px`), directional nose wedge, and a radial `DASH` cooldown arc around the rim.
  * **Hit-Stop & Juice:** Heavy dash impacts set `hitStopFrames = 3`. The renderer keeps drawing those frames. `step(dt)` keeps running, and input keeps arriving. Camera shake is a soft subpixel nudge of at most 0.5px (`0.5 -> 0.25 -> 0`), not a skipped frame. Sparks are hard-edged squares (no soft blur).

### Heuristic bot
An empty bot slot calls `applyInput(botIndex, buttons, axisX, axisY)` at 60Hz inside the host sim. Levels are a 1–20 scale. Each Start and Play again shuffles `{1,2,3,4,5,6,7}` and assigns the first N values to the N bots in slot order (`assignBotLevels`), so every bot is a distinct integer from 1–7 and the strongest living-room bot is 7/20. Levels 8 through 20 are never assigned. The live host draws once with `Math.random` when the roster is armed. Tests pass a seeded rng; the same seed returns the same levels.

Curves use $\text{share} = \text{level}/20$. Staying on the ring is a shared floor: even 1/20 moves, maneuvers, dashes sometimes, and does not steer itself off. Levels differ by dash cadence and approach angle, not by aim noise that walks them out.

1. If the bot is outside its safe radius, steer toward $(0, 0)$. Safe radius is $(0.80 + 0.03 \cdot \text{share}) \cdot R_{\text{arena}}$, still inside the ring.
2. Else steer toward the nearest alive opponent's predicted point $\vec{p}_j + 0.15 \cdot \vec{v}_j$, turned by $(1 - \text{share}) \cdot 0.12$ radians (the side flips with the slot). The aim point is then pulled back inside the safe radius. Stick magnitude is $(0.50 + 0.15 \cdot \text{share})$ of full, so the walk is easier to beat than the dash.
3. If the opponent's center is inside $96$ and this bot is the inner one, mix an outward push with a slot-sided slide. The outward share is $0.48 + 1.05 \cdot \text{share}$, so a low level slides more and a higher level shoves cleaner. The outer bot gives ground toward the center once it is more than $16$ px further out.
4. Fire `DASH` when the opponent is inside the level's range, alignment clears the level's bar, and the landing stays inside $0.85 \cdot R_{\text{arena}}$. Range is $80 + 300 \cdot \text{share}$. Alignment is $0.94 - 0.08 \cdot \text{share}$. A higher share dashes from farther away and from wider angles. A level whose range sits inside the $96$px contact band still dashes: if the contact slide misses the alignment bar, that tick steers along the approach instead. A missed dash stays inside the ring, and the next steer turns back at the safe radius. The outer bot still yields and does not dash through that yield.

### Scoreboard and practice
The holistic screen lists everyone in the match in the cream to the right of the arena, in slot order, not ranked, with each player's puck color circle before their tag and score: `hu 1/3` then `da 0/3`. The tag is the first two letters of the name, or `pN` when the slot has none. It follows the score fields. First to 3 round wins ends the match. The match, and every later round, opens with 10s of practice (move and dash, full ring, no points). `BREAK` and the seconds left, the countdown digit, `POINT`, and `<TAG> WINS` sit in the cream above the arena, not on the ring. `POINT` is the short flash when a non-final round scores; the match-winning round switches straight to `<TAG> WINS` and holds it through match over. The opening break places everyone on the spawn ring. After a scored round the break does not: the eliminated puck is revived just inside the full ring and everyone else stays put. When that timer hits zero, spawn resets once into the 3-2-1 countdown. That lineup is the only teleport during a live break, and `BREAK` is on screen before it.

---

## 3. Non-Functional Requirements (NFR)

| Category | Requirement | Target / Enforcement |
| :--- | :--- | :--- |
| **Fixed Timestep Determinism** | Physics runs at a fixed $120\text{Hz}$ ($\Delta t = \frac{1}{120}\text{s} \approx 8.333\text{ms}$) using an accumulator loop. Given identical initial seed + binary input stream, `step(dt)` must produce bit-identical `Float32Array` outputs. | Zero `Math.random()` inside `step(dt)`; zero wall-clock `Date.now()` dependencies. |
| **Zero-Allocation Hot Path** | Neither `GameSimulation.step(dt)` nor the phone's `pointermove` handler may allocate objects, arrays, or closures during `ROUND_ACTIVE`. | Verified via Chrome DevTools Allocation Profiler ($0\text{ B/frame}$ heap churn). |
| **End-to-End Latency** | Total Motion-to-Photon ($T_{\text{touch}} + T_{\text{js}} + T_{\text{net}} + T_{\text{sim}} + T_{\text{render}}$) over 5GHz LAN. | **$< 25\text{ms}$ p50**, **$< 40\text{ms}$ p99** on modern phones; **$< 55\text{ms}$ p99** on 30Hz ULP phones. |
| **Mobile Ergonomics** | All touch targets (`<VirtualJoystick/>`, `<ArcadeButton/>`) strictly inset **$\ge 36\text{px}$** from screen edges; `setPointerCapture` locked per `pointerId` for independent simultaneous left/right multi-touch. | Zero iOS Safari edge-swipe freezes; zero dropped multi-touch events. |
| **Strict View Compliance** | Strictly enforces `mode: 'holistic'`. Opening `/screen?view=team-1` while `sumo-dash` is active must display the platform's `STANDBY // THIS GAME USES HOLISTIC VIEW` state with $0\%$ GPU physics/render cost. | Enforced by `/screen` viewport router. |
| **Weak-Phone Compatibility** | Phone controller is event-driven (no continuous `rAF` loop). v1 warns on 30Hz Low Power Mode and still accepts that phone's input. The 30Hz send cap is Stretch 1. | $0\%$ idle phone GPU utilization. |

---

## 4. Technical Contracts, Memory Layouts & Endpoints

### A. Data-Plane Binary Input Contract (8 Bytes — WebRTC UDP / `ws` Fallback)
Conforms strictly to `SPEC.md` Part 3.3. Sent at up to $60\text{Hz}$ (or $30\text{Hz}$ in ULP mode):

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
The host Chrome tab is the authority for these payloads. Fastify relays the envelope `{ type, roomId, payload }` on `/ws?room=ABCD` and does not implement Sumo rules.

| Event `type` | Direction | Payload Schema | Purpose |
| :--- | :--- | :--- | :--- |
| `game:mount` | Server $\rightarrow$ All | `{ gameId: 'sumo-dash', manifest, players: PlayerSlot[] }` | Mounts Phaser renderer on `/screen` and morphs all phones to Sumo Controller. |
| `sumo:round_start` | Server $\rightarrow$ All | `{ roundNumber: number, countdownMs: 3000, scores: number[] }` | Triggers 3-2-1 countdown HUD on screen and resets phone status LEDs to `ALIVE`. |
| `sumo:elimination` | Server $\rightarrow$ All | `{ playerIndex: number, knockedBy: number \| null, aliveCount: number }` | Updates phone badge to `OUT` and triggers elimination haptic pulse. |
| `sumo:haptic` | Server $\rightarrow$ Phone | `{ intensity: 'light' \| 'heavy' \| 'out' }` | Fires short local vibration/Taptic feedback on dash impact or ring-out. |
| `sumo:round_end` | Server $\rightarrow$ All | `{ winnerIndex: number \| null, scores: number[], matchOver: boolean }` | Displays round scoreboard or transitions to `MATCH_OVER` podium. |
| `sumo:rematch` | Host Phone $\rightarrow$ Server | `{ action: 'restart' \| 'lobby' }` | Restarts match cleanly or returns all clients to Lobby Carousel. |

### C. Flat Simulation State Buffer (`Float32Array` SoA Layout)
Pre-allocated once on game mount (`MAX_PLAYERS = 8`). Designed to map directly into the triple-buffered, 128-byte cache-aligned `SharedArrayBuffer` in Stretch 2:

* **Global Arena Header (Indices `0..7` — 32 bytes):**
  ```text
  [0] tickId            (float32 / int32 view)
  [1] phaseEnum         (0=COUNTDOWN, 1=ROUND_ACTIVE, 2=ROUND_END, 3=MATCH_OVER, 4=PRACTICE)
  [2] phaseTimer        (seconds remaining in current phase)
  [3] arenaRadius       (current hazard ring radius R(t))
  [4] targetRadius      (preview shrink ring radius)
  [5] aliveMask         (8-bit bitmask of alive players)
  [6] hitStopFrames     (visual freeze counter 0..3)
  [7] shakeIntensity    (0.0..1.0 camera trauma)
  ```
* **Per-Player State Stride (`10` floats per player $\times$ `8` slots = `80` floats, Indices `8..87`):**
  For player `i` (`0..7`), base offset is `base = 8 + i * 10`:
  ```text
  [base + 0] x               (world X position)
  [base + 1] y               (world Y position)
  [base + 2] vx              (velocity X)
  [base + 3] vy              (velocity Y)
  [base + 4] angle           (facing angle in radians)
  [base + 5] dashCooldown    (0.0 .. 1.50s)
  [base + 6] dashActiveTimer (0.0 .. 0.18s)
  [base + 7] stunTimer       (0.0 .. 0.22s)
  [base + 8] flags           (Bit0=ALIVE, Bit1=STUNNED, Bit2=IS_BOT)
  [base + 9] score           (round wins, 0 .. 3)
  ```
  `flags` bit 0 is the source of truth for alive. Header `aliveMask` is rewritten from those bits every tick. `IS_BOT` stays 0 in v1.
* **Total Snapshot Size:** `88 floats` = **352 bytes**. v1 copies this snapshot on `BroadcastChannel`. Stretch 2 maps it into the shared buffer.

### D. Route & Viewport Endpoints
No new HTTP endpoints are required beyond the Console OS routes:
* **Primary Display:** `GET /screen?room={CODE}&view=holistic` (mounts `SumoDashRenderer`).
* **Secondary Displays:** `GET /screen?room={CODE}&view=team-{N}` (renders platform Standby Screen).
* **Controllers:** `GET /controller?room={CODE}` (dynamically mounts `SumoDashController` on `game:mount`).

---

## 5. Finite State Machines (FSM)

### A. Match & Round Lifecycle FSM
```text
                  [Host taps START]
                         │
                         ▼
                 ┌───────────────┐
       ┌────────►│   PRACTICE    │ (10s: move and dash on the full ring,
       │         └───────┬───────┘  no score, no elimination)
       │                 │ timer <= 0, spawn reset
       │                 ▼
       │         ┌───────────────┐
       │         │   COUNTDOWN   │ (3.0s: pucks locked on spawn ring,
       │         └───────┬───────┘  facing only)
       │                 │ timer <= 0
       │                 ▼
       │         ┌───────────────┐
       │         │ ROUND_ACTIVE  │ (120Hz physics, shrinking ring,
       │         └───────┬───────┘  inputs live, bots active)
       │                 │ aliveCount <= 1
       │                 ▼
       │         ┌───────────────┐
       │         │   ROUND_END   │ (0.5s beat; score already awarded)
       │         └───┬───────┬───┘
       │             │       │
   maxScore < 3 ─────┘       └───── maxScore >= 3
                                         │
                                         ▼
                                 ┌───────────────┐
                                 │  MATCH_OVER   │ (Podium + Telemetry Export
                                 └───────┬───────┘  + Rematch / Return to Lobby)
                                         │
                             [sumo:rematch action]
```

### B. Per-Puck Action FSM
| Current State | Trigger / Condition | Next State | Side Effects |
| :--- | :--- | :--- | :--- |
| `SPAWN_LOCKED` | `phase === ROUND_ACTIVE` | `MOVING` | Enables steering and dash input. |
| `MOVING` | `DASH` rising edge & `dashCooldown <= 0` | `DASHING` | Applies $v_{\text{dash}}$ impulse; `dashActiveTimer = 0.18`, `dashCooldown = 1.50`. |
| `DASHING` | `dashActiveTimer <= 0` | `MOVING` | Restores $100\%$ steering authority. |
| `MOVING` / `DASHING` | Hit by opposing `DASHING` puck | `STUNNED` | Applies $1.75\times$ knockback impulse; `stunTimer = 0.22`; sends `sumo:haptic('heavy')`. |
| `STUNNED` | `stunTimer <= 0` | `MOVING` | Restores normal steering authority. |
| *Any Active State* | $\sqrt{x^2 + y^2} > R_{\text{arena}}(t)$ | `ELIMINATED` | Clears `ALIVE` bit; emits `sumo:elimination`; ignores further inputs until next round. |

---

## 6. Strict System & Physics Invariants

Every PR or AI-generated change to `sumo-dash` must preserve these invariants:

1. **INV-1 (No NaN / Infinity State):** For all ticks $t$ and all player slots $i \in [0, 7]$, every float in the `Float32Array` state buffer must satisfy `Number.isFinite(state[k]) === true`. Division by zero during exact-center puck overlap ($\|\vec{p}_j - \vec{p}_i\| = 0$) must fall back to a deterministic unit vector $(\cos(i), \sin(i))$.
2. **INV-2 (Bounded Arena Radius):** $R_{\min} \le R_{\text{arena}}(t) \le R_0$ at all times, and $R_{\text{arena}}(t)$ is monotonically non-increasing within a single round.
3. **INV-3 (Monotonic Cooldowns & Timers):** `dashCooldown`, `dashActiveTimer`, and `stunTimer` are strictly clamped to $[0, \max]$ and never go negative.
4. **INV-4 (Elimination Immutability):** Once a puck transitions to `ELIMINATED` during a round, its `ALIVE` bit remains `0` and its input packets cannot re-enable it or affect `ALIVE` pucks until the next `PRACTICE` resets the round.
5. **INV-5 (Strict Score Consistency):** Total points awarded across all players after $K$ completed rounds satisfies $\sum_{i=0}^{7} \text{score}_i \le K$. A same-tick wipe does not complete a round.
6. **INV-6 (Zero-Allocation Tick):** Executing `10,000` consecutive `simulation.step(1/120)` ticks produces $0$ dynamic object allocations inside the physics loop.
7. **INV-7 (Bit-Exact Determinism):** Replaying the same 8-byte input sequence from the same player count in the same Chrome build produces identical `Float32Array` snapshots at tick N. A later WASM port must re-check this. It is not automatic.
8. **INV-8 (Strict View Isolation):** Mounting `sumo-dash` when a monitor is open on `/screen?view=team-1` must never execute `SumoDashRenderer` on that tab; only `/screen?view=holistic` renders the arena.

---

## 7. Testing & Verification Plan

### 1. Deterministic Unit Tests (`vitest`)
* **Collision & Knockback Math:** A head-on hit applies equal-and-opposite impulses (momentum conserved) with restitution $e = 0.85$ (kinetic energy drops). A dashing puck applies $1.75\times$ knockback and `0.22s` stun to a non-dashing puck. Zero-distance overlap does not produce `NaN` (`INV-1`).
* **Dash Edge-Triggering:** Verify holding `Bit 0 = 1` across multiple frames only fires **one** dash on the rising edge (`0 -> 1`) and respects the $1.50\text{s}$ cooldown (`INV-3`).
* **Ring-Out & Simultaneous Wipe:** Place two pucks outside the ring on the exact same tick and verify the round stays active, both stay alive inside the ring, and the score does not change (`INV-5`).
* **v1.1 bot safety:** Spawn a bot at $0.85 \cdot R_{\text{arena}}$ and verify its output vector points toward $(0, 0)$ and does not dash off the ring. `heuristic.test.ts` covers that vector.

### 2. State Machine & Property-Based / Fuzz Tests
* **10,000-Tick Fuzz Simulation:** Feed randomized 8-player binary inputs (`Uint8` bitmasks and `Int8` axes) into `GameSimulation` for $10,000$ ticks across multiple rounds. Assert `INV-1` through `INV-5` after every single tick.
* **Determinism Replay Verification (`INV-7`):** Record a 30-second randomized 8-player input log, reset `GameSimulation`, replay the bytes in the same Chrome build, and assert `Buffer.compare(finalStateA, finalStateB) === 0`. The 5MB flight recorder file is Stretch 3. v1 may keep the log in a test fixture.
* **Illegal FSM Transitions:** Verify `applyInput()` is a strict no-op during `COUNTDOWN`, `ROUND_END`, and `MATCH_OVER`, and that a disconnected/reconnected player mid-round resumes with their exact `ALIVE`/`ELIMINATED` state intact.

### 3. Hardware, Network & Latency Verification Checklist (M4 Mac + Phones)
* **Multi-Touch Safari/Chrome Check:** On both an iPhone (Safari) and Android phone (Chrome), hold `<VirtualJoystick/>` in continuous circular motion while tapping `<ArcadeButton label="DASH"/>` 10 times rapidly. Verify zero lost joystick tracking and zero iOS edge-swipe triggers.
* **WebRTC and fallback:**
  1. Connect 2 phones on 5GHz LAN. The host Chrome tab is the peer. Input arrives as `UDP-DIRECT` with `TouchLag < 4ms`, `Net p50 < 4ms`, and `Loss < 0.5%` once Stretch 1 HUD exists. Until then, log the same fields.
  2. Block UDP on 1 phone. That phone falls back to `WS-FALLBACK` within 3s and play continues.
* **30Hz Low-Power Mode Test:** Enable iOS Low Power Mode on a test iPhone, scan QR code $\rightarrow$ verify Pre-Flight Strip displays the amber `30Hz Low Power` warning, and verify gameplay auto-caps cleanly to `[ULP 30Hz]` without rubber-banding on the M4 monitor.
* **Strict Holistic Standby Check:** Open `/screen?room=ABCD&view=holistic` on Monitor 1 and `/screen?room=ABCD&view=team-1` on Monitor 2 $\rightarrow$ launch `sumo-dash` and verify Monitor 2 stays on `STANDBY // THIS GAME USES HOLISTIC VIEW` (`INV-8`).