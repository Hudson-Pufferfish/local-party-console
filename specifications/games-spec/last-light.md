# Last Light (`last-light`) — Tap-to-Lock Lamp Game Specification

> **AI Agent Instruction:** Read `../SPEC.md` and `./README.md` first. Last Light is a self-contained party game plugin under `/games/last-light` conforming to the platform `GameDefinition` contract. Never leak game-specific lamp, lock-in, or timing logic into `/server`, `/screen` or `/controller` shells. Status: design only. Nothing in this file is implemented yet.

---

## 1. Overview & `GameManifest` Contract

Last Light is a tension and bluffing game for 2 to 8 players (humans plus optional bots) played on one shared TV display. A large lamp centered on the screen slowly dims over time. At an undisclosed, pseudo-random moment determined by the host simulation, the lamp suddenly blows out. Every player starts unlocked ("in") and holds a single tap-to-lock action on their mobile controller. Each player may tap once per blowout to lock in their position. When the lamp extinguishes, anyone who remained unlocked is eliminated ("out") and scores zero. Among all players who successfully locked in prior to the blowout, the player with the latest lock-in timestamp earns the highest rank points. Rounds award points toward a match target score, with ties at or above the threshold resolved through sudden death.

**Locked:** Game feel emphasizes high-stakes nerve, timing, and bluffing akin to Bomb Pass. There is no spatial avatar movement or pushing. Lock-in status is public on the screen ranking panel, but exact lock timestamps remain strictly secret until the blowout occurs.

### Declarative Manifest (`manifest.ts`)

```typescript
import type { GameManifest } from '../../../shared/src/types/game.ts';

export const LAST_LIGHT_MANIFEST: GameManifest = {
  id: 'last-light', // Open question 9, default: 'last-light'.
  title: 'LAST LIGHT',
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
  controllerLayout: {
    // Proposal (not built): 'tap-only' is not in ControllerLayout yet
    // (shared/src/controller/layout.ts). Open question 5, default: add it.
    preset: 'tap-only',
    buttons: [{ bit: 0, glyph: 'A', label: 'LOCK IN', kind: 'tap' }],
  },
  themeTokens: {
    '--bg-surface': '#F4F1EA',
    '--ink-primary': '#111111',
    // Lamp colors: TBD in the renderer PR.
  },
};
```

Existing platform controller presets are `stick-single` and `stick-diamond` (`shared/src/controller/layout.ts`), with `ControllerShell` mounting `<VirtualJoystick label="MOVE" />` by default (`shared/src/ui/controller-shell.tsx:114`). If the dedicated `tap-only` preset proposal is deferred, the controller shell can adopt `stick-single` and suppress joystick display via the existing `customBoardClass` property (`shared/src/ui/controller-shell.tsx:20`). The primary button label `LOCK IN` is the default.

---

## 2. Functional Requirements (FR)

### FR-1: Stage & Lamp Geometry

* **Screen Canvas:** Renders inside the standard 800 x 800 center viewport provided by `<HolisticMatchShell>` (`screen/src/components/holistic/holistic-match-shell.tsx`).
* **Zero World Physics:** There are no moving pucks, velocity vectors, or spatial obstacle collisions. The entire canvas is dedicated to rendering the central procedural lamp and its surrounding illumination field.
* **Lamp Prominence:** The lamp is large, centered, and clearly readable from across a living room couch.
* **No On-Screen Clocks:** Numerical countdowns, remaining time displays, or "blows at" timers are strictly prohibited from appearing on the TV or phone screens.

### FR-2: Lock-In Input (One Tap per Blowout)

* **Input Mechanism:** Single tap per player per blowout across both practice and scored rounds. Holding the button is not supported.
* **Rising Edge Detection:** The lock action triggers on the rising edge of button bit 0. `<ArcadeButton/>` dispatches on pointer down (`shared/src/ui/arcade-button.tsx`), toggling high bits 4..7 in the transmission packet (`controller/src/send-input.ts:101-120`). The host latches new edges (`screen/src/host-loop.ts:145-156`) and processes them on the subsequent 120 Hz simulation tick in `applyInput(playerIndex, buttons, axisX, axisY)`.
* **Lock Timing Rule:** The variable `lockTick` stores the simulation tick when the host registers the rising edge. A lock is valid only if `lockTick < blowoutTick` (strictly before the blowout). Taps registered on or after `blowoutTick` are rejected as late.
* **Single Lock Lockout:** Once a player locks in, further button presses in that blowout produce no effect.
* **Analog Axes:** Directional axes (bytes 6 and 7) are ignored.
* **Pre-Round Input Invalidation:** Buttons held prior to `ROUND_ACTIVE` do not register locks. During `COUNTDOWN`, held buttons are recorded without triggering edges, matching Color Clash input handling (`games/color-clash/src/simulation.ts`). A button held from countdown into the round must be released and tapped anew.
* **Phase Invalidation:** Inputs received during `COUNTDOWN`, `ROUND_END`, or `MATCH_OVER` are discarded.

### FR-3: Blowout Timing, Lamp Dimming & Flickers

* **Blowout Roll (Host Simulation Only):**
  * At the start of each blowout, the host selects a secret `blowoutTick` derived from a seeded pseudo-random number generator following the Bomb Pass architecture (`games/bomb-pass/src/simulation.ts:710`).
  * The secret blowout tick resides exclusively in private simulation memory and is never written to public state buffers or broadcast to controllers.
  * The blowout window enforces a silent floor $T_{\text{min}}$ followed by an escalating hazard rate up to a hard cutoff $T_{\text{max}}$.
  
| Window Type | $T_{\text{min}}$ | $T_{\text{max}}$ |
| :--- | :--- | :--- |
| Scored Round (`ROUND_ACTIVE`) | 3.0 s | 12.0 s |
| Practice Blowout (`PRACTICE`) | 1.0 s | 3.5 s |

* **Distribution Properties:** Precise hazard parameters are TBD (tune in playtest). The probability curve is non-linear and concealed from players to prevent rote timing exploitation. Timing windows are identical for 2 through 8 players.
* **Fixed Dimming Curve:** The lamp dims along a predetermined, fixed luminescence curve independent of the chosen `blowoutTick`, declining from 100% luminance at start to 20% at the 12.0s boundary. When the blowout tick occurs, the lamp cuts to complete darkness instantly. The dimming curve never leaks the scheduled blowout time.
* **Atmospheric Flickers:** Rare, transient micro-flickers occur during the blowout window as auditory/visual tension noise. Flickers do not provide reliable predictive cues for the impending blowout.
* **Blowout Beat:** At the exact moment of blackout, the TV canvas cuts dark, and connected phone controllers simultaneously trigger a visual screen flash and haptic pulse.

### FR-4: Multi-Round Match Flow, Scoring, Sudden Death & Podium

The match lifecycle utilizes five standard phases: `0 = COUNTDOWN`, `1 = ROUND_ACTIVE`, `2 = ROUND_END`, `3 = MATCH_OVER`, `4 = PRACTICE`.

1. **`PRACTICE` (`phaseEnum = 4`):** Runs for 30.0s (`practiceInitial`) at match opening, and 20.0s (`practiceBreak`) between scored rounds, matching Color Clash constants (`games/color-clash/src/constants.ts:45-46`). During practice, the game loops through rapid practice blowouts ($1.0\text{s} - 3.5\text{s}$ windows) followed by a 0.6s reveal, awarding no match points.
2. **`COUNTDOWN` (`phaseEnum = 0`, 3.0s):** Lamp illuminates at steady maximum brightness while the screen banner displays `3`, `2`, `1`. Eligible players reset to unlocked status.
3. **`ROUND_ACTIVE` (`phaseEnum = 1`):** Executes one scored blowout ($3.0\text{s} - 12.0\text{s}$).
4. **`ROUND_END` (`phaseEnum = 2`, 0.8s):** Evaluates locks, awards rank points, and determines progression:
   * If the leading score $top \ge targetScore$ with a single leader, transitions to `MATCH_OVER`.
   * If two or more leaders tie with $top \ge targetScore$, initiates leaders-only sudden death, skipping practice break and advancing directly to `COUNTDOWN`.
   * If no player locked in (void round), triggers `NO LOCK` banner and advances to `PRACTICE` (or repeats countdown in sudden death).
   * Otherwise, advances to `PRACTICE` (20.0s) followed by `COUNTDOWN`.
5. **`MATCH_OVER` (`phaseEnum = 3`):** Displays final standings on screen, offering shared **PLAY AGAIN** and **RETURN TO LOBBY** controls.

#### Scoring Rules

Scoring adheres to the ranked survival formula adapted from Color Clash (`games/color-clash/src/scoreboard.ts`):

* **Lobby Size ($N$):** Count of joined slots at match start, including active bots and disconnected humans.
* **Target Score Formula:** $targetScore = \max(3, (N - 1) \times 3)$, locked at match start.
* **Rank Points:** A player who locked in earns $N - 1 - (\text{count of players with strictly later } lockTick)$. The latest valid tapper earns $N - 1$ points.
* **Same-Tick Ties:** Players locking on the exact same simulation tick share the points for that rank.
* **Non-Tappers:** Players who fail to lock in prior to the blowout receive 0 points.
* **Sudden Death:** Non-contenders are parked (flagged inactive with inputs ignored). The sole latest lock-in among active contenders earns $+1$ point. Sudden death rounds repeat until a single leader emerges at or above target score.

| Player Count ($N$) | Target Score | Point Payouts (Latest to Earliest Lock) |
| :--- | :--- | :--- |
| 2 Players | 3 | +1, +0 |
| 3 Players | 6 | +2, +1, +0 |
| 8 Players | 21 | +7, +6, +5, +4, +3, +2, +1, +0 |

#### Worked Examples

* **2 Players ($N = 2$, Target 3):** Blowout occurs at 9.0s. Ada locks at 8.1s, Beau locks at 8.4s. Beau earns $+1$, Ada earns $0$. In round 2, Beau does not tap, Ada locks at 6.0s: Ada earns $+1$, tying score 1–1. If both lock on the exact same tick, both receive $+1$. If neither taps, the round is void with zero points awarded.
* **3 Players ($N = 3$, Target 6):** Blowout occurs at 7.5s. Ada locks at 6.0s, Beau at 7.2s, Cam fails to tap: Beau earns $+2$, Ada earns $+1$, Cam earns $0$. In round 2, Cam locks at 7.4s, Beau at 7.2s, Ada at 6.0s before blowout at 7.5s: Cam earns $+2$, Beau $+1$, Ada $0$. Standings reach 1–3–2. If Ada and Beau tie at 6–6 with Cam at 4, sudden death begins: Cam is parked, and the next round winner earns $+1$ to claim victory.
* **8 Players ($N = 8$, Target 21):** Blowout occurs at 9.2s. Five players lock at 4.0s, 6.1s, 7.8s, 8.2s, and 8.9s, while three players never tap. The 8.9s tap receives $+7$, followed by $+6$, $+5$, $+4$, $+3$. The three non-tappers receive $0$. If all eight players lock on the identical tick, all eight earn $+7$.

#### Banner Notifications

Top screen banner displays `BREAK <n>` in practice, countdown numbers `3 / 2 / 1`, `POINT` after scored rounds, `<TAG> WINS` upon match completion, `SUDDEN DEATH` during tiebreakers, and `NO LOCK` for void rounds.

### FR-5: Phone Controller Layout & Feedback

* **Primary Interface:** Displays a single prominent `<ArcadeButton/>` bound to bit 0, labeled `LOCK IN`. Directional sticks are omitted.
* **Header Bar:** Renders `<PlayerBadge/>` with player slot number, tag, and current match score.
* **State Label Feedback:** Dynamic text displays current player status:
  * `IN`: Unlocked and active during a live blowout.
  * `LOCKED`: Host has accepted the lock-in tap. Button is disabled and re-labeled `LOCKED`.
  * `OUT`: The lamp blew out before the player tapped.
  * `WATCHING`: Player is parked as a spectator during sudden death.
* **Host Confirmation:** Phone displays `LOCKED` only upon receiving host confirmation events, preventing optimistic false states.
* **Blowout Feedback:** At blowout, phones execute a visual white screen flash and vibration pulse.
* **State Rehydration:** Reconnecting controllers receive current phase, lock status, and scores via the proposed `light:state` message.
* **Safety Insets:** Touch targets maintain at least 36px margins from device display boundaries.

### FR-6: Disconnect & Mid-Match Rejoin (`SCAN TO REJOIN`)

* **Input Invalidation:** When a controller stops communicating for 100ms or longer, inputs are zeroed (`screen/src/host-loop.ts:189-200`) and the scoreboard marks the player `AWAY`.
* **Disconnection While Locked:** If an already locked player disconnects, their lock and timestamp remain valid.
* **Disconnection While Unlocked:** An unlocked player who disconnects remains unlocked without auto-locking. If still disconnected at blowout, they score 0 points.
* **Simulation Masking:** Simulation consumes `setConnectedMask(mask)` (`games/bomb-pass/src/simulation.ts:741`), preventing disconnected slots from generating valid lock events.
* **Pre-Round Disconnect:** Disconnected slots remain counted in lobby size $N$ and target score calculations. If they reconnect prior to blowout, they may tap to lock.
* **Rejoin Authorization:** Reconnecting players must possess a valid session token from match start (`server/src/rooms.ts:97-100`). The screen renders `<MatchRejoinQr/>` (`screen/src/score-rules.tsx`).
* **Unauthorized Joins:** Unregistered clients attempting mid-match connections receive `room:rejected` with reason `MATCH_IN_PROGRESS`.
* **No Bot Takeover:** Heuristic bots do not take over disconnected player seats in v1.

### FR-7: Industrial Neo-Brutalist Visuals & Game Feel (Zero Art Assets)

* **Procedural Graphics:** Built entirely using Phaser 4 vector geometry on matte paper background `#F4F1EA` with `#111111` ink line-work.
* **Lamp Focus:** The entire center canvas is devoted to the central lamp, featuring glowing filament lines, a geometric glass shade, and dynamic radial lighting.
* **Zero Art Assets:** Does not load external PNG or SVG sprites.
* **Player Palettes:** Player indicators use colors defined in `PLAYER_COLORS` (`shared/src/registry.ts`).
* **Lamp Color Tone:** Primary illumination color is TBD (tune in playtest), avoiding yellow `#F5C518` which is reserved for system UI chrome.

### FR-8: In-Match Host Exit (`MatchExitControl` → `resetLobby`)

* **Universal Exit Control:** Desktop host screen mounts `<MatchExitControl/>` (`screen/src/match-exit.tsx`) in the top-right corner.
* **Clean Reset:** Confirming exit invokes `session.resetLobby()`, terminating active game loops, clearing room state, and broadcasting `game:unmount` + `room:phase: lobby` to return all participants to the lobby carousel.
* **Podium Rematch:** End-of-match podium options dispatch `light:rematch` with `{ action: 'restart' | 'lobby' }`.

### FR-9: Edge Cases (Mandatory Deterministic Rules)

1. **Same-Tick Lock Ties:** Simulation runs at 120 Hz. Locks received on the exact same tick are considered simultaneous ties. In normal rounds, tied players share points for that rank. In sudden death, a tied latest lock awards zero points and triggers an immediate sudden-death replay. Sub-tick tie-breaking is prohibited.
2. **Network Jitter & Receipt Order:** Locks are timestamped on the simulation tick of host receipt. Pre-dated client timestamps are used strictly for telemetry diagnostics and do not override host arrival sequence.
3. **Late Taps Post-Blowout:** Any tap registered on or after `blowoutTick` is invalid and ignored.
4. **Mid-Round Disconnection:** Handled per FR-6 rules; existing locks persist, while unlocked slots receive 0 points if still uncommitted at blowout.
5. **Round-Start Disconnection:** Disconnected players remain active in the round roster and can reconnect to tap before the lamp blows.
6. **Controller State Resynchronization:** Reconnecting clients immediately receive full match state (`light:state`) including current phase, personal lock status, and leaderboard points.
7. **Mid-Match Stranger Connections:** Mid-match join attempts by unauthorized clients are rejected with `MATCH_IN_PROGRESS`.
8. **Simultaneous All-Player Taps:** Permitted. The latest tap wins; same-tick arrivals share points.
9. **Zero-Lock Void Rounds:** If no player taps before the blowout, the round is declared void, displaying banner `NO LOCK` with zero points awarded, advancing to practice break (or repeating countdown in sudden death).
10. **Scale Invariance:** Timing windows ($T_{\text{min}}$, $T_{\text{max}}$) and scoring structures remain identical across all squad sizes (2 to 8 players).
11. **Practice Timer Expiration Mid-Blowout:** A new practice blowout will not commence if less than 4.1s ($T_{\text{max}} + 0.6\text{s}$) remains on the practice clock, keeping the lamp steady until countdown.
12. **Persistent Button Hold Across Phases:** Buttons held through countdown into active play fail to trigger a rising edge. Players must release and re-tap.

### Heuristic Bot

* **Input Interface:** Bots execute via `WriteBotInput` (`screen/src/bot-fill.ts:151`) using difficulty rankings (`Easy: 11-20`, `Medium: 30-50`, `Hard: 50-70`).
* **Decision Heuristic:** At the start of each blowout, a bot rolls a planned target lock time based solely on public parameters ($T_{\text{min}}$, $T_{\text{max}}$, difficulty mean, and jitter). Bots never access the private `blowoutTick`.
* **Execution:** When the simulation tick matches the bot's planned lock time, it dispatches button bit 0. If the lamp has already blown out, the tap fails and the bot is eliminated.
* **Difficulty Curve:**
  * **Easy:** Early lock mean, high timing jitter, ~20% probability of failing to tap.
  * **Medium:** Mid-window lock mean, moderate timing jitter, ~8% probability of failing to tap.
  * **Hard:** Late-window lock mean, tight timing precision, ~3% probability of failing to tap.
* **Static Roster:** Bots are assigned strictly at match start and cannot replace disconnected human players.

### Scoreboard, Round End & Match Over

* **Right Scoreboard Panel (`ScoreboardPanel`):** Renders match header `THRESHOLD: <n>` (or `SUDDEN DEATH`), displaying player rows with color dots, tags, scores, and `LIVE` / `AWAY` status badges.
* **Left Rules & Lock-In Panel (`ScoreRulesPanel`):**
  1. Top instructional copy: `Tap to lock in`, `Latest tap before the blowout wins`, `Never tapped? You are out`.
  2. Public Lock-In Roster: Displays color dots and short tags of players who have successfully locked in. Does not reveal timestamps or chronological rank order.
  3. Payout Table: Lists point distribution (`1ST: +7 PTS`, etc.), collapsing to `1ST: +1 PTS` during sudden death.
* **ScoreRules Extension Proposal:** Proposes extending the `ScoreRules` type (`screen/src/register-games.ts:29-30`) with optional `howTo: string[]` and `lockedIn: { slot: number, name: string, color: string }[]` fields rendered above standard rule rows.
* **Podium Sequence:** Displays final match standings, winner highlight, and host rematch controls.

---

## 3. Non-Functional Requirements (NFR)

| Requirement | Target | Specification |
| :--- | :--- | :--- |
| **Fixed Timestep Determinism** | 120 Hz tick | Simulation loop steps at 120 Hz ($dt \approx 8.333\text{ms}$), decoupled from browser refresh rates. |
| **Zero-Allocation Hot Path** | 0 heap allocs | `step()` tick produces zero dynamic heap allocations; state is stored in flat arrays. |
| **End-to-End Latency** | $< 50\text{ms}$ | Controller tap to screen registration latency remains under 50ms on local Wi-Fi. |
| **Mobile Ergonomics** | 36px insets | Touch targets maintain at least 36px safety margins from display edges. |
| **Strict View Compliance** | `holistic` only | Game logic executes exclusively under holistic host mode; secondary monitor views remain idle. |
| **Lamp Render Budget** | $\le 4\text{ms}$ / frame | Procedural lamp rendering completes in under 4ms on an M5 Pro Mac. |
| **Secret Blowout Guarantee** | Zero leak | The secret blowout tick and competitor lock timestamps are never transmitted over network channels or written to shared client buffers. |
| **Weak-Phone Compatibility** | Zero canvas load | Phones run lightweight HTML button interfaces without Canvas or WebGL overhead. |

---

## 4. Technical Contracts, Memory Layouts & Endpoints

### A. Data-Plane Binary Input Contract (8 Bytes — WebRTC UDP / `ws` Fallback)

Controllers transmit 8-byte binary input packets:

```text
Byte 0..1 : [Uint16] sequenceNumber (monotonic counter)
Byte 2..3 : [Uint16] clientTimestamp (ms)
Byte 4    : [Uint8]  touchLagMs (input latency measurement)
Byte 5    : [Uint8]  buttons     Bit 0 = LOCK IN (rising edge triggers lock)
                                 Bits 1..3 = Reserved (0); bits 4..7 = toggle bits (send-input.ts)
Byte 6    : [Int8]   axisX       Ignored by Last Light (0)
Byte 7    : [Int8]   axisY       Ignored by Last Light (0)
```

### B. Control-Plane WebSocket Contracts (`ws` JSON — Reliable TCP)

**Proposal (not built):** The `light` prefix must be added to `ALLOWED_GAME_PREFIXES` in `shared/src/types/game-control.ts:1`. Payloads broadcast to the room omit secret timestamps:

| Event `type` | Direction | Payload Schema | Purpose |
| :--- | :--- | :--- | :--- |
| `game:mount` | Server → All | `{ gameId: 'last-light', manifest, players, botNames? }` | Standard platform mounting event. |
| `light:practice_start` | Host → All | `{ durationMs: 30000 \| 20000, breakNumber: number }` | Signals practice phase to controllers. |
| `light:round_start` | Host → All | `{ roundNumber, countdownMs: 3000, scores: number[], suddenDeath: boolean, contenderMask: number }` | Resets controllers to `IN` or `WATCHING`. |
| `light:lock` | Host → All | `{ lockedMask: number }` | Broadcasts mask of locked slots without timestamps. |
| `light:blowout` | Host → All | `{ lockedMask: number, outMask: number, practice: boolean }` | Triggers controller screen flash and haptics. |
| `light:round_end` | Host → All | `{ winnerIndex: number \| null, scores: number[], matchOver: boolean, suddenDeath: boolean, void: boolean }` | Delivers round resolution and score updates. |
| `light:state` | Host → All | `{ phase, lockedMask, contenderMask, scores: number[] }` | Rehydrates controller state on connect or reconnect. |
| `light:match_end` | Host → All | `{ winnerIndex: number, scores: number[] }` | Signals match completion and podium display. |
| `light:rematch` | Host → Server | `{ action: 'restart' \| 'lobby' }` | Dispatches post-match rematch decision. |

### C. Flat Simulation State Buffer (`Float32Array` SoA Layout)

Uses the platform standard 88-float state snapshot (`SNAPSHOT_FLOATS = 88`, `screen/src/host-loop.ts:4`) with zero `auxState` requirements:

```text
Global header (indices 0..7):
  [0] tickId          (monotonic fixed-step counter)
  [1] phaseEnum       (0=COUNTDOWN, 1=ROUND_ACTIVE, 2=ROUND_END, 3=MATCH_OVER, 4=PRACTICE)
  [2] phaseTimer      (seconds left in PRACTICE, COUNTDOWN or ROUND_END; 0 in ROUND_ACTIVE)
  [3] lampElapsed     (seconds since the current blowout started; 0 when no lamp runs)
  [4] lampFlags       (Bit0=LIT, Bit1=BLOWN, Bit2=FLICKER, Bit3=PRACTICE_BLOWOUT, Bit4=VOID_ROUND)
  [5] activeMask      (8-bit mask of slots in play this round)
  [6] blowoutCount    (increments on every blowout, scored or practice; drives events)
  [7] winnerSlot      (-1 while undecided; 0..7 once the match winner is locked)

Per-player stride (10 floats x 8 slots, indices 8..87), base = 8 + i * 10:
  [base + 0] flags            (Bit0=ACTIVE, Bit1=LOCKED, Bit2=IS_BOT, Bit3=CONTENDER, Bit4=OUT, Bit5=DISCONNECTED)
  [base + 1] lockTick         (ticks from blowout start; -1 when not locked; never rendered while LIT)
  [base + 2] score            (match points)
  [base + 3] lastRoundPoints  (points from the last scored round)
  [base + 4..9] reserved      (0)
```

The secret `blowoutTick` and RNG state are maintained in private simulation memory and excluded from this public buffer.

### D. Route & Viewport Endpoints

* `/screen?view=holistic`: Mounts `LastLightRenderer` inside `<HolisticMatchShell/>`.
* `/controller`: Mounts `LastLightController` with single `LOCK IN` button interface.
* Auxiliary views (`/screen?view=team-1`, etc.) stay in dormant standby mode.

---

## 5. Finite State Machines (FSM)

### A. Match Lifecycle FSM

```text
startMatch
  -> PRACTICE (30 s, practiceInitial): repeated practice blowouts, no points
  -> COUNTDOWN (3 s)
  -> ROUND_ACTIVE: one hidden scored blowout
  -> ROUND_END (0.8 s)
       -> unique top score at or above target? MATCH_OVER
       -> two or more tied at the top, at or above target? COUNTDOWN (skip practice), non-leaders parked
       -> nobody locked (void)? PRACTICE (20 s); in sudden death, COUNTDOWN
       -> else PRACTICE (20 s, practiceBreak), then COUNTDOWN
MATCH_OVER -> [light:rematch action]
```

### B. Per-Player Lock FSM

| Current State | Trigger / Condition | Next State | Side Effects |
| :--- | :--- | :--- | :--- |
| `IN` | bit 0 rising edge during a live blowout, `lockTick < blowoutTick`, slot connected | `LOCKED` | Set `LOCKED`, store `lockTick`, emit `light:lock`. |
| `IN` | blowout tick reached | `OUT` | Set `OUT`; 0 points on a scored round. |
| `LOCKED` | any input | `LOCKED` | Ignored. |
| `LOCKED` | blowout tick reached | `RANKED` | Points from the FR-4 table on a scored round. |
| any | sudden death starts, slot is not a leader | `PARKED` | Clear `CONTENDER` and `ACTIVE`; inputs ignored; phone shows `WATCHING`. |
| any | new blowout starts | `IN` | Clear `LOCKED`, `OUT`, `lockTick = -1` (parked slots stay `PARKED`). |

---

## 6. Strict System & Physics Invariants

1. **INV-1 (No NaN / Infinity State):** Every float within the 88-float buffer evaluates to a finite number on every simulation tick.
2. **INV-2 (One Lock per Blowout):** A player slot locks at most once per blowout; `lockTick` is immutable once recorded.
3. **INV-3 (Locks Before Blowout):** Valid locks satisfy `lockTick < blowoutTick`.
4. **INV-4 (Non-Tappers Score Zero):** A slot lacking a recorded lock receives 0 points for that round.
5. **INV-5 (Score Domain):** Player scores are monotonically non-decreasing, increasing by at most $N - 1$ points in normal rounds and at most $+1$ point in sudden death.
6. **INV-6 (Guaranteed Finite Termination):** Every scored blowout terminates within $T_{\text{max}} = 12.0\text{s}$; practice blowouts terminate within 3.5s. Void rounds conclude without stalling.
7. **INV-7 (Bit-Exact Determinism):** Identical seeds, rosters, and input sequences yield bit-exact identical state buffers.
8. **INV-8 (Secret Blowout Invariant):** Network messages and live screen displays never contain the scheduled blowout tick or competitor lock timestamps.
9. **INV-9 (Zero-Allocation Hot Path):** Simulation tick generates zero heap allocations.
10. **INV-10 (Strict View Isolation):** Rendering operates exclusively under `/screen?view=holistic`.

---

## 7. Testing & Verification Plan

### 1. Deterministic Unit Tests (`vitest`)

* **Blowout Boundaries:** Assert seeded blowouts fall strictly within $[3.0, 12.0]\text{s}$ for scored rounds and $[1.0, 3.5]\text{s}$ for practice, replicating identically on repeated seeds.
* **Worked Example Validations:** Verify the 2-player, 3-player, and 8-player worked examples yield expected score totals.
* **Tie Scoring:** Test that same-tick locks share rank points, and sudden-death same-tick ties trigger replays without point gain.
* **Zero-Lock Void Handling:** Verify rounds where nobody taps award zero points and advance to practice break.
* **Pre-Round Input Filtering:** Confirm buttons held during countdown do not lock on round start.
* **AWAY Connection Enforcement:** Assert disconnected slots cannot lock, and existing locks survive subsequent disconnects.
* **Heuristic Information Barrier:** Verify bot decision algorithms read only public timing parameters without accessing private simulation memory.

### 2. State Machine & Property-Based / Fuzz Tests

* **10,000-Tick Fuzz:** Execute a 10,000-tick randomized fuzz test with explicit timeout asserting invariants `INV-1` through `INV-8`.
* **Bit-Exact Replay Verification:** Verify replaying recorded inputs against identical seeds reproduces bit-exact state buffers.

### 3. Hardware, Network & Latency Verification Checklist (M5 Pro Mac + Phones)

* **Touch Ergonomics:** Test single-button tap response on iOS Safari and Android Chrome with 36px edge clearance.
* **Visual Lock Indication:** Confirm button shifts to `LOCKED` only after host verification.
* **Blowout Feedback:** Validate synchronized screen flash and haptic vibration across all phones upon lamp extinction.
* **Reconnection Rehydration:** Test mid-round phone reconnection, confirming immediate restoration of score and lock state.
* **Holistic View Enforcement:** Verify `/screen?view=team-1` remains in idle standby mode.
* **Host Exit Execution:** Confirm top-right `[x]` exits match safely to lobby carousel.

---

## 8. Open Questions (Defaults Used in This Spec)

1. **Payout `N`:** Full lobby with non-tappers forced to 0, or rank only tappers? **Default: full lobby.**
2. **Sudden death break:** Skip the 20 s practice (like Bomb Pass), or keep it (like Color Clash)? **Default: skip.**
3. **Flickers:** None, honest only, or mixed fakes? **Default: mixed and rare.**
4. **Windows:** 3 to 12 s scored, 1 to 3.5 s practice, increasing hazard after the floor? **Default: yes.**
5. **Controller layout:** New `tap-only` preset, or hide the `stick-single` joystick with CSS? **Default: `tap-only` preset (proposal).**
6. **Left column:** Extend `ScoreRules` with `howTo` and `lockedIn`, or draw in the arena canvas? **Default: extend `ScoreRules` (proposal).**
7. **Same-tick tie in sudden death:** Replay with no $+1$? **Default: replay.**
8. **Late join in practice breaks:** Keep `MATCH_IN_PROGRESS` for v1? **Default: yes.**
9. **Ids:** Game id `last-light`, event prefix `light`? **Default: yes.**
10. **AWAY:** Keep an existing lock, never auto-lock, no bot takeover in v1? **Default: yes.**
11. **Practice timer ending mid-blowout:** Stop starting new practice blowouts when less than 4.1 s remain? **Default: yes.**

---

## 9. Later Ideas (Not v1)

| Idea | Cost | Opinion |
| :--- | :--- | :--- |
| **Post-round timeline (lock marks and the cut, shown only after blowout)** | Low | Best teacher; keeps the bluff. Top pick. |
| **Synced phone flash and buzz on blowout** | Very low | The jump-scare beat. Top pick, do in v1 if possible. |
| **Practice ghost (faint mark where the lamp cut, in practice)** | Low | Teaches that the dim curve is not the answer. Top pick. |
| **Rare fake flickers** | Low | Already the default in FR-3. Tune or drop. |
| **MVP titles at match over ("Ice Veins", "Chicken", "Last Blink")** | Low | Cheap laughs. |
| **Double lamp (two blowouts in one round, one shared lock)** | Medium | Confusing. Later, if ever. |
| **Hot-seat modifier (one player cannot lock until someone else has, once per match)** | Low | Optional party modifier, not default. |
