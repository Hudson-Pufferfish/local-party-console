# Plan: Cyber-Citadel Defense (`cyber-citadel`) Implementation

## 1. Overview & Architectural Principles

This plan provides a staged, scalable, and modular roadmap to implement **Cyber-Citadel Defense** (`cyber-citadel`), the 1–8 player cooperative wave defense game specified in [specifications/games-spec/cyber-citadel.md](file:///Users/hudson/Developer/local-party-console/specifications/games-spec/cyber-citadel.md).

### Core Invariants & Best Practices:
1. **Strict Plugin Isolation**: All game-specific simulation, rendering, and heuristic logic resides strictly within `games/cyber-citadel/`. The console OS (`screen/`, `controller/`, `server/`, `shared/`) receives zero hardcoded game branches.
2. **Deterministic Zero-Allocation Hot Path**: The 120 Hz simulation operates over flat TypedArrays (`Float32Array(88)` primary state and `Uint8Array` `auxState` entity pools) with pre-allocated structures and free lists.
3. **Reusable Platform Primitives**:
   - Reuses `shared/src/physics-2d/` for boundary containment and circle collisions.
   - Extracts a generic uniform grid spatial hash into `shared/src/physics-2d/grid-hash.ts` for broadphase entity detection (reusable for future crowd/bullet games).
   - Reuses `<ControllerShell>` with the `stick-diamond` layout and `<HolisticMatchShell>`.
4. **Gradual Staged Delivery**: Follows the exact staged sequence defined in Issue #18 to maintain green CI and incremental testability.

---

## 2. Phased Implementation Roadmap

### Phase 1: Platform Seams & Shared Broadphase (`shared/` + `controller/`)
- **Deliverable 1.1: Spatial Broadphase (`shared/src/physics-2d/grid-hash.ts`)**:
  - Implement zero-allocation 2D spatial hash grid over fixed cell dimensions ($20 \times 20$ units).
  - Add query methods for radius circle checks and line raycasts.
  - Comprehensive unit tests in `shared/src/physics-2d/grid-hash.test.ts`.
- **Deliverable 1.2: Shared `pad:state` Protocol Seam**:
  - Add typed payload `{ slot: number, labels?: string[], disabled?: number, cooldownEndsAt?: number[] }` to `shared/src/types/game-control.ts`.
  - Handle `pad:state` inside `<ControllerShell>` to bind dynamic context labels to Button Y and synchronize cooldown wipes.
- **Deliverable 1.3: Lazy Controller Module Loader**:
  - Refactor `controller/src/register-games.ts` from eager static imports to dynamic `import()` promises, keeping phone initial bundle lean.

---

### Phase 2: Package Scaffold & Memory Layout (`games/cyber-citadel/`)
- **Deliverable 2.1: Package Setup & Constants**:
  - Create `games/cyber-citadel/package.json` and `tsconfig.json`.
  - Define `constants.ts`: header indices, stride layout (10 floats/player), entity pool sizes (160 enemies, 256 projectiles, 24 barricades), and phase enums.
  - Export `CYBER_CITADEL_MANIFEST` in `manifest.ts`.
- **Deliverable 2.2: Buffer Serialization & Memory Tests**:
  - Create `state.ts` providing helper accessors over `Float32Array` and `DataView` over `auxState`.
  - Add unit tests verifying byte offsets, packing/unpacking, and zero garbage collection in state copying.

---

### Phase 3: Core Simulation & Wave 1–2 Drone Swarms
- **Deliverable 3.1: Player Motion & Auto-Fire**:
  - Integrate analog joystick input with boundary containment.
  - Implement forward-heading auto-fire with Core-distance priority and 10% stickiness.
  - Hitscan line tests verifying target acquisition and damage application.
- **Deliverable 3.2: Path Grid & Flow Field**:
  - Implement $40 \times 40$ navigation grid and Core-centric vector flow field.
  - Spawn wave 1–2 drone swarms moving along flow field toward the Core.
  - Core damage application and Core HP depletion tests.
- **Deliverable 3.3: Deterministic Test Suite & Invariant Fuzzing**:
  - Implement seeded deterministic `startMatch(slots, seed?)`.
  - 3,000-tick randomized fuzz test verifying `INV-1` through `INV-8`.

---

### Phase 4: Tactical Abilities (RAIL, DASH, SHIELD, REVIVE/EMP)
- **Deliverable 4.1: Button Actions**:
  - **A (RAIL)**: Piercing beam with 15° priority snap and 2.5s cooldown.
  - **B (DASH)**: Impulse velocity boost with brute spin trigger.
  - **X (SHIELD)**: Barricade deployment (up to 2 per player, 8s duration) blocking flow field cells.
  - **Y (REVIVE / EMP)**: Priority resolution (downed ally in range $\to$ revive; inside Core ring $\to$ EMP join).
- **Deliverable 4.2: Downed State, Bleed-Out & Respawn**:
  - 0 HP transitions to `DOWNED` with 15s bleed-out (5s in solo).
  - 2.5s channel revive by teammate.
  - 8s respawn at Core with 3% Core HP cost (capped at 12%/wave, minimum 1 HP floor).
- **Deliverable 4.3: EMP Charge & Blast**:
  - EMP charging logic requiring $\ge 50\%$ living squad and $\ge 1$ human.
  - EMP discharge clearing drones and stunning brutes.

---

### Phase 5: Advanced Threats, Boss & Scaling (Waves 3–8)
- **Deliverable 5.1: Shielded Brutes**:
  - Brute AI with frontal arc shield deflecting auto-fire.
  - RAIL frontal shield puncture and DASH spin vulnerability.
- **Deliverable 5.2: Dreadnought Boss (Wave 8)**:
  - 3-phase boss FSM (laser sweep $\to$ drone carriers $\to$ Core enrage).
  - Dual-dash weak point coordination mechanic.
- **Deliverable 5.3: Squad Scaling**:
  - Implement weighted squad size formula $W$ dynamically scaling enemy counts and HP pools.

---

### Phase 6: Heuristic AI Teammates (`heuristic.ts`)
- **Deliverable 6.1: Role Planner & Bot Heuristics**:
  - Periodic 1.0s tactical role assignment (guard flank, intercept brute, revive player, join EMP).
  - Bot difficulty scaling (`Easy: 11-20`, `Medium: 30-50`, `Hard: 50-70`).
- **Deliverable 6.2: AWAY Standby Takeover**:
  - Per-slot standby bot activation after 3.0s disconnect.
  - Seamless control handback upon mid-match rejoin.

---

### Phase 7: Procedural Renderer & Visual Polish (`screen-runtime.ts`)
- **Deliverable 7.1: Procedural Phaser 4 Visuals**:
  - Procedural vector rendering for arena, Core, players, barricades, and enemies.
  - Directional player sights, revive channel beams, rail tracer effects, and breach warning glow.
- **Deliverable 7.2: Shell Integration & Verification**:
  - Register game in `screen/src/register-games.ts`.
  - Mount inside `<HolisticMatchShell>`.
  - End-to-end integration verification across phone controllers and host desktop display.
