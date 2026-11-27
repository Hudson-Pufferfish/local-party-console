# SPEC.md — Party Console Platform & Systems Architecture Specification

> **AI Agent Instruction:** Read this specification carefully before generating or modifying any code. All architectural seams, zero-allocation hot paths, cache-aware memory layouts, WebRTC/WebSocket transport rules, UI styling rules, and strict multi-monitor synchronization requirements defined below are strict project invariants. For specific game mechanics, controller layouts, and the extensible game module contract, refer to `./games-spec/README.md`.

---

## Part 1: Master System Architecture, Tech Stack & Optimization Spec

### 1. Equipment, Hardware & Prerequisites
* **Host Machine (The Console):** Apple Silicon **M5 Pro MacBook, 16 GB**. **Chrome** (one profile) is the host browser. The primary `/screen` tab **owns the simulation and the WebRTC peer**. Fastify does not simulate and does not terminate WebRTC. Holistic host view uses **external monitor(s)**. A TV is not required. The same primary-tab rules apply. The Mac connects up to **3 external monitors** through a **Kensington DisplayLink 4K Docking Station, model K33621NA** (14 ports: 3×HDMI, 3×DisplayPort, 4×USB-A, 2×USB-C 3.2, Ethernet, audio, 100W PD) and may also use the Mac's native ports for `team-exclusive` views (`team-1`, `team-2`).
* **M5 Pro + K33621NA DisplayLink Dock Routing Rules:**
  * **Why It Matters:** DisplayLink ports on the K33621NA use software screen capture + USB video compression (`DisplayLink Manager`), adding **12–35ms of variable lag** and frame drops during fast full-screen panning, whereas the M5 Pro's built-in HDMI/Thunderbolt ports and the dock's **native DP Alt-Mode path** scan out directly from the M5 Pro GPU in **$< 0.5\text{ms}$**.
  * **Symmetric Team Routing:** Always plug competing team monitors (`team-1` and `team-2`) into **symmetric port types**—ideally both on **native M5 Pro GPU outputs** (Mac built-in HDMI/Thunderbolt, or the dock's native DP Alt-Mode path) and put the neutral `/holistic` spectator scoreboard on a slower DisplayLink USB port.
  * **DisplayLink Resolution Cap:** If any gameplay monitor runs over a DisplayLink port, lock its macOS resolution to **1920$\times$1080 @ 60Hz** to prevent USB 3.2 bandwidth saturation and micro-stutters. The dock's six video jacks support at most 3 external monitors at once.
* **Controllers (Player Devices):** Up to 8 smartphones (from modern flagships down to 6-year-old budget Androids or older iPhones). **Zero native app installation required**—players scan a dynamic QR code on the monitor using their native camera and play inside Safari or Chrome.
* **Day-1 Local Network Setup:**
  * Host M5 Pro MacBook wired via the **K33621NA dock's Gigabit Ethernet port** when that link is available (`Phone -> Router -> Wired Mac`) to cut wireless hops in half.
  * Phones connected to a **5GHz Wi-Fi band** to separate game traffic from 2.4GHz Bluetooth accessories (AirPods/smartwatches) that share antennas on older phones.
* **Stretch Hardware / LAN Appliance (Optional Sub-3ms Party Setup):**
  * **Option A (Direct Hotspot):** USB Wi-Fi 6/5GHz adapter on the Host Mac running in Access Point (`hostapd` / Internet Sharing) mode so phones connect directly in 1 hop.
  * **Option B (Dedicated Console Router):** A travel router (e.g., GL.iNet Beryl 7 / Beryl AX running OpenWrt) wired into the dock's Ethernet port, configured to **5GHz Channel 149 (US) / Channel 44 (EU), narrow 20MHz channel width** (aligns with Apple's native `awdl0` AirDrop/AirPlay social channel to eliminate periodic 20–50ms iOS/macOS radio channel-hopping spikes, while maximizing SNR for weak phone antennas), **Airtime Fairness (`atf`) enabled**, and **WMM Voice (`VO`) DSCP tagging**.
* **Local HTTPS Prerequisite:** Phones need a secure context for Wake Lock and for any later `DeviceOrientationEvent` use. Serve the LAN address with **Caddy** or a **mkcert**-trusted certificate. `@vitejs/plugin-basic-ssl` is allowed only when every phone trusts that certificate. **Do not use Cloudflare Tunnel for play.** A tunnel adds Internet delay and breaks the motion-to-photon budget. `sumo-dash` v1 does not read the gyroscope.

---

### 2. Finalized Tech Stack (By Layer)

| Area | Selected Technology | Role & Justification |
| :--- | :--- | :--- |
| **Monorepo & Build** | **TypeScript + Vite** | Shared types/interfaces (`ScreenViewTarget`, `GameViewConfig`, `PlayerSlot`) across `/shared`, `/server`, `/screen`, and `/controller` with instant HMR. |
| **Host Execution Mode** | **Local Web App (v1) $\rightarrow$ Optional Tauri Wrapper (Distro Stretch)** | Run as a local desktop browser web app on the M5 Pro MacBook during development/home play to avoid cross-OS packaging taxes; optionally wrap in **Tauri (Rust)** only if distributing standalone binaries across Windows/macOS/Linux. |
| **UI Shell (Screen & Phone)** | **SolidJS 2 (Zero React)** | Fine-grained signals with zero Virtual DOM overhead and a small bundle for QR loads on old phones. |
| **Design System & Styling** | **Tailwind CSS + Custom CSS Variables** | Zero-runtime CSS compiled at build time. Powers custom **Industrial Neo-Brutalism** (Teenage Engineering / Playdate) hardware primitives. |
| **2D / 3D Game Engines** | **Phaser 4** (2D) & **Three.js** (3D) | Mounted in a SolidJS `<canvas ref>`. Parameterized by `view` (`holistic` or `team-N`). Renderers are read-only. Authoritative physics stays in `GameSimulation`, not in Phaser or Three. |
| **Simulation & monitor sync** | **v1: host Chrome tab. Stretch 2: `SharedWorker` + SAB** | v1 runs **one** 120Hz sim (`MAX_PLAYERS = 8`) in the primary `/screen` tab. Other monitor tabs are read-only and receive snapshots over `BroadcastChannel` (same Chrome profile). Stretch 2 moves the sim into a `SharedWorker` and a 128-byte-aligned triple-buffered `SharedArrayBuffer`. |
| **Control Plane & Signaling** | **Node.js + Fastify + raw `ws`** | No Socket.IO. Serves static bundles, manages 4-letter room codes, `TCP_NODELAY`, `perMessageDeflate: false`. Relays SDP/ICE and opaque control messages. Relays binary input only for phones on the WebSocket fallback. Does not run physics and does not terminate WebRTC. |
| **High-Frequency Data Plane** | **WebRTC DataChannel, peer = host Chrome tab (Day 1)** | Unordered, unreliable (`ordered: false, maxRetransmits: 0, negotiated: true, id: 0`), 8-byte payloads, `iceServers: []`. Day 1 writes the host LAN IPv4 into the SDP (mDNS bypass). If the DataChannel is not open within **3s**, `sendFastInput` uses binary `ws`. `bufferedAmount > 64` drops that packet. The 64-byte rule is not the connect timeout. |

---

### 3. Core Architectural Seams (Day-1 Rules)
Enforce two boundaries on Day 1 so v1.1 heuristic bots, Stretch 2 (SharedWorker / SAB / WASM), and Stretch 4 (ONNX) do not rewrite game or UI code:

1. **Seam 1 — Control Plane vs. Data Plane (`GameTransport`):**
   * **Control Plane (`sendReliable`):** Raw WebSockets (`ws`) with `socket.setNoDelay(true)` (`TCP_NODELAY`) and `perMessageDeflate: false`. Room joins, team assignment (`teamId`), view subscriptions (`holistic` vs. `team-N`), pre-flight checks, game switching, and scoreboards. Fastify **relays** these messages. It does not interpret game rules. Clock sync is Stretch 1.
   * **Data Plane (`sendFastInput`):** The peer is the **host Chrome tab**, not Node. Native WebRTC DataChannels (`{ ordered: false, maxRetransmits: 0, negotiated: true, id: 0 }`, `iceServers: []`) carry pre-allocated 8-byte `ArrayBuffer` packets from Day 1. Day 1 also injects the host LAN IPv4 into the SDP so iOS/Chrome mDNS (`.local`) cannot hide the only usable candidate.
   * **Backpressure vs. connect timeout:** Before `dc.send(scratchBuffer)`, `if (dc.bufferedAmount > 64) return;` drops a stale packet. If the DataChannel is not open within **3 seconds**, route `sendFastInput` over binary `ws`. Do not send the same packet on both the DataChannel and the binary WebSocket at the same time. Do not use 500ms as the connect timeout. ICE and DTLS on a LAN often take longer than that, and a short timer would force healthy phones onto TCP.
2. **Seam 2 — One authoritative simulation, read-only viewports (`GameSimulation`):**
   * Pre-allocate a flat **Struct-of-Arrays** `Float32Array` for `MAX_PLAYERS = 8`.
   * **v1:** run **one** sim in the primary host Chrome `/screen` tab. Other `/screen` tabs do not step physics and do not own DataChannels. They render snapshots delivered on a `BroadcastChannel`. A dropped phone zeroes that slot's input until its `localStorage` session token reconnects. The slot is not auto-eliminated.
   * **Stretch 2:** move the sim and the DataChannels into one `SharedWorker`. Viewports read a triple-buffered `SharedArrayBuffer` and apply Mach-clock interpolation ($\alpha = \frac{T_{\text{now}} - T_{\text{lastTick}}}{\Delta t_{\text{tick}}}$). Do not build that pipeline in v1.
   * **Inputs:** humans and later bots both call `applyInput(playerIndex, buttons, axisX, axisY)`. v1 has **human players only**. No heuristic bot and no ONNX bot. v1.1 may add a heuristic that uses the same function. Stretch 4 adds ONNX.
   * **Strict Binary View Enforcement (`GameViewConfig`):** Every game (or distinct game mode) is strictly either single-monitor (`holistic`) or multi-monitor (`team-exclusive`)—no ambiguous hybrid fallbacks. If a game offers both single-screen Co-op and multi-screen Versus, register them as two separate game modes/manifests.
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
     ```
     * **When `mode === 'holistic'`:** Requires `/screen?view=holistic`. Any open `team-N` monitor tabs automatically render a clean standby screen (`STANDBY — THIS GAME USES HOLISTIC VIEW`).
     * **When `mode === 'team-exclusive'`:** The Lobby **Start Game** trigger is **hard-locked** until every required `team-1..N` viewport is actively connected and heartbeating. If `allowHolisticSpectator === false`, any `/holistic` tab stays on a standby screen to guarantee zero accidental screen-peeking.
   * Both human phone controllers and local AI bots call the exact same `applyInput(playerIndex, ...)` interface.

---

### 4. Design System Spec: "Industrial Neo-Brutalism"
* **Core Aesthetic:** Teenage Engineering / Panic Playdate tactile hardware fused with Neo-Brutalism. Dynamic CSS variables morph the theme per game (**Claymorphism/Retro Arcade** for party games; **Sci-Fi HUD/NASAPunk** for tactical games).
* **Strict Anti-Slop Ban List:**
  * NEVER use `backdrop-filter: blur()` or translucent glassmorphism cards.
  * NEVER use blurry drop shadows (`shadow-lg`, `shadow-xl`).
  * NEVER use purple/indigo/blue linear gradients or `bg-slate-900` SaaS dark-mode clichés.
  * NEVER use `Inter` or default system sans-serif for headers or numeric telemetry.
* **Zero-Blur Tactile Physics:**
  * Borders: Solid `2.5px solid #111111` on all interactive surfaces.
  * Unpressed Depth: `box-shadow: 0px 6px 0px #111111` + `inset 0px 2px 0px rgba(255,255,255,0.35)`.
  * Pressed Depth (`[data-pressed="true"]`): `transform: translate3d(0, 6px, 0)` + `box-shadow: 0px 0px 0px #111111` (`transition: transform 35ms cubic-bezier(0.2, 0, 0, 1)`).
* **Typography:** `'Space Grotesk'` or `'Chakra Petch'` (uppercase, `font-weight: 800`, tight tracking) for display headers + `'JetBrains Mono'` with `font-variant-numeric: tabular-nums` for timers, room codes, monitor view badges, and telemetry.
* **Global Yellow App Theme & Player Color Variables (`shared/src/ui/theme.css` + `shared/src/theme.ts`):** Define global `:root` tokens anchored on the `HOLISTIC VIEW` badge (`--ink: #111111`, `--paper: #F4F1EA`, `--theme-yellow: #F5C518`, `--theme-yellow-bright: #FFE14D`, `--theme-yellow-warm: #E5A800`, `--theme-yellow-deep: #C88A00`, plus semantic aliases `--accent`, `--accent-hazard`, `--accent-dash`, `--accent-spark`, `--warn`). Define per-slot player variables `--player-1`..`--player-8` (synced 1-to-1 with `PLAYER_COLORS`) and high-contrast ink tokens `--player-1-ink`..`--player-8-ink` (`#111111` or `#F4F1EA`). Player-scoped surfaces bind `--player-color` and `--player-ink` via `playerStyleVars(slot, fallbackColor?)`, and shared primitives consume `var(--player-color, var(--accent))` and `var(--player-ink, var(--ink))`. System chrome, lobby `START`, pre-join `JOIN`, and Pre-Flight warning pills stay on `--accent` / `--warn`. Canvas renderers resolve yellow tokens via `readYellowTheme()` / `getComputedStyle`.
* **6 Custom Primitives Only (`/shared/ui`):** `<ArcadeButton/>`, `<VirtualJoystick/>`, `<SwipeZone/>`, `<PlayerBadge/>`, `<GameCard/>`, and `<HudModal/>`.

---

### 5. Mobile Browser, Network/RF, HFT-Grade Memory & Multi-Monitor Optimizations

| Optimization Category | Specific Implementation Details | Target Phase |
| :--- | :--- | :--- |
| **Day-1 WebRTC peer in the host Chrome tab + raw `ws` fallback** | Raw `ws` for signaling. DataChannel (`ordered: false, maxRetransmits: 0, negotiated: true, id: 0`) with 8-byte packets. Peer is the host `/screen` tab. Inject LAN IPv4 into SDP. Drop a send when `dc.bufferedAmount > 64`. Fall back to binary `ws` if the channel is not open within 3s. | **Day 1 (Base v1)** |
| **30Hz Low-Power Mode Detector & Pre-Flight Status Strip** | On QR scan (while typing name), run a silent 300ms probe measuring 10 consecutive `requestAnimationFrame` deltas ($\ge 31\text{ms}$ detects iOS Low Power Mode / Android Battery Saver), `navigator.hardwareConcurrency`, and initial RTT/jitter. Display a non-blocking 3-pill Pre-Flight Strip (`[POWER]`, `[WI-FI]`, `[ORIENTATION]`) warning users to disable Low Power Mode for 2x smoother response, without ever hard-blocking them from joining. | **Day 1 (Base v1)** |
| **Zero-Allocation Hot Path (Weak Phone GC Defense)** | Pre-allocate a single module-level scratch `ArrayBuffer(8)` and `DataView` on startup. Mutate bytes in-place inside `pointermove` before firing `sendFastInput(scratchBuffer)`. **Zero heap allocations during gameplay** to prevent 25–60ms GC stalls on old Android/iPhone CPUs. | **Day 1 (Base v1)** |
| **Event-Driven ULP Controller Mode (Thermal Defense)** | **Zero continuous `requestAnimationFrame` loops on the phone.** Controller UI only repaints when a finger moves or button state changes, keeping idle GPU load at 0% so old phones don't overheat and throttle CPU/Wi-Fi clocks. | **Day 1 (Base v1)** |
| **Direct DOM & CSS Compositor Isolation** | Fire network packet inside native `pointermove` *before* touching UI. Apply `contain: layout paint style` on controller root and `will-change: transform` on joystick/button caps so the mobile GPU rasterizes bitmaps once and slides them via hardware matrices (`translate3d`). | **Day 1 (Base v1)** |
| **iOS Screen-Edge Gesture Safe Zone** | Keep all interactive controls **$\ge 36\text{px}$ away** from screen edges to avoid iOS WebKit's 100–150ms system-gesture interception freeze. Always lock tracking with `element.setPointerCapture(e.pointerId)`. | **Day 1 (Base v1)** |
| **Viewport, WakeLock & Haptics** | Apply CSS `touch-action: none`, `user-select: none`, `overscroll-behavior: none` + `{ passive: true }` JS listeners. Request `navigator.wakeLock.request('screen')`, add `"display": "standalone"` manifest, and use `navigator.vibrate()` + iOS 18 `<input type="checkbox" switch>` Taptic Engine trick. | **Day 1 (Base v1)** |
| **macOS Multi-Tab Anti-Throttling (`App Nap` Defense)** | Acquire a permanent Web Lock (`navigator.locks.request`) and run a silent Web Audio oscillator node inside every `/screen` monitor tab so macOS and Chromium never throttle unfocused full-screen team monitors. | **Day 1 (Base v1)** |
| **mDNS Bypass & RFC1918 Candidate Pruning** | Inject the Host Mac's LAN IPv4 (`192.168.x.x`) into the SDP offer, and strip non-LAN cellular/IPv6 ICE candidates. Required for Day-1 LAN connects. | **Day 1 (Base v1)** |
| **TDMA-Style Wi-Fi Phase Staggering & Anti-PSM Keep-Alive** | Transmit a 4-byte heartbeat at 20–30Hz so iOS/Android never drop the Wi-Fi radio into 802.11 Power Save Mode. Use NTP clock offset $\theta$ to assign each player slot `P0..P7` a deterministic transmit phase offset (`slotIndex * 2.0ms`) within each 16.6ms window, preventing 8-phone CSMA/CA "Wi-Fi Incast" RF collisions. | **Stretch 1** |
| **Sub-Frame Touch, Kalman Prediction & Adaptive 30Hz Tiering** | Read `e.getCoalescedEvents()` and `e.getPredictedEvents()`. Cap weak or Low-Power-Mode phones to a steady **30Hz**. v1 only **warns** in the pre-flight strip. It does not cap the send rate. | **Stretch 1** |
| **`SharedWorker` + triple-buffered `SharedArrayBuffer` + DisplayLink delay** | Move the sim and the DataChannels into one SharedWorker. Viewports read a 128-byte-aligned triple buffer with Mach-clock interpolation, plus a `+0..35ms` render delay for a DisplayLink monitor beside a native port. v1 uses `BroadcastChannel` instead. | **Stretch 2** |
| **128-Byte Cache-Line Padding (Apple M4 False-Sharing Defense)** | Apple Silicon (M4) uses **128-byte L1/L2 hardware cache lines**. Align all independent worker write-heads (`networkHead`, `physicsTail`, `activeReadBufferIndex`, and per-viewport telemetry slots) to **128-byte boundaries (`offset % 128 === 0`)** inside `SharedArrayBuffer` so concurrent worker cores never invalidate each other's L1 cache lines. | **Stretch 2** |
| **ARM64 `Acquire` / `Release` Memory Ordering (No `SeqCst` Fence Overhead)** | In the Rust WASM ring-buffer/physics core, replace default Sequentially Consistent (`SeqCst`) atomic fences with `Ordering::Release` (when the physics worker publishes a frame) and `Ordering::Acquire` (when monitor tabs read state), compiling down to lightweight ARM64 `LDAR`/`STLR` instructions on the M4. | **Stretch 2** |
| **Genre-Aware Input Buffering + Deterministic Binary Flight Recorder** | Support per-game `inputBufferMode` (`zero-buffer` for twitch games vs. `adaptive-1tick` 4–8ms playhead buffer for rhythm-sync games). Allocate a 5MB circular ring buffer logging every raw 8-byte input packet + tick stamp (~10 mins of 8P 60Hz play in ~2.3MB) for instant slow-mo "Last 30s Replay" and deterministic debugging. | **Stretch 3** |

---

### 6. Phased Implementation & Systems Stretch Roadmap

| Phase | Milestone | Core Systems / Engineering Focus |
| :--- | :--- | :--- |
| **v1 (Base)** | **Playable shell + `sumo-dash` (humans only)** | QR lobby and pre-flight strip (warn only). 8-slot registry with `localStorage` reconnect. Host Chrome tab runs the `Float32Array` sim and is the WebRTC peer (LAN IPv4 in SDP, 3s binary-`ws` fallback). Fastify serves files and relays signaling. Strict `/screen` router (`holistic` vs `team-exclusive`). Other monitor tabs render `BroadcastChannel` snapshots. SolidJS controller switcher. Zero-allocation `pointermove` path. No bots, no SharedArrayBuffer, no flight recorder, no `Tab` HUD. |
| **v1.1** | **Heuristic bots** | A game may fill empty slots by calling `applyInput`. `sumo-dash` ships its heuristic policy then. No ONNX mode in the lobby. |
| **Stretch 1** | **RF timing + telemetry HUD** | TDMA `slotIndex * 2ms` stagger, anti-PSM keep-alive, NTP-style clock offset, adaptive 30Hz send cap, and the `Tab` telemetry HUD. The WebRTC peer is already the host tab in v1. |
| **Stretch 2** | **SharedWorker, SAB, WASM physics** | One `SharedWorker` owns the sim and the DataChannels. 120Hz Rust/WASM step writes a **128-byte-aligned** triple-buffered `SharedArrayBuffer` (`Acquire`/`Release`). Viewports interpolate. DisplayLink delay slider. Requires COOP/COEP. |
| **Stretch 3** | **Input buffer modes, flight recorder, replay** | `zero-buffer` vs `adaptive-1tick`, 5MB circular **Binary Flight Recorder**, "Replay last 30s", and optional state-rewind or WGSL compute. |
| **Stretch 4** | **ONNX / WebGPU bots** | Inference worker reads sim state and injects `applyInput` for empty slots. Heuristic bots (v1.1) stay available. |

---

## Part 2: Platform Functionalities & Game Roster Spec (Up to 8 Players)

### 1. Core Platform Functionalities ("The Console OS")
* **Instant QR Room Pairing + Pre-Flight Status Strip:** Monitor displays a 4-letter room code and dynamic QR code. Scanning opens the lobby card in Safari/Chrome with a non-blocking 3-item Pre-Flight Strip (`[POWER: 60/120Hz OK vs. 30Hz Low Power Warning]`, `[WI-FI: Ping/Jitter]`, `[ORIENTATION: Rotate Sideways]`).
* **8-Slot Persistent Player & Team Registry:** Supports 1 to 8 players (assigned high-contrast industrial colors P1–P8: `#FF4D00`, `#00C853`, `#2979FF`, `#E10600`, `#FF2BD6`, `#00B7C2`, `#111111`, `#F4F1EA`; yellow is reserved for the global app theme and game accents, so no human or bot slot uses yellow) and authoritative team assignments (`teamId: 1..4`) that persist across games and support lobby team-switching/auto-balancing. Stores a `sessionToken` in phone `localStorage` so accidental refreshes or locked screens restore the player's exact slot and team mid-game.
* **Strict binary view enforcement (`holistic` vs. `team-exclusive`):**
  * Several Chrome windows may open the same room (`/screen?room=ABCD&view=holistic`, `&view=team-1`, `&view=team-2`). In v1 the primary tab owns the sim. The others render `BroadcastChannel` snapshots. Stretch 2 replaces that fan-out with `SharedArrayBuffer`.
  * Each monitor shows a corner badge (`HOLISTIC VIEW` or `TEAM 1 VIEW`) and reattaches on refresh.
  * **Hard launch lock:** For `team-exclusive` games, **Start Game** stays locked until every required `team-1..N` viewport is connected and heartbeating (`REQUIRED DISPLAYS: [TEAM-1 READY] [TEAM-2 WAITING...]`). A `team-N` tab during a `holistic` game, or a `/holistic` tab when `allowHolisticSpectator === false`, shows the standby screen.
  * The monitor lobby starts the match. Hit-stop, when a game uses it, freezes **rendering** only. The 120Hz sim keeps stepping.
* **Players in v1. Bots later.** v1 slots are human only. A disconnect zeroes that slot's axes and buttons until the phone's `localStorage` token reconnects. v1.1 may fill empty slots with a heuristic bot through `applyInput`. Stretch 4 adds ONNX. The v1 lobby has no Human / Heuristic / ONNX toggle.
* **Automatic controller morphing:** The monitor carousel emits `game:mount`. Fastify relays it. Every phone swaps layout and theme tokens without a reload. The server does not branch on game rules.
* **Pre-flight warning and transport fallback (v1):** The pre-flight strip warns on 30Hz Low Power Mode. It does not block join and it does not cap send rate (that cap is Stretch 1). If the DataChannel is not open within 3s, input uses binary WebSocket.
* **Telemetry HUD and replay are not v1.** The `Tab` HUD is Stretch 1. The flight recorder and "Replay last 30s" are Stretch 3. v1 still carries the 8-byte telemetry header so those later tools have data.

---

### 2. Extensible Game Roster & Module Specifications
> **Reference:** Refer to [`./games-spec/README.md`](./games-spec/README.md) for the active game index, pluggable `GameDefinition` contract, and links to individual game specifications (starting with `sumo-dash` for v1, designed for seamless extension to additional games and genres).

---

## Part 3: Telemetry, Metrics & Observability Architecture

Measure lag from the packet, not from guesswork. The **8-byte input header is Day 1**. The on-screen `Tab` HUD is Stretch 1. Shared-memory telemetry slots are Stretch 2. The flight recorder is Stretch 3.

### 1. The End-to-End Latency Breakdown (The 6 Spans to Measure)

Every controller action crosses the same stages from thumb to pixels. v1 stamps the phone fields in the 8-byte header. Stretch 2 adds viewport timestamps in shared memory. The stages separate a slow phone, Wi-Fi, the host sim, GPU time, and skew between monitors:

$$\text{Total Motion-to-Photon} = T_{\text{touch}} + T_{\text{js}} + T_{\text{net}} + T_{\text{sim}} + T_{\text{render}} + \Delta_{\text{view}}$$

| Metric Name | Formula / How to Capture It | Healthy Target | What a Spike Means |
| :--- | :--- | :--- | :--- |
| **1. Browser Input Lag ($T_{\text{touch}}$)** | `performance.now() - event.timeStamp` *(measured inside `pointermove` on the phone)* | **$< 4\text{ms}$** (Flagship)<br>**$< 12\text{ms}$** (Old Phone) | The phone's main thread is blocked by layout, GC pauses, 30Hz Low Power Mode throttling, or iOS edge-gesture interception. |
| **2. Phone Serialization ($T_{\text{js}}$)** | `t_channel_send - t_handler_entry` | **$< 0.3\text{ms}$** | The handler is doing unnecessary DOM/state work before firing the packet. |
| **3. One-Way Network Transit ($T_{\text{net}}$)** | `host_recv_time - (phone_send_time + clock_offset)` | **$< 4\text{ms}$** (Direct UDP)<br>**p99 $< 15\text{ms}$** | Wi-Fi radio sleeping (PSM), Apple `awdl0` channel hopping, 2.4GHz Bluetooth interference, or 8-phone CSMA/CA incast collision. |
| **4. Input-to-Tick QueueWait ($T_{\text{sim}}$)** | `physics_step_start - host_recv_time` | **$< 8.3\text{ms}$** (at 120Hz) | Host physics worker is falling behind or inputs are arriving just after a tick boundary. |
| **5. Per-Monitor Tick-to-VSync ($T_{\text{render}}$)** | `requestAnimationFrame_timestamp - physics_step_end` *(tracked independently per open monitor viewport)* | **$< 8.3\text{ms}$** (at 120Hz)<br>**$< 16.6\text{ms}$** (at 60Hz) | Three.js/Phaser shader/draw-call bottleneck or DisplayLink USB bandwidth contention across multiple external monitors. |
| **6. Inter-Viewport Sync Skew ($\Delta_{\text{view}}$)** | `max(viewport_rAF_time) - min(viewport_rAF_time)` & `max(renderedTick) - min(renderedTick)` across open `/screen` tabs | **0 ticks** delta<br>**$< 8\text{ms}$** clock skew | One monitor tab is background-throttled by macOS App Nap, occluded by another window, or lagging on a 4K DisplayLink USB port. |

---

### 2. Core Network, Device & Viewport Health Metrics

Track these operational metrics in a sliding **300-sample circular buffer** per player slot (P1–P8) and per active monitor viewport (`holistic`, `team-1`, `team-2`) on the Host Mac:

* **p50 / p95 / p99 RTT & Inter-Arrival Jitter (RFC 3550):** Average ping hides spikes. A phone with a **4ms average ping** but a **90ms p99 ping** will feel unresponsive. Track `p99` and instantaneous jitter ($J = J + \frac{|D(i-1, i)| - J}{16}$).
* **Sequence Gap, Out-of-Order & Backpressure Drop Counters:** Attach a monotonically increasing `Uint16` sequence number (`seq`) to every `sendFastInput` packet. Track network drops (`seq` gaps), out-of-order UDP arrivals (`seq < lastSeq`, discarded immediately), and user-space backpressure drops (`dc.bufferedAmount > 64`).
* **Transport Mode Indicator (`UDP-DIRECT` vs. `WS-FALLBACK`):** Shows whether each phone uses the WebRTC DataChannel or the binary WebSocket fallback (channel not open within 3s).
* **Client Frame-Cadence & Long-Task Probe (`rAF` + `PerformanceObserver`):** Detects 30Hz Low Power Mode throttling (`rAF` delta $\ge 31\text{ms}$) on join and counts main-thread freezes ($> 20\text{ms}$) during gameplay:
  ```typescript
  new PerformanceObserver((list) => {
    // Sends a tiny reliable alert to Host whenever the phone freezes > 20ms
  }).observe({ entryTypes: ['longtask'] });
  ```
* **Clock offset and TDMA phase (Stretch 1):** An NTP-style handshake (`t1..t4`) every 2s feeds one-way transit and `slotIndex * 2.0ms` stagger. v1 stores `phoneTs` in the packet and does not run this handshake.
* **Per-viewport timestamps (Stretch 2):** Each monitor writes rendered `tickId` and `performance.now()` into a 128-byte telemetry slot for the HUD and the DisplayLink `+0..35ms` slider. v1 does not allocate that buffer.

---

### 3. How to Piggyback Telemetry in 4 Bytes (Zero Extra Packets)

Avoid sending separate telemetry JSON events during gameplay. Bake observability directly into the **Day-1 Binary Input Header** (**8 bytes total** per controller tick):

```text
Byte 0..1 : [Uint16] Sequence Number (0..65535)        -> Detects packet loss & out-of-order UDP
Byte 2..3 : [Uint16] Phone Timestamp (ms mod 65536)    -> Computes One-Way Transit + Jitter
Byte 4    : [Uint8]  Input Lag (T_touch in 0.5ms steps)-> Exposes phone browser/GC freezes to Host
Byte 5    : [Uint8]  4 Buttons: Lower nibble (0..3 held), Upper nibble (4..7 toggles) -> Loss-proof input
Byte 6..7 : [Int8x2] Quantized Joystick (X, Y -127..127)-> Game input
```

Because the telemetry metadata rides inside the 8-byte input packet itself, the platform achieves **60Hz real-time observability across all 8 phones** with **zero extra Wi-Fi packets**.

---

### 4. The On-Screen Developer Telemetry HUD (`Tab` Overlay) — Stretch 1

Stretch 1 adds a Neo-Brutalist overlay (`JetBrains Mono` tabular numbers) on the monitor. Stretch 3 fills the flight-recorder field. The target layout is:

```text
VIEWPORTS: HOLISTIC 60fps (DisplayLink) | TEAM-1 120fps (3.1ms Native) | TEAM-2 120fps (3.4ms Native)
VIEWPORT SYNC: TICK DELTA 0 ticks | CLOCK SKEW 1.2ms (OK) | DISPLAYLINK COMP +0ms | FLIGHT REC 1.4MB/5.0MB
-------------------------------------------------------------------------------------------------------------------
P1 [T1] (iPhone 15)  | UDP-DIRECT | Hz: 60 [120Hz rAF]     | Touch: 2.1ms   | Net p50/p99: 2ms/7ms   | Loss: 0.0% | LongTasks: 0
P4 [T2] (Galaxy A50) | UDP-DIRECT | Hz: 30 [ULP/LOW-POWER] | Touch: 14.8ms! | Net p50/p99: 6ms/48ms! | Loss: 0.8% | LongTasks: 4
```

* **Post-Game JSON/CSV & Binary Replay Export:** Provide buttons in the HUD to dump the match's circular ring-buffer telemetry (JSON/CSV) or export the raw 8-byte **Binary Flight Recorder** log (`.bin`) to benchmark "Before vs. After" when tuning Browser-Direct WebRTC, TDMA staggering, DisplayLink vs. native ports, or a dedicated 5GHz Channel 149 AP.