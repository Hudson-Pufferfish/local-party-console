# Cyber-Citadel Defense (`cyber-citadel`) — Co-op Wave Defense Game Specification

> **AI Agent Instruction:** Read `../SPEC.md` and `./README.md` first. Cyber-Citadel Defense is a self-contained cooperative game plugin under `/games/cyber-citadel` conforming strictly to the platform `GameDefinition` contract. Never leak game-specific wave, enemy, or barricade logic into shared shells. Status: implemented under `/games/cyber-citadel`.

---

## 1. Overview & `GameManifest` Contract

Cyber-Citadel Defense is a cooperative wave defense game for 1 to 8 players (humans plus bots) rendered on one shared TV screen. The squad protects a central **Core** located in the middle of a square arena from 8 escalating waves of enemies, including drone swarms, shielded brutes, and a multi-phase Dreadnought boss. Basic weapon fire is automatic, enabling players to keep their left thumb on the analog stick while the right thumb exclusively controls tactical abilities via A, B, X, and Y button taps.

**Locked:** The only lose condition is Core HP reaching 0. Win condition requires clearing wave 8 by defeating the Dreadnought boss. A standard run spans 8 waves lasting 12 to 15 minutes, with 15-second breather breaks between waves. There are no individual rank points: everyone wins or loses together as a squad.

### Declarative Manifest (`manifest.ts`)

```typescript
import type { GameManifest } from '../../../shared/src/types/game.ts';

export const CYBER_CITADEL_MANIFEST: GameManifest = {
  id: 'cyber-citadel',
  title: 'CITADEL DEFENSE', // Default display title.
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
      { bit: 0, glyph: 'A', label: 'LASER', kind: 'tap', cooldownMs: 2500, hapticMs: 25 },
      { bit: 1, glyph: 'B', label: 'DASH', kind: 'tap', hapticMs: 18 },
      { bit: 2, glyph: 'X', label: 'WALL', kind: 'tap', hapticMs: 14 },
      { bit: 3, glyph: 'Y', label: 'REVIVE', kind: 'tap', hapticMs: 18 }, // Dynamic context label via pad:state.
    ],
  },
  themeTokens: {
    '--bg-surface': '#F4F1EA',
    '--ink-primary': '#111111',
    '--accent-hazard-alert': '#FF4D00',
    '--accent-shield-arc': '#E10600',
  },
};
```

The `stick-diamond` preset and `ButtonSpec` definition exist in `shared/src/controller/layout.ts`, and `GameManifest.controllerLayout` is required by `shared/src/types/game.ts:38`. The `minPlayers: 1` setting integrates directly with the platform lobby rule `canStart(connectedCount, minPlayers)` in `shared/src/view/policy.ts:12-13`.

---

## 2. Functional Requirements (FR)

### FR-1: Arena, Core & $40 \times 40$ Path Grid Geometry

* **Arena Dimensions:** The arena is an 800 x 800 square coordinate space centered at (0, 0). On a 1920 x 1080 host display, it scales to a 1080 x 1080 center square, leaving ample side margin for `<ScoreboardPanel/>` and `<ScoreRulesPanel/>`.
* **Central Core:** The Core is a solid circular entity situated at (0, 0) with `coreRadius: 48` and `empRingRadius: 130` (`coreMaxHp: 1000`).
* **Path Grid & Flow Field:** A $40 \times 40$ path navigation grid overlays the arena with cell size $800 / 40 = 20$ world units. Kinetic barricades placed by players occupy and block grid cells. Enemy swarms navigate toward the Core using a vector flow field recalculated when barricades change.
* **Perimeter Containment:** Players and ground enemies cannot exit the outer boundary. Boundary collision stops motion cleanly with zero damage, reusing `shared/src/physics-2d/boundary.ts`.

### FR-2: Player Movement, Downed State, Revive & Respawn

* **Movement:** Analog joystick input (packet bytes 6 and 7) drives velocity up to `playerSpeed: 300` world units/s. Player orientation follows the velocity heading vector.
* **Collision & Friendly Fire:**
  * **Friendly Fire:** Strictly disabled across all weapons and abilities. Auto-fire tracers, Button A (Piercing Laser / RAIL), Button B (DASH), and Super Bomb (EMP) never deal damage or apply knockback to teammates.
  * **Player-to-Player Collision (Soft Separation):**
    * **Live vs. Live (Healthy):** Mutual soft separation ($2 \times r_{\text{player}} = 48\text{px}$). When two living players overlap, a gentle position separation slides them apart without blocking velocity or causing hard bounces, preventing ships from stacking into a single point.
    * **Live vs. Downed (Any):** 100% pass-through (zero collision). Active living players can walk directly over and stand on downed allies to channel revive without physics resistance or tether breaks.
    * **Away Players:** Follows physiological state: living Away players softly separate living teammates; downed Away players allow 100% pass-through.
  * **NOTES(@agents):** Keep friendly fire disabled permanently. Enforce soft separation strictly between `isLive` players (`flags & CYBER_FLAG.JOINED !== 0` and `(flags & (CYBER_FLAG.DOWNED | CYBER_FLAG.RESPAWNING)) === 0`). Downed or respawning slots must be excluded from circle collision so revivers never get displaced.
* **Downed State:** When player HP (`playerMaxHp: 100`) drops to 0, the player becomes downed, crawling at 25% speed with a 15-second bleed-out timer.
* **Revive Action:** An active teammate inside revive range (`reviveRange: 64`) can channel a revive by tapping Button Y. Revive requires a 2.5-second channel during which the reviver must remain in proximity, restoring `reviveRestoreHp: 60` HP.
* **Bleed-Out & Respawn:** If bleed-out completes without revive, the player enters respawn with an 8-second timer before reappearing at the Core. Each respawn subtracts 3% of Core max HP.
* **Respawn Protection:** Respawn costs are capped at 12% of Core max HP per wave, and respawn penalties can never reduce Core HP below 1 HP. Only enemy attacks can deliver the final blow to destroy the Core.
* **Wave Break Resupply:** When a wave concludes, all dead or downed players respawn near the Core, all joined players recover to 100% HP (`playerMaxHp: 100`), and the Core automatically recovers +10% of its max HP (`+100 HP`, capped at `1000`).
* **Solo & Light Squad Rule:** When the weighted squad size $W < 1.5$ (e.g., solo human), bleed-out is shortened to 5 seconds and respawn delay is reduced to 4 seconds, while preserving the 3% Core HP cost. Bot weight contribution is $0.4 + \text{level}/100$ ($0.51 \dots 0.60$ Easy, $0.70 \dots 0.90$ Medium, $0.90 \dots 1.10$ Hard).

### FR-3: Auto-Fire & Buttons (LASER, DASH, WALL, BOMB/REVIVE)

Tactical controls follow these explicit rules:

| Input | Rule |
| :--- | :--- |
| **Auto-fire** | Automatic. Targets the enemy closest to the Core inside `autoFireRange: 260` and within a 120° forward cone (±60°) along heading. Fires every `0.2s` for `12` damage (`60 DPS`, `0.35×` vs armored boss) using hitscan with a short tracer line and zero heap allocations. |
| **A (bit 0) LASER** | Tap. Fires a 3-ray V-shape piercing laser fan (`-10°`, `0°`, `+10°` via `railFanHalfAngle`), dealing `90` damage (`0.6×` vs armored boss) once per target per shot. Breaks brute frontal shields for `3.0s` with `140` knockback. Features a 50° priority snap (±25°) onto shielded targets. Fixed `2.5s` cooldown shown as a button wipe. Thick `48px` (`railHalfWidth: 24`) hitbox beam with zero energy meter. |
| **B (bit 1) DASH** | Tap. Repulsor thrust (`dashSpeed: 680`, `dashDurationSec: 0.16`, `dashCooldownSec: 1.8`) providing crowd stagger (`dashStaggerRadius: 52`, `dashStaggerImpulse: 180`) and mobility. Colliding with a shielded brute body-checks it, spinning it for `1.0s` to expose its unshielded rear to auto-fire. DASH does not pierce frontal shields. |
| **X (bit 2) WALL** | Tap. Deploys a stationary kinetic barricade (`barricadeHp: 180`, `shieldCooldownSec: 1.5`). Each player can maintain at most 2 concurrent active barricades, each lasting `8.0s` and blocking traversal cells on the $40 \times 40$ path grid. |
| **Y (bit 3) BOMB / REVIVE** | Tap. Context-sensitive action driven by the Button Y State Machine (below). Displays dynamic label (`BOMB`, `JOINED`, `REVIVE`) sent via slot-scoped `pad:state` events. |

#### Complete Button Y State Machine

Button Y switches dynamically depending on player proximity to downed allies and the Core's blue Super Bomb ring:

| Context / Location | Downed Ally in Reach ($\le 64\text{px}$)? | Button Y Label | Button State | Stylistic Treatment / Visual Feedback |
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

| Wave | Base Counts (Drones / Fast / Brutes) | Base Cadence | Threats | Flanks |
| :--- | :--- | :---: | :--- | :---: |
| 1 | `21 / 1 / 5` | `0.45s` | Opening swarm with first fast drone and brutes | 1 |
| 2 | `29 / 3 / 6` | `0.40s` | Two-flank swarm escalation | 2 |
| 3 | `25 / 8 / 7` | `0.35s` | Faster drones and heavier brute mix | 2 |
| 4 | `19 / 16 / 10` | `0.30s` | Three-flank fast drones and brutes | 3 |
| 5 | `24 / 18 / 10` | `0.29s` | Mixed horde across three flanks | 3 |
| 6 | `20 / 26 / 13` | `0.28s` | Dense four-flank swarms and brutes | 4 |
| 7 | `28 / 26 / 15` + 1 Boss | `0.28s` | Four-flank swarm plus gatekeeper Dreadnought on flank 0 at 88% of minion spawns | 4 |
| 8 | `24 / 12 / 7` + 4 Bosses | `1.40s` | 4-Dreadnought multi-boss climax (North at 2.0s, South at 25.0s, East at 50.0s, and West at 65.0s). Minions start at 4.5s on the 1.4s cadence | 4 |

Enemy mechanics:

* **Drones:** Fast, light swarms (`droneBaseHp: 30`, speed `115`, `18 DPS`, radius `12`; Fast Drones: `fastDroneBaseHp: 22`, speed `165`, `14 DPS`, radius `10`) that path directly toward the Core to deal melee damage on contact.
* **Shielded Brutes:** Heavy units (`bruteBaseHp: 220`, speed `72`, `28 DPS`, radius `22`, `bruteAggroRadius: 220`) that prioritize the nearest player within aggro radius, falling back to the Core. Protected by a 120° frontal arc shield that deflects auto-fire. Frontal shields are broken for `3.0s` by LASER shots or bypassed after a DASH spin exposes their rear for `1.0s`.
* **Drone Carriers:** Boss Phase 2+ escorts (`carrierBaseHp: 110`, speed `58`, `18 DPS`, radius `18`) that spawn a Drone every `3.5s`.
* **Dreadnought Boss (Multi-Boss SoA):** Up to 4 concurrent Dreadnoughts (`MAX_BOSSES = 4`, `bossBaseHp: 600`, speed `15` / enraged `25`, radius `44`, melee `45 DPS`, sweeping laser `52 DPS` at `340` range and `16` half-width, armor scale `0.35×` auto-fire / `0.6×` LASER) run on fixed pre-allocated TypedArrays in `CyberWorld` (`bossEnemyIdx`, `bossLaserAngle`, `bossLaserLen`, `bossLaserTimer`, `bossLaserActive`, `bossCarrierTimer`, `bossFirstDashSlot`, `bossFirstDashAngle`, `bossDualDashTimer`, `bossVulnerableTimer`, `bossWeakMask`, `bossPhase`, and `bossThreat` 4 × 8 flat array). Wave 7 spawns one gatekeeper Dreadnought near the end of its minion stream. Wave 8 deploys four Dreadnoughts in sequence: North (flank 0) at 2.0s, South (flank 2) at 25.0s, East (flank 1) at 50.0s, and West (flank 3) at 65.0s. Minions start at 4.5s. Each boss instance independently tracks its 66% (Phase 2 carrier deployment, plus every `14.0s`) and 33% (Phase 3 Core enrage) thresholds, laser sweep timers (`1.8s` sweep / `4.2s` cooldown in Phases 1–2; `2.4s` / `3.0s` at `1.35×` speed in Phase 3), opposite-flank dual-dash vulnerability (two players dashing opposite sides within `1.0s` for `5.0s` vulnerability), and isolated aggro threat (accumulated damage dealt + dash hits + proximity, decaying at -10/s, falling back to the Core when all players are unengaged > 350px away). The sweeping red laser clips to the arena boundary (`[-400, 400]`) and stops at the first active kinetic barricade it intersects. It deals `52 DPS` (`bossLaserDps * dt`) to that blocking barricade, skips damage to players behind the barricade along the beam (guarding against segment end-cap bleed-through), and ends both tracers and rendered beams at the hit point. `CYBER_HEADER.bossPhase` syncs the highest active boss phase, `META_BOSS_HP_PCT` syncs aggregate active boss health, `META_BOSS_SLOTS` (4 × 4 bytes inside the `auxState` meta trailer) carries per-boss weak-point masks and laser angles, and `META_BOSS_LASER_LEN` (4 × 2 bytes) carries per-boss clipped laser lengths for the renderer.
* **Telegraphing:** Flank corridors illuminate with warning glow `2.0s` before enemy spawns emerge.

Dynamic scaling formulas:

* **Weighted Squad Size ($W$):** Calculated as $\sum \text{humans} \times 1.0 + \sum \text{bots} \times (0.4 + \text{level} / 100)$, where bot skill levels 11..70 produce weights between 0.51 and 1.10.
* **Enemy Count Scaling:** Scaled by factor $(0.6 + 0.2 \times W)$.
* **Enemy HP Scaling:** Scaled by factor $(1.0 + 0.1 \times W)$.
* **Boss HP Scaling:** Scaled by factor $(1.0 + 0.28 \times (W - 1))$.
* **Spawn Cadence Scaling:** `populateWaveSpawns` spaces minions by `spawnCadenceSec * waveCadenceMultiplier(W)`. The multiplier is `2.0` when $W < 2.0$, `1.8` when $2.0 \le W < 4.0$, `1.3` when $4.0 \le W < 6.0$, and `1.0` when $W \ge 6.0$. `WAVE_TABLE` base cadences stay fixed. Wave 8 boss timestamps stay fixed at 2.0s (North), 25.0s (South), 50.0s (East), and 65.0s (West). Wave 8 minions start at 4.5s.

Run flow and simulation phases:

* **Phase Enumeration (Proposal):**
  * `0 = COUNTDOWN` (3.0s initial sync).
  * `1 = WAVE_ACTIVE` (combat wave in progress).
  * `2 = WAVE_BREAK` (15.0s respite, respawn, and Core +10% repair).
  * `3 = MATCH_OVER` (victory upon wave 8 clear, or defeat upon Core HP reaching 0).
* **Phase Progression:** Match begins in `COUNTDOWN` and proceeds directly into Wave 1 without an opening practice phase. A wave completes when all spawned enemies are eliminated. Wave 8 clear triggers `MATCH_OVER` (win). Core HP dropping to 0 at any moment triggers `MATCH_OVER` (loss).
* **Core Max HP:** `1000` (`coreMaxHp: 1000`).
* **Fixed Step Execution Order:** Each simulation tick executes sub-steps strictly in this order: (1) Process inputs, (2) Apply dashes, (3) Resolve rail beams, (4) Process auto-fire, (5) Update enemy movement, (6) Resolve damage and health.

### FR-5: Phone Controller Layout & Feedback

* **Layout:** Employs `<ControllerShell/>` configured with the `stick-diamond` preset (`shared/src/ui/controller-shell.tsx`), presenting `<VirtualJoystick label="MOVE"/>` on the left and an A, B, X, Y diamond cluster on the right.
* **Action Labels:** Button A is labeled `LASER`, B is labeled `DASH`, X is labeled `WALL`, and Y displays dynamic context labels: `REVIVE`, `BOMB`, `JOINED`, or dimmed when no action is available.
* **Cooldown Indication:** Button A renders a radial wipe animation for its 2.5s cooldown. Cooldown states follow host timing through the `pad:state` control message.
* **Haptics:** Triggers `navigator.vibrate` for rail fire, dash impact, damage intake, and EMP bursts on supported devices. On iOS Safari (which lacks Vibration API), the EMP blast triggers a high-contrast screen flash.
* **Ergonomics:** All interactive buttons and joysticks are inset at least 36px from screen margins.

### FR-6: Disconnect, Real AWAY Handling & Mid-Match Rejoin (`SCAN TO REJOIN`)

* **Input Invalidation:** When a phone stops transmitting packets for 100ms or longer, the host zeroes its inputs (`screen/src/host-loop.ts:189-200`) and flags the player as `AWAY`.
* **Real AWAY Behavior:** When a player is `AWAY`, their ship sits stationary with zero velocity and manual abilities disabled. The ship retains forward-cone auto-fire along its last fixed heading, but takes full enemy damage and can be downed (which terminates auto-fire). No heuristic bot ever takes over a human's ship.
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
5. **Rail Priority Snap Resolution:** When multiple shielded enemies fall within the 50° forward cone (±25°), the snap prioritizes the target closest to the Core, breaking ties by nearest to the shooter, then by lowest entity pool index.
6. **Auto-Fire Target Stickiness:** Auto-fire locks onto the eligible target closest to the Core. A new target will not usurp the lock unless it is at least 10% closer to the Core than the current target.
7. **Dash Physical Interactions:** Dashing into outer walls stops the player with zero damage. Dashing into the Core stops motion cleanly. Dashing through teammates passes through without interaction. Dashing into a barricade halts motion without damaging the barrier. Dashing into a shielded brute from the front triggers a 1.0s spin; additional dashes during the spin reset the duration to 1.0s rather than accumulating time.
8. **Input Packet Loss Mitigation:** Button taps toggle the upper 4 bits of the input byte, latched deterministically on the host (`screen/src/host-loop.ts:145-156`). Consecutive taps during an active cooldown are discarded.
9. **Disconnect During Cooldown:** Cooldown timers are managed on the host simulation. Rejoining players receive current remaining cooldowns through `pad:state`.
10. **Disconnect During Revive:** If the reviver goes AWAY, the channel terminates immediately. If the downed player goes AWAY, their bleed-out pauses while the channel finishes. AWAY human slots sit idle (no standby bot takeover per FR-6).
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
* **Left Guide (`ScoreRulesPanel`):** Displays `HOW TO PLAY` bullets (including `BETWEEN WAVES: Core heals +10% HP; all players recover to 100% HP.`) and control rows: `A: LASER BEAM`, `B: QUICK DASH`, `X: ENERGY WALL`, `Y: REVIVE / BOMB`.
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
| `cyber:wave_start` | Host → All | `{ wave: number, targetSlot?: number }` | Wave start banner sync and phone vibration pulse. |
| `cyber:wave_end` | Host → All | `{ wave: number, coreHp: number }` | Wave break initiation. |
| `cyber:downed` | Host → All | `{ slot: number }` | Signals downed player UI state and vibration. |
| `cyber:revived` | Host → All | `{ slot: number }` | Restores player to active UI state. |
| `cyber:emp` | Host → All | `{ wave: number }` | Synchronized haptic burst, iOS Taptic switch pulse, and visual screen flash. |
| `cyber:match_end` | Host → All | `{ won: boolean, wavesCleared: number }` | Transmits final run results. |
| `cyber:rematch` | Host → Server | `{ action: 'restart' \| 'lobby' }` | Post-run rematch action. |
| `pad:state` | Host → All | `{ slot: number, labels?: string[], disabled?: number, cooldownEndsAt?: number[] }` | Context labels (`LASER`, `DASH`, `WALL`, dynamic `Y`) and cooldown synchronization. |

### C. Flat Simulation State Buffer (`Float32Array`) + Entity Pools (`auxState` `Uint8Array`)

#### 1. Primary State Buffer — `Float32Array(88)` (`352 bytes`)

```text
Global header (indices 0..7):
  [0] tickId        (monotonic fixed-step counter)
  [1] phaseEnum     (0=COUNTDOWN, 1=WAVE_ACTIVE, 2=WAVE_BREAK, 3=MATCH_OVER)
  [2] phaseTimer    (seconds left in COUNTDOWN or WAVE_BREAK)
  [3] wave          (1..8)
  [4] coreHp        (0..1000; coreMaxHp = 1000)
  [5] empCharge     (0..1)
  [6] empFiredCount (records wave number when Super Bomb fires; drives cyber:emp & rehydrate)
  [7] bossPhase     (0 = no boss, 1..3; highest active boss phase)

Per-player stride (10 floats x 8 slots, indices 8..87), base = 8 + i * 10:
  [base + 0] x
  [base + 1] y
  [base + 2] heading       (radians)
  [base + 3] hp            (0..100)
  [base + 4] flags         (Bit0=ACTIVE, Bit1=DOWNED, Bit2=IS_BOT, Bit3=DISCONNECTED, Bit4=EMP_JOINED, Bit5=STANDBY_BOT, Bit6=RESPAWNING, Bit7=JOINED)
  [base + 5] downTimer     (bleed-out or respawn seconds left)
  [base + 6] railCooldown  (0..2.5)
  [base + 7] dashCooldown  (0..1.8)
  [base + 8] reviveChannel (0..2.5)
  [base + 9] barricades    (active count, 0..2)
```

#### 2. Entity Pool Buffer (`auxState`)

Structured as a pre-allocated `Uint8Array` accessed via `DataView`, replicated across ticks via `ScreenSim.auxState` (`screen/src/host-loop.ts:15`, `:77-78`):

```text
enemies      160 x 8 B = 1280   x u16, y u16, hpPct u8, type u8, stateFlags+flank u8, target+facing u8
projectiles  256 x 6 B = 1536   x u16, y u16, owner+flags u8, ttl u8
barricades    24 x 6 B =  144   cellX u8, cellY u8, owner u8, hpPct u8, ttlSteps u8, flags u8
meta trailer             112    flankGlow(4), bossLaserAngle(2), bossWeakMask(1), bossHpPct(1),
                                squadDamage(4), enemiesRemaining(2), empJoined(1), empRequired(1),
                                bruteHeadings(32), bossSlots(4x4=16), bossLaserLen(4x2=8), reserved(40)
flow field    40 x 40  = 1600   optional debug trailer
total: 3072 B core (4672 B with debug flow field)
```

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
| `DOWNED` | ally revive channel completes (2.5 s) | `ACTIVE` | Restore `60` HP (`reviveRestoreHp`). |
| `DOWNED` | bleed-out ends | `RESPAWNING` | Start 8 s timer (4 s solo); charge 3% Core HP (cap and floor rules). |
| `RESPAWNING` | timer ends | `ACTIVE` | Spawn at the Core with `100` HP. |
| any | disconnected (`AWAY`) | same state, `DISCONNECTED` set | Ship sits stationary (zero velocity; retains forward-cone auto-fire along last heading; no bot takeover). Bleed-out pauses if downed. |
| any with `DISCONNECTED` | human rejoins | same state, `DISCONNECTED` cleared | Control resumes at current position, or respawns at Core with no penalty if dead. |
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
* **Rail Snap Priority:** Test rail priority snap onto shielded targets in the 50° cone (±25°), verifying Core-distance tie-breaking.
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
* **Dynamic Y Label:** Verify Button Y toggles between `REVIVE`, `BOMB`, and `JOINED`.
* **Haptic and Visual Cues:** Test vibration on Android and Taptic switch + visual flash fallback on iOS during Super Bomb activation.
* **AWAY Idle & Rejoin:** Simulate phone disconnect, verify ship sits idle with no bot takeover (bleed-out paused if downed), and confirm seamless handback via `<MatchRejoinQr/>` on reconnect.
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
8. **EMP (Super Bomb) effect and charge time:** **Resolved:** `empChargeSec: 3.0`, `empRingRadius: 130`, `empBlastRadius: 360`, `empDroneDamage: 250` (and `250` damage + `1.5s` stun to bosses; `125` damage + `4.0s` stun & shield break to brutes).
9. **Opening practice:** Run a practice phase before wave 1, like the other games? **Default: none.**
10. **Wave clear condition:** A wave ends when all its enemies are destroyed? **Default: yes.**
11. **Upgrade vote between waves:** The design page has a squad upgrade vote in each break; earlier review deferred this to later. **Default: later, not v1.**

---

## 9. Platform Dependencies (Status)

| Need | Status | Notes |
| :--- | :--- | :--- |
| **4 buttons** | Done | Held bits 0–3 and toggle bits 4–7 latched (`screen/src/host-loop.ts`). |
| **First-packet baseline** | Done | `screen/src/host-loop.ts` (PR #10). |
| **`stick-diamond` layout** | Done | Declared in `games/cyber-citadel/src/manifest.ts`. |
| **Host-driven cooldown wipe and Y label** | Done | `pad:state` emitted in `games/cyber-citadel/src/events.ts` and handled by `<ControllerShell/>`. |
| **Per-button hold masking** | N/A | All buttons are taps in v1. |
| **Lazy controller loading** | Pending | `controller/src/register-games.ts` still imports games eagerly; split if bundle grows. |
| **World state beyond 88 floats** | Done | Pools and meta trailer packed in `auxState` (`3072 B` core, `4672 B` with debug flow field). |
| **Bots see world state** | Done | `WriteBotInput` receives `auxState` in `heuristic.ts`. |
| **AWAY behavior** | Done | Real AWAY: idle ship with zero bot takeover (`standbyBotLevel` returns `0`). |
| **Late join** | Done | `MATCH_IN_PROGRESS` (`server/src/rooms.ts`). |
| **Deterministic sim** | Done | Mulberry32 PRNG in `games/cyber-citadel/src/world.ts`. |
| **Spatial broadphase** | Done | `UniformGridHash` in `shared/src/physics-2d/grid-hash.ts`. |

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
