# Cyber-Citadel Defense (`cyber-citadel`) — Co-op Wave Defense Game Specification

> **AI Agent Instruction:** Read `../SPEC.md` and `./README.md` first. Cyber-Citadel Defense is a self-contained cooperative game plugin under `/games/cyber-citadel` conforming strictly to the platform `GameDefinition` contract. Never leak game-specific wave, enemy, or barricade logic into shared shells. Status: design only. Nothing in this file is implemented yet.

---

## 1. Overview & `GameManifest` Contract

Cyber-Citadel Defense is a cooperative wave defense game for 1 to 8 players (humans plus bots) rendered on one shared TV screen. The squad protects a central **Core** located in the middle of a square arena from 8 escalating waves of enemies, including drone swarms, shielded brutes, and a multi-phase Dreadnought boss. Basic weapon fire is automatic, enabling players to keep their left thumb on the analog stick while the right thumb exclusively controls tactical abilities via A, B, X, and Y button taps.

**Locked:** The only lose condition is Core HP reaching 0. Win condition requires clearing wave 8 by defeating the Dreadnought boss. A standard run spans 8 waves lasting 12 to 15 minutes, with 15-second breather breaks between waves. There are no individual rank points: everyone wins or loses together as a squad.

### Declarative Manifest (`manifest.ts`)

```typescript
import type { GameManifest } from '../../../shared/src/types/game.ts';

export const CYBER_CITADEL_MANIFEST: GameManifest = {
  id: 'cyber-citadel',
  title: 'CYBER-CITADEL', // Default display title.
  minPlayers: 1,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: true, // Heuristic policy lives in heuristic.ts.
  rendererType: 'phaser-2d',
  viewConfig: {
    mode: 'holistic',
    inputBufferMode: 'zero-buffer',
  },
  supportedOrientations: ['portrait', 'landscape'], // Default, same as Color Clash.
  controllerLayout: {
    preset: 'stick-diamond',
    buttons: [
      { bit: 0, glyph: 'A', label: 'RAIL', kind: 'tap', cooldownMs: 2500 },
      { bit: 1, glyph: 'B', label: 'DASH', kind: 'tap' },
      { bit: 2, glyph: 'X', label: 'SHIELD', kind: 'tap' },
      { bit: 3, glyph: 'Y', label: 'REVIVE', kind: 'tap' }, // Context label from pad:state (proposal).
    ],
  },
  themeTokens: {
    '--bg-surface': '#F4F1EA',
    '--ink-primary': '#111111',
    // Enemy and Core colors: TBD in the renderer PR.
  },
};
```

The `stick-diamond` preset and `ButtonSpec` definition exist in `shared/src/controller/layout.ts`, and `GameManifest.controllerLayout` is required by `shared/src/types/game.ts:38`. The `minPlayers: 1` setting integrates directly with the platform lobby rule `canStart(connectedCount, minPlayers)` in `shared/src/view/policy.ts:12-13`.

---

## 2. Functional Requirements (FR)

### FR-1: Arena, Core & $40 \times 40$ Path Grid Geometry

* **Arena Dimensions:** The arena is an 800 x 800 square coordinate space centered at (0, 0). On a 1920 x 1080 host display, it scales to a 1080 x 1080 center square, leaving ample side margin for `<ScoreboardPanel/>` and `<ScoreRulesPanel/>`.
* **Central Core:** The Core is a solid circular entity situated at (0, 0). Core physical radius and the EMP Core ring radius are TBD (tune in playtest).
* **Path Grid & Flow Field:** A $40 \times 40$ path navigation grid overlays the arena with cell size $800 / 40 = 20$ world units. Kinetic barricades placed by players occupy and block grid cells. Enemy swarms navigate toward the Core using a vector flow field recalculated when barricades change.
* **Perimeter Containment:** Players and ground enemies cannot exit the outer boundary. Boundary collision stops motion cleanly with zero damage, reusing `shared/src/physics-2d/boundary.ts`.

### FR-2: Player Movement, Downed State, Revive & Respawn

* **Movement:** Analog joystick input (packet bytes 6 and 7) drives velocity up to a maximum run speed. Player orientation follows the velocity heading vector. Player movement speed is TBD (tune in playtest).
* **Collision & Friendly Fire:**
  * **Friendly Fire:** Strictly disabled across all weapons and abilities. Auto-fire tracers, Button A (Piercing Laser / RAIL), Button B (DASH), and Super Bomb (EMP) never deal damage or apply knockback to teammates.
  * **Player-to-Player Collision (Soft Separation):**
    * **Live vs. Live (Healthy):** Mutual soft separation ($2 \times r_{\text{player}} = 48\text{px}$). When two living players overlap, a gentle position separation slides them apart without blocking velocity or causing hard bounces, preventing ships from stacking into a single point.
    * **Live vs. Downed (Any):** 100% pass-through (zero collision). Active living players can walk directly over and stand on downed allies to channel revive without physics resistance or tether breaks.
    * **Away Players:** Follows physiological state: living Away players softly separate living teammates; downed Away players allow 100% pass-through.
  * **NOTES(@agents):** Keep friendly fire disabled permanently. Enforce soft separation strictly between `isLive` players (`flags & CYBER_FLAG.JOINED !== 0` and `(flags & (CYBER_FLAG.DOWNED | CYBER_FLAG.RESPAWNING)) === 0`). Downed or respawning slots must be excluded from circle collision so revivers never get displaced.
* **Downed State:** When player HP drops to 0, the player becomes downed, crawling at 25% speed with a 15-second bleed-out timer. Player max HP is TBD (tune in playtest).
* **Revive Action:** An active teammate inside revive range can channel a revive by tapping Button Y. Revive requires a 2.5-second channel during which the reviver must remain in proximity. Revive range is TBD (tune in playtest).
* **Bleed-Out & Respawn:** If bleed-out completes without revive, the player enters respawn with an 8-second timer before reappearing at the Core. Each respawn subtracts 3% of Core max HP.
* **Respawn Protection:** Respawn costs are capped at 12% of Core max HP per wave, and respawn penalties can never reduce Core HP below 1 HP. Only enemy attacks can deliver the final blow to destroy the Core.
* **Wave Break Resupply:** When a wave concludes, all dead or downed players respawn immediately, and the Core automatically recovers 10% of its max HP.
* **Solo Rule:** When the weighted squad size $W < 1.5$, bleed-out is shortened to 5 seconds and respawn delay is reduced to 4 seconds, while preserving the 3% Core HP cost.

### FR-3: Auto-Fire & Buttons (LASER, DASH, WALL, BOMB/REVIVE)

Tactical controls follow these explicit rules:

| Input | Rule |
| :--- | :--- |
| **Auto-fire** | Automatic. Targets the enemy closest to the Core inside player weapon range and within a 60° forward cone along heading. Range and damage: TBD (tune in playtest). Default implementation uses hitscan with a short tracer line without bullet heap allocations. |
| **A (bit 0) LASER** | Tap. Fires a piercing rail beam in a straight line along the heading vector. Breaks brute frontal shields with knockback. Features a 15° priority snap onto shielded targets. Enforces a fixed 2.5s cooldown shown as a button wipe. Zero energy meter and zero spread. |
| **B (bit 1) DASH** | Tap. Repulsor thrust providing crowd stagger and mobility. Colliding with a shielded brute body-checks it, spinning it for 1.0s to expose its unshielded rear to auto-fire. DASH does not pierce frontal shields. Dash distance, speed, and cooldown: TBD (tune in playtest). |
| **X (bit 2) WALL** | Tap. Deploys a stationary kinetic barricade. Each player can maintain at most 2 concurrent active barricades, each lasting 8.0s and blocking traversal cells on the $40 \times 40$ path grid. |
| **Y (bit 3) BOMB / REVIVE** | Tap. Context-sensitive action driven by the Button Y State Machine (below). Displays dynamic label (`BOMB`, `JOINED`, `REVIVE`) sent via slot-scoped `pad:state` events. |

#### Complete Button Y State Machine

Button Y switches dynamically depending on player proximity to downed allies and the Core's blue Super Bomb ring:

| Context / Location | Downed Ally in Reach ($< 60\text{px}$)? | Button Y Label | Button State | Stylistic Treatment / Visual Feedback |
| :--- | :---: | :---: | :---: | :--- |
| **Anywhere in Arena** | **YES** | `REVIVE` | Enabled | 100% full opacity, bright theme accent. Highest priority action; revives fallen teammate immediately over bombing. |
| **Inside Blue Core Ring** | NO | `BOMB` | Enabled | 100% full opacity, glowing prompt. Tap to join the Super Bomb charge. |
| **Inside Blue Core Ring (Tapped)** | NO | `JOINED` | Active / Held | Stays joined until exiting ring, becoming downed, or when Super Bomb discharges. |
| **Outside Blue Ring (No Downed Ally)** | NO | `REVIVE` | Disabled | **30% vague opacity** (`opacity: 0.3`). Un-pressable affordance informing player of the revive capability without visual distraction. |

* **Super Bomb Gather Rule:** The Super Bomb charges when at least half of the living squad (with $\ge 1$ human) stands within the blue Core ring and has tapped Y (`JOINED`). Can be fired at most once per wave.
* **Super Bomb Screen Readout:** When the blast fires, controller readout displays `WAVE X/8 · SUPER BOMB`.
* **Cooldown Policy on Wave Transition:** When a wave concludes, all dead or downed players respawn immediately, and ability cooldowns are refreshed for the incoming wave.

Cooldowns are tracked and enforced in the simulation, not on the phone. Inputs pressed during an active cooldown are ignored without queuing.

### FR-4: Waves, Enemies, Boss, Scaling & Run Flow

The 8-wave escalation sequence:

| Wave | Threats | Flanks |
| :--- | :--- | :--- |
| 1–2 | Drone swarms | 1 flank, then 2 flanks |
| 3 | Drones plus first shielded brutes | 2 flanks |
| 4 | Fast drones and brutes in coordinated pairs | 3 flanks |
| 5 | Mixed horde with corridor breach events | 3 flanks |
| 6–7 | Dense swarms and armored brutes attacking from all directions | 4 flanks |
| 8 | Dreadnought boss accompanied by drone escorts | 4 flanks |

Enemy mechanics:

* **Drones:** Fast, light swarms that path directly toward the Core to deal melee damage on contact.
* **Shielded Brutes:** Heavy units that prioritize the nearest player within aggro radius, falling back to the Core. Protected by a frontal arc shield that deflects auto-fire. Frontal shields can only be penetrated by RAIL shots or circumvented after a DASH spin exposes their rear for 1.0s.
* **Dreadnought Boss:** Appears on wave 8 with multi-phase behavior at 66% and 33% HP thresholds. Executes sweeping laser barrages, deploys drone carriers, and enrages toward the Core in its final phase. Armored weak points require two players to dash into opposite flanks within 1.0s of each other. Aggro tracks a composite threat score (damage dealt + dash hits + proximity).
* **Telegraphing:** Flank corridors illuminate with warning glow 2.0s before enemy spawns emerge.
* **Enemy Parameters:** Speeds, HP values, damage outputs, and counts: TBD (tune in playtest).

Dynamic scaling formulas:

* **Weighted Squad Size ($W$):** Calculated as $\sum \text{humans} \times 1.0 + \sum \text{bots} \times (0.5 + \text{level} / 200)$, where bot skill levels 11..70 produce weights between 0.55 and 0.85.
* **Enemy Count Scaling:** Scaled by factor $(0.6 + 0.2 \times W)$.
* **Enemy HP Scaling:** Scaled by factor $(1.0 + 0.1 \times W)$.
* **Boss HP Scaling:** Scaled by factor $(1.0 + 0.35 \times (W - 1))$.

Run flow and simulation phases:

* **Phase Enumeration (Proposal):**
  * `0 = COUNTDOWN` (3.0s initial sync).
  * `1 = WAVE_ACTIVE` (combat wave in progress).
  * `2 = WAVE_BREAK` (15.0s respite, respawn, and Core +10% repair).
  * `3 = MATCH_OVER` (victory upon wave 8 clear, or defeat upon Core HP reaching 0).
* **Phase Progression:** Match begins in `COUNTDOWN` and proceeds directly into Wave 1 without an opening practice phase. A wave completes when all spawned enemies are eliminated. Wave 8 clear triggers `MATCH_OVER` (win). Core HP dropping to 0 at any moment triggers `MATCH_OVER` (loss).
* **Core Max HP:** TBD (tune in playtest).
* **Fixed Step Execution Order:** Each simulation tick executes sub-steps strictly in this order: (1) Process inputs, (2) Apply dashes, (3) Resolve rail beams, (4) Process auto-fire, (5) Update enemy movement, (6) Resolve damage and health.

### FR-5: Phone Controller Layout & Feedback

* **Layout:** Employs `<ControllerShell/>` configured with the `stick-diamond` preset (`shared/src/ui/controller-shell.tsx`), presenting `<VirtualJoystick label="MOVE"/>` on the left and an A, B, X, Y diamond cluster on the right.
* **Action Labels:** Button A is labeled `RAIL`, B is labeled `DASH`, X is labeled `SHIELD`, and Y displays dynamic context labels: `REVIVE`, `EMP`, `JOINED`, or dimmed when no action is available.
* **Cooldown Indication:** Button A renders a radial wipe animation for its 2.5s cooldown. Cooldown states follow host timing through the proposed `pad:state` control message.
* **Haptics:** Triggers `navigator.vibrate` for rail fire, dash impact, damage intake, and EMP bursts on supported devices. On iOS Safari (which lacks Vibration API), the EMP blast triggers a high-contrast screen flash.
* **Ergonomics:** All interactive buttons and joysticks are inset at least 36px from screen margins.

### FR-6: Disconnect, Real AWAY Handling & Mid-Match Rejoin (`SCAN TO REJOIN`)

* **Input Invalidation:** When a phone stops transmitting packets for 100ms or longer, the host zeroes its inputs (`screen/src/host-loop.ts:189-200`) and flags the player as `AWAY`.
* **Real AWAY Behavior:** When a player is `AWAY`, their ship sits completely idle with zero velocity and zero auto-fire. No heuristic bot ever takes over a human's ship (avoiding ghost inputs).
* **State Notification:** The simulation tracks connection states via `setConnectedMask` (`screen/src/host-loop.ts:175-176`).
* **Downed AWAY Handling:** If a player disconnects while downed, their bleed-out timer is paused.
* **Rejoin Mechanics:** Reconnecting players use the standard `<MatchRejoinQr/>` displayed on screen. Upon rejoining, the player immediately re-assumes control of their slot with their current position and HP preserved, or respawns at the Core without penalty if dead.
* **Late Stranger Joins:** Unregistered tokens connecting mid-match receive `room:rejected` with reason `MATCH_IN_PROGRESS`.

### FR-7: Industrial Neo-Brutalist Visuals & Game Feel (Zero Art Assets)

* **Rendering Engine:** Built entirely with procedural Phaser 4 `Graphics` shapes, lines, and arcs with zero external raster image files.
* **Player Sprites:** Rendered as geometric circles (minimum 24px world radius) with forward-facing directional notches, distinct 6-character tags, and slot glyphs.
* **Color Palettes & Contrast:** Players use assigned `PLAYER_COLORS` from `shared/src/registry.ts`, bordered with high-contrast outlines to stand out against the paper background `#F4F1EA`.
* **Enemy Palette:** Enemies use monochromatic neutral dark grays accented with safety warning colors (safety orange, warning red). Yellow `#F5C518` is reserved strictly for console UI chrome.
* **Telegraphing:** Brute shields are drawn as thick, bright frontal arc barriers. Spawning corridors glow for 2.0s prior to wave incursions.

### FR-8: In-Match Host Exit (`MatchExitControl` → `resetLobby`)

* **Host Exit Button:** The primary desktop host display renders the universal `<MatchExitControl/>` button (`[x]`) in the top-right corner during the match (`screen/src/match-exit.tsx`).
* **Lobby Reset:** Confirming exit calls `session.resetLobby()`, cleanly terminating the simulation, unmounting renderers, notifying connected controllers with `room:phase: lobby`, and returning all clients to the unselected lobby carousel.
* **Rematch Dispatch:** Post-match podium selections dispatch `cyber:rematch` with `{ action: 'restart' | 'lobby' }`.
* **Pause Behavior:** Pausing mid-wave is not supported in v1.

### FR-9: Edge Cases (Mandatory Deterministic Rules)

1. **Squad Size Variations:** In solo play (1 human, 0 bots), $W = 1.0$, revive is impossible, and solo timers apply (5s bleed-out, 4s respawn). In an 8-player squad, EMP activation requires at least 4 living players inside the Core ring.
2. **Total Squad Down:** If all players are simultaneously downed or respawning, the run does not instantly fail. The Core remains vulnerable, and enemies continue attacking until either Core HP hits 0 (loss) or players respawn.
3. **Core HP Depletion Floor:** Respawn penalties never reduce Core HP below 1 HP. Core destruction requires direct enemy attack damage.
4. **Context Prioritization for Button Y:** Priority resolves in order: (a) If a downed teammate is in reach, Y channels revive; (b) Else if inside the Core ring with EMP ready, Y joins the EMP charge; (c) Otherwise Y does nothing. If two players attempt to revive the same fallen teammate, the first channel owns the revive and the second player falls through to Core EMP.
5. **Rail Priority Snap Resolution:** When multiple shielded enemies fall within the 15° forward cone, the snap prioritizes the target closest to the Core, breaking ties by nearest to the shooter, then by lowest entity pool index.
6. **Auto-Fire Target Stickiness:** Auto-fire locks onto the eligible target closest to the Core. A new target will not usurp the lock unless it is at least 10% closer to the Core than the current target.
7. **Dash Physical Interactions:** Dashing into outer walls stops the player with zero damage. Dashing into the Core stops motion cleanly. Dashing through teammates passes through without interaction. Dashing into a barricade halts motion without damaging the barrier. Dashing into a shielded brute from the front triggers a 1.0s spin; additional dashes during the spin reset the duration to 1.0s rather than accumulating time.
8. **Input Packet Loss Mitigation:** Button taps toggle the upper 4 bits of the input byte, latched deterministically on the host (`screen/src/host-loop.ts:145-156`). Consecutive taps during an active cooldown are discarded.
9. **Disconnect During Cooldown:** Cooldown timers are managed on the host simulation. Rejoining players receive current remaining cooldowns through `pad:state`.
10. **Disconnect During Revive:** If the reviver goes AWAY, the channel terminates immediately. If the downed player goes AWAY, their bleed-out pauses while the channel finishes. If an AWAY player is taken over by a bot at 3.0s, the bot inherits the revive.
11. **Disconnect During EMP Charge:** An AWAY player is immediately removed from the EMP charge count. If the active count falls below the required threshold, the charge pauses and slowly decays at 10% per second.
12. **Standby Bot Channeling Restrictions:** A standby bot will never initiate an EMP charge on its own, and only participates if at least one human player has joined the charge.
13. **Late Match Infiltration:** Strangers connecting mid-match receive `MATCH_IN_PROGRESS`.
14. **Extended AWAY Rejoin:** Rejoining after an extended disconnect restores control at the player's current location, or respawns them at the Core without penalty if dead.
15. **Pathfinding Obstruction:** If player barricades completely seal path corridors to the Core, enemies attack and destroy the nearest blocking barricade. Placing barricades on the Core ring or over living entities is disallowed.
16. **Spawn Point Obstruction:** Barricades placed over spawn corridors cause incoming spawns to delay one tick until clearance is achieved. When the entity pool is full, new spawns queue rather than overflowing memory.
17. **Simultaneous Dash and Rail Input:** If DASH and RAIL are received on the same tick, both execute according to the fixed step order: dashes resolve before rail attacks.

### Heuristic Bot

* **Input Pipeline:** Bots operate through `WriteBotInput` (`screen/src/bot-fill.ts:151`), consuming `auxState` entity data and configured difficulty parameters (`Easy: 11-20`, `Medium: 30-50`, `Hard: 50-70`).
* **Tactical Role Evaluator:** A periodic role evaluator reassesses team needs every 1.0s, assigning bots to defend flanks, intercept brutes, assist with revives, or hold the EMP ring.
* **Skill Scaling:** Higher difficulty reduces reaction delays, improves aim cone precision, and increases role evaluation frequency.
* **Revive Preference:** Bots prioritize revives by proximity, favoring human players over fellow bots, and immediately moving to rescue humans whose bleed-out timers drop below 5.0s.
* **EMP Coordination:** Bots enter the Core ring to tap Y only after a human player has initiated the EMP sequence.

### Scoreboard, Wave Banner & Run Over

* **Right Scoreboard (`ScoreboardPanel`):** Renders header `WAVE <n>/8`, displaying player tags, `LIVE` / `AWAY` badges, player HP as a proportional ratio bar, and `DOWN` status indicators.
* **Left Guide (`ScoreRulesPanel`):** Displays dynamic key mapping guide: `A: RAIL`, `B: DASH`, `X: SHIELD`, `Y: REVIVE / EMP`.
* **Top Screen Banner:** Shows countdown digits, `WAVE <n>`, `BREAK <s>`, `CORE LOST` upon defeat, and `CITADEL HOLDS` upon wave 8 victory.
* **End of Match Screen:** Presents total waves survived, squad damage dealt, and standard **PLAY AGAIN** / **RETURN TO LOBBY** controls.

---

## 3. Non-Functional Requirements (NFR)

| Requirement | Target | Specification |
| :--- | :--- | :--- |
| **Fixed Timestep Determinism** | 120 Hz tick | Physics simulation runs at a deterministic 120 Hz ($dt \approx 8.333\text{ms}$), completely decoupled from screen rendering rate. |
| **Zero-Allocation Hot Path** | 0 heap allocs | Core `step()` simulation tick performs zero heap allocations; entity tracking reuses pre-allocated flat TypedArrays. |
| **End-to-End Latency** | $< 50\text{ms}$ | Controller input to screen photon latency remains under 50ms over local Wi-Fi. |
| **Mobile Ergonomics** | 36px insets | Touch controls maintain 36px minimum safety padding from edge boundaries. |
| **Strict View Compliance** | `holistic` only | Runs exclusively under holistic single-screen host mode; auxiliary monitor views stay dormant. |
| **Entity Budget** | $\le 160$ enemies | Accommodates up to 160 active enemies and 256 projectile slots managed via uniform grid broadphase. |
| **Low-Spec Phone Support** | Zero canvas load | Phones process no world state, running lightweight DOM button shells without Canvas or WebGL rendering. |

---

## 4. Technical Contracts, Memory Layouts & Endpoints

### A. Data-Plane Binary Input Contract (8 Bytes — WebRTC UDP / `ws` Fallback)

The client transmits binary input frames with the standard 8-byte payload:

```text
Byte 0..1 : [Uint16] sequenceNumber (monotonic counter)
Byte 2..3 : [Uint16] clientTimestamp (ms)
Byte 4    : [Uint8]  touchLagMs (internal input delay)
Byte 5    : [Uint8]  buttons     Bit 0 = A RAIL, Bit 1 = B DASH, Bit 2 = X SHIELD, Bit 3 = Y REVIVE/EMP (held)
                                 Bits 4..7 = toggle bits, one per button (send-input.ts, host-loop.ts)
Byte 6    : [Int8]   axisX       (-127..127) MOVE X
Byte 7    : [Int8]   axisY       (-127..127) MOVE Y
```

### B. Control-Plane WebSocket Contracts (`ws` JSON — Reliable TCP)

The `cyber` and `pad` message prefixes are allowlisted in `shared/src/types/game-control.ts:1`. Message definitions:

| Event `type` | Direction | Payload Schema | Purpose |
| :--- | :--- | :--- | :--- |
| `game:mount` | Server → All | `{ gameId: 'cyber-citadel', manifest, players, botNames? }` | Existing platform event. |
| `cyber:wave_start` | Host → All | `{ wave: number }` | **Proposal (not built):** Banner trigger and phone vibration pulse. |
| `cyber:wave_end` | Host → All | `{ wave: number, coreHp: number }` | **Proposal (not built):** Wave break initiation. |
| `cyber:downed` | Host → All | `{ slot: number }` | **Proposal (not built):** Signals downed player UI state. |
| `cyber:revived` | Host → All | `{ slot: number }` | **Proposal (not built):** Restores player to active UI state. |
| `cyber:emp` | Host → All | `{ wave: number }` | **Proposal (not built):** Synchronized haptic burst and visual screen flash. |
| `cyber:match_end` | Host → All | `{ won: boolean, wavesCleared: number }` | **Proposal (not built):** Transmits final run results. |
| `cyber:rematch` | Host → Server | `{ action: 'restart' \| 'lobby' }` | **Proposal (not built):** Post-run rematch action. |
| `pad:state` | Host → All | `{ slot: number, labels?: string[], disabled?: number, cooldownEndsAt?: number[] }` | **Proposal (not built):** Context labels and cooldown synchronization. |

### C. Flat Simulation State Buffer (`Float32Array`) + Entity Pools (`auxState` `Uint8Array`)

#### 1. Primary State Buffer — `Float32Array(88)` (`352 bytes`)

```text
Global header (indices 0..7):
  [0] tickId        (monotonic fixed-step counter)
  [1] phaseEnum     (0=COUNTDOWN, 1=WAVE_ACTIVE, 2=WAVE_BREAK, 3=MATCH_OVER)
  [2] phaseTimer    (seconds left in COUNTDOWN or WAVE_BREAK)
  [3] wave          (1..8)
  [4] coreHp        (0..CORE_MAX_HP; CORE_MAX_HP TBD)
  [5] empCharge     (0..1)
  [6] empFiredCount (increments when the EMP fires; drives cyber:emp)
  [7] bossPhase     (0 = no boss, 1..3)

Per-player stride (10 floats x 8 slots, indices 8..87), base = 8 + i * 10:
  [base + 0] x
  [base + 1] y
  [base + 2] heading       (radians)
  [base + 3] hp
  [base + 4] flags         (Bit0=ACTIVE, Bit1=DOWNED, Bit2=IS_BOT, Bit3=DISCONNECTED, Bit4=EMP_JOINED, Bit5=STANDBY_BOT, Bit6=RESPAWNING)
  [base + 5] downTimer     (bleed-out or respawn seconds left)
  [base + 6] railCooldown  (0..2.5)
  [base + 7] dashCooldown  (0..TBD)
  [base + 8] reviveChannel (0..2.5)
  [base + 9] barricades    (active count, 0..2)
```

#### 2. Entity Pool Buffer (`auxState`)

Structured as a pre-allocated `Uint8Array` accessed via `DataView`, replicated across ticks via `ScreenSim.auxState` (`screen/src/host-loop.ts:15`, `:77-78`):

```text
enemies      160 x 8 B = 1280   x u16, y u16, hp u8, type u8, state u8, target u8
projectiles  256 x 6 B = 1536   x u16, y u16, owner u8, ttl u8
barricades    24 x 6 B =  144   fields TBD
flow field    40 x 40  = 1600   optional, only if the renderer draws it
total about 3 KB (about 4.5 KB with the flow field)
```

Coordinate encoding for `u16` fields: TBD (tune in playtest).

#### 3. Snapshot Footprint & Multi-Monitor Seam

The total snapshot size is 352 bytes plus the auxiliary entity pools, synchronized across browser tabs via `BroadcastChannel` in accordance with `screen/src/session.ts`.

### D. Route & Viewport Endpoints

* `/screen?view=holistic`: Mounts `CyberCitadelRenderer` inside `<HolisticMatchShell/>`.
* `/controller`: Mounts `CyberCitadelController` with `stick-diamond` action buttons.
* Secondary monitor routes (`/screen?view=team-1`, etc.) stay dormant in holistic mode.

---

## 5. Finite State Machines (FSM)

### A. Run Lifecycle FSM

```text
startMatch
  -> COUNTDOWN (3 s)
  -> WAVE_ACTIVE (wave n)
       -> Core HP 0? MATCH_OVER (loss)
       -> all wave enemies destroyed and n < 8? WAVE_BREAK (15 s: everyone respawns, Core +10%) -> WAVE_ACTIVE (n + 1)
       -> all wave enemies destroyed and n = 8? MATCH_OVER (win)
MATCH_OVER -> [cyber:rematch action]
```

### B. Per-Player Action FSM

| Current State | Trigger / Condition | Next State | Side Effects |
| :--- | :--- | :--- | :--- |
| `ACTIVE` | hp reaches 0 | `DOWNED` | Start 15 s bleed-out; leave EMP charge. |
| `DOWNED` | ally revive channel completes (2.5 s) | `ACTIVE` | Restore HP (TBD). |
| `DOWNED` | bleed-out ends | `RESPAWNING` | Start 8 s timer; charge 3% Core HP (cap and floor rules). |
| `RESPAWNING` | timer ends | `ACTIVE` | Spawn at the Core. |
| any | disconnected 3 s | same state, `STANDBY_BOT` set | Medium bot drives the slot. Bleed-out pauses if downed. |
| any with `STANDBY_BOT` | human rejoins | same state, `STANDBY_BOT` cleared | Cancel bot channels; respawn at the Core with no cost if needed. |
| `ACTIVE` | Y tap in Core ring, no downed ally in reach | `ACTIVE`, `EMP_JOINED` set | Joins charge until leaving the ring, downed or AWAY. |

---

## 6. Strict System & Physics Invariants

1. **INV-1 (No NaN / Infinity State):** For every tick $t$ and index $k \in [0, 87]$, `Number.isFinite(state[k]) === true`.
2. **INV-2 (Box Boundary Containment):** Every player position satisfies $-400 \le x, y \le 400$ within the arena boundaries.
3. **INV-3 (Fixed Pools):** Active enemy, projectile, and barricade counts never exceed their hard caps of 160, 256, and 24. Full pools delay incoming spawns without dropping entities.
4. **INV-4 (Cooldown Domain):** `railCooldown` is strictly bounded within $[0, 2.5]$; no cooldown timer can evaluate to a negative number.
5. **INV-5 (Core Floor):** Player respawn penalties can never reduce Core HP below 1 HP; only direct enemy damage can reduce Core HP to 0.
6. **INV-6 (Barricade Limit):** No individual player can maintain more than 2 concurrent active barricades, each constrained to an 8.0s lifespan.
7. **INV-7 (Deterministic Tie-Breaks):** Auto-fire targeting and rail snap ties resolve deterministically: lowest distance to Core, then lowest distance to player, then lowest entity pool index.
8. **INV-8 (Bit-Exact Determinism):** Replaying identical seeds, roster configurations, and binary input streams produces bit-exact identical `state` and `auxState` buffers.
9. **INV-9 (Zero-Allocation Hot Path):** The fixed 120 Hz update loop executes without dynamic object, array, or closure allocations.
10. **INV-10 (Strict View Isolation):** Rendering logic executes exclusively when mounted under `/screen?view=holistic`.

---

## 7. Testing & Verification Plan

### 1. Deterministic Unit Tests (`vitest`)

* **Auto-Fire Target Selection:** Verify auto-fire prioritizes enemies nearest the Core within the 60° forward arc.
* **Target Stickiness:** Assert current target lock is retained unless an alternate threat is at least 10% closer to the Core.
* **Rail Snap Priority:** Test rail priority snap onto shielded targets in the 15° cone, verifying Core-distance tie-breaking.
* **Dash Spin Verification:** Assert dashing into a brute spins it for 1.0s and exposes its vulnerable rear to auto-fire.
* **Shield Piercing Rules:** Confirm RAIL penetrates frontal shields, while DASH repels without shield penetration.
* **Button Y Context Resolution:** Validate revive channel takes precedence over Core EMP join when both criteria overlap.
* **EMP Activation Rules:** Test that EMP charge accumulates only when at least 50% of the squad (including 1 human) has joined.
* **Respawn Floor & Cap:** Verify respawn penalties cap at 12% per wave and clamp at 1 HP without destroying the Core.
* **Solo Scaling Mode:** Test shortened bleed-out and respawn timers when $W < 1.5$.
* **Pool Overflow Queuing:** Verify spawns queue safely when entity pools reach 160 units.
* **Deterministic Step Order:** Validate execution order: inputs $\to$ dashes $\to$ rail $\to$ auto-fire $\to$ enemies $\to$ damage.

### 2. State Machine & Property-Based / Fuzz Tests

* **3,000-Tick Multi-Wave Fuzz:** Run automated 3,000-tick randomized fuzz runs across Waves 1, 4, and 8 with `{ timeout: 20000 }` asserting invariants `INV-1` through `INV-8`.
* **Bit-Exact Replay:** Verify that replaying recorded input streams against identical initial seeds yields identical state buffers.

### 3. Hardware, Network & Latency Verification Checklist (M5 Pro Mac + Phones)

* **Ergonomics:** Test joystick and diamond buttons on iPhone Safari and Android Chrome with 36px edge clearance.
* **Visual Cooldown Wipe:** Confirm Button A displays smooth cooldown radial wipe.
* **Dynamic Y Label:** Verify Button Y toggles between `REVIVE`, `EMP`, and `JOINED`.
* **Haptic and Visual Cues:** Test vibration on Android and visual flash fallback on iOS during EMP activation.
* **AWAY Bot Takeover:** Simulate phone disconnect, verify bot takeover at 3.0s, and confirm seamless handback on reconnect.
* **Host Exit Integrity:** Confirm host `[x]` button safely halts match and resets to lobby.

---

## 8. Open Questions (Defaults Used in This Spec)

1. ~~EMP: tap or hold?~~ **Resolved 2026-11-25: tap.** Kept as historical context.
2. **Revive channel:** Tap that starts an auto channel (cancelled by moving away), or a hold? **Default: tap plus stay in range.**
3. **Solo rules:** Shorter timers when $W < 1.5$, or push solo players to add bots? **Default: shorter timers (5 s bleed-out, 4 s respawn).**
4. **Respawn cost cap (12% per wave) and the 1 HP floor:** Adopt? **Default: yes.**
5. **Late join in wave breaks:** Worth the server and host-loop work for v2? **Default: not in v1.**
6. **Hitscan auto-fire:** OK visually, or visible bullets? **Default: hitscan with a short tracer.**
7. **`pad:state` scope:** Game-specific `cyber:pad` or shared `pad:state`? **Default: shared `pad:state`** (`pad` is already allowlisted).
8. **EMP effect and charge time:** What the EMP does when it fires, how long it charges, and the Core ring radius. **Not decided. Spec writes TBD.**
9. **Opening practice:** Run a practice phase before wave 1, like the other games? **Default: none.**
10. **Wave clear condition:** A wave ends when all its enemies are destroyed? **Default: yes.**
11. **Upgrade vote between waves:** The design page has a squad upgrade vote in each break; earlier review deferred this to later. **Default: later, not v1.**

---

## 9. Platform Dependencies (Not Built Yet)

| Need | Today | Work left |
| :--- | :--- | :--- |
| **4 buttons** | Done: held bits 0-3 and toggle bits 4-7 latched for all four (`screen/src/host-loop.ts:127-156`). Cap is 4. | None. |
| **First-packet baseline** | Done (`screen/src/host-loop.ts:130`, PR #10). | None. |
| **`stick-diamond` layout** | Done (`shared/src/controller/layout.ts`, `shared/src/ui/controller-shell.tsx`). | Declare it in the manifest. |
| **Host-driven cooldown wipe and Y label** | Wipe is local at press time (`controller-shell.tsx:41-68`). No `pad:state` handler. | Build `pad:state` with a `slot` field. |
| **Per-button hold masking** | After 100 ms silence the host masks every held bit (`screen/src/host-loop.ts:189-200`). | Not needed while all buttons are taps. |
| **Lazy controller loading** | `controller/src/register-games.ts:3-8` imports every game eagerly. | Switch to per-game `import()` before a fourth game. |
| **World state beyond 88 floats** | `auxState` copied each tick (`screen/src/host-loop.ts:64-78`). | Put pools in `auxState`. |
| **Bots see world state** | `WriteBotInput` gets `auxState` (`screen/src/bot-fill.ts:151`). | None. |
| **AWAY takeover** | Bot mask fixed at match start. | Per-slot standby bot flag in `bot-fill.ts` and `session.ts`. |
| **Late join** | `MATCH_IN_PROGRESS` (`server/src/rooms.ts:97-100`). | Nothing in v1. |
| **Deterministic sim** | Bomb Pass seeded RNG (`games/bomb-pass/src/simulation.ts:710`). | Copy it. |
| **Spatial broadphase** | `shared/src/physics-2d/` has `circle-collision.ts`, `boundary.ts`, `motion.ts`. | Add a uniform grid hash there. |

Architecture and optimization defaults:

* **Spatial Broadphase:** Uniform grid spatial hash with cell size approximately $2\times$ the largest enemy radius.
* **Deterministic Execution:** Fixed 120 Hz tick with no `Math.random()` or `Date.now()` calls inside the simulation loop.
* **Memory Management:** Pre-allocated entity arrays with internal free lists.
* **Flow Field Recalculation:** Rebuilt only upon barricade modification, at most once per tick.

---

## 10. Later Ideas (Not v1)

| Idea | Cost | Opinion |
| :--- | :--- | :--- |
| **Bot callouts on screen ("P3 BOT: PATCHING NORTH")** | Very low | Strong. Top pick. |
| **Downed spotters: downed players ping one enemy, slowing it 1 s** | Low | Strong. Top pick. |
| **Synced phone buzz on EMP (screen flash on iOS)** | Very low | Top pick. |
| **Brute spin pinball: a spun brute staggers brutes it hits** | Low | Fun, small risk of being too strong. |
| **Upgrade vote between waves** | Medium | Strong, most work. Later (open question 11). |
| **MVP titles ("Wall Builder", "Medic", "Rail God")** | Low | Cheap laughs; bots get half credit. |
| **Core reacts: Core face gets nervous as HP drops** | Low | Readable HP without numbers. |
| **Barricades that merge when touching** | Medium | Wait until the flow field is proven. |
| **Core overcharge: perfect EMP timing gives a short damage buff** | Low | Add after the basics feel good. |
