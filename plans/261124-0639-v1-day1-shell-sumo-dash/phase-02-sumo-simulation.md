---
phase: 2
title: "Sumo simulation"
status: todo
priority: P1
effort: 6h
dependencies: [1]
---

# Phase 2: Sumo simulation

## Goal

Ship a deterministic `sumo-dash` simulation that passes the v1 invariant tests. No Phaser, no network, and no bots.

## Context

- `specifications/games-spec/sumo-dash.md` lines 42–114, 150–179, and 232–259
- `AGENTS.md` lines 36–42 and 66
- Phase 1 registry and codec

## Overview

Priority P1. The sim is the hot path. Each change adds one failing test, then the code that makes that test pass.

## Key Insights

- `step(dt)` reads stored inputs only. The host loop is the only place that watches the clock for silence.
- `INV-6` forbids allocation inside `step`. Control JSON is built later, outside `step`, by diffing the header.
- A one-sided 1.75× ram does not conserve momentum. Conservation is required for the non-dash hit. Both rules are specified. Implement both, in the cases named below.
- Low Power send-cap and the v1.1 bot paragraph are not this phase.

## Requirements

Functional rules FR-1 through FR-4 and FR-6. Invariants INV-1 through INV-7. `supportsBots` stays false and flag bit `IS_BOT` stays 0.

## Architecture

State is one `Float32Array` of 88 floats. Layout is `sumo-dash.md` lines 153–176. `flags` bit 0 is `ALIVE`. `aliveMask` is rewritten from those bits every tick.

```typescript
export interface SumoSimulation {
  readonly state: Float32Array;
  applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void;
  step(dt: number): void;
}
```

`applyInput` during `ROUND_END` or `MATCH_OVER` returns without writing. During `COUNTDOWN` it stores aim and updates `angle` only. It does not change `x`, `y`, `vx`, `vy`, or dash timers. During `ROUND_ACTIVE` it stores the latest buttons and normalized axes. Axes are `axis / 127`. Magnitude below `0.12` becomes `(0, 0)`. A dash edge is a real-packet transition of bit 0 from 0 to 1. A held bit at the countdown boundary is not an edge.

Constants live in `games/sumo-dash/src/constants.ts`:

| Name | Value |
|---|---|
| `R0` / `Rmin` | 400 / 110 |
| Shrink | hold `R0` for 5s, then 14 units/s down to `Rmin` |
| `Rspawn` | 240 |
| Puck radius / mass | 28 / 1 |
| `aMove` / `mu` / `vMax` | 1800 / 4.2 / 420 |
| Dash | 920 units/s, active 0.18s, cooldown 1.50s |
| Stun | 0.22s and steering ×0.4 |
| Dash steering | ×0.3 while `dashActiveTimer > 0` |
| Restitution | 0.85 |
| Ram multiplier | 1.75 on the victim when only the attacker is dashing |
| Mutual dash | 1.4× on both, symmetric |
| Hit-stop | 3 frames stored in the header. `step` still runs |
| Scores | first to 5 |
| Timers | countdown 3.0s, round-end banner 2.5s |
| `ANGLE_BLEND_PER_SEC` | 12 |

Tick order inside `ROUND_ACTIVE`:

1. Age `dashCooldown`, `dashActiveTimer`, and `stunTimer` by `dt`. Clamp each to its range.
2. Update `arenaRadius` and `targetRadius` (preview is the radius 3s later, clamped).
3. Integrate each alive puck. Acceleration is `aMove` along the joystick, times the steering factors. Then `v *= exp(-mu * dt)`. Yaw moves toward the stick at `ANGLE_BLEND_PER_SEC` on the shortest signed arc, or holds when the stick is dead.
4. Rising edge of bit 0 while cooldown is 0 and the puck is alive: direction is the stick unit, or facing if the stick is dead. Set the velocity component along that unit to 920. Keep the perpendicular component. Set the two dash timers.
5. If the dash window is closed, clamp speed to `vMax`.
6. Positionally separate overlapping pairs along the normal, then apply the impulse. Zero distance uses normal `(cos(i), sin(i))` for the lower index `i`.
7. A center outside `arenaRadius` clears `ALIVE` and ignores later input until the next countdown.
8. `aliveCount <= 1` moves to `ROUND_END`. One survivor scores +1. Zero survivors is a draw and scores nothing.

`COUNTDOWN` parks joined slots on the spawn ring. Spawn index `i` is the order of joined slots, not the raw slot number. Facing is inward. `ROUND_END` waits 2.5s, then either `MATCH_OVER` or a new `COUNTDOWN`.

`startMatch(slots: number[])` is the host entry. It sets phase to `COUNTDOWN`.

## Files to Create / Modify

- Create: `games/sumo-dash/src/constants.ts`
- Create: `games/sumo-dash/src/simulation.ts`
- Create: `games/sumo-dash/src/simulation.test.ts`
- Create: `games/sumo-dash/vitest.config.ts`
- Modify: `games/sumo-dash/package.json` so `test` runs Vitest
- Do not create a renderer or a controller here

## Tests Before

Each row is its own change. One new test. See it fail. Then extend the sim.

| Change | Test | Assert |
|---|---|---|
| D | Arena radius | After a scripted active round, radius stays inside `[110, 400]` and never increases |
| E | Dash edge | Holding bit 0 for many ticks fires one dash. Cooldown stays inside `[0, 1.5]` |
| F | Draw | Two centers placed outside the ring on the same tick yield `aliveCount === 0`, no score change, phase `ROUND_END` |
| G | Overlap | Two pucks on the same point stay finite (`INV-1`). The same test also places a non-dash head-on pair and expects equal-and-opposite impulses at `e = 0.85`, then a dash-versus-idle pair and expects the victim impulse at 1.75× plus `stunTimer = 0.22` |
| H | Elimination | After ring-out, further `applyInput` leaves `ALIVE` at 0 (`INV-4`) |
| I | Idle phases | `applyInput` during `COUNTDOWN` leaves `x`, `y`, `vx`, and `vy` unchanged and does not start a dash |
| J | Fuzz | Seeded inputs for 8 slots, 10,000 steps, INV-1 through INV-5 every step. The PRNG lives in the test file |
| K | Replay | The same input log run twice compares equal with `Buffer.compare` on the float bytes (`INV-7`) |

Change G is still one test. It contains the NaN check, the non-dash conservation check, and the 1.75× ram check.

Do not add the v1.1 bot test.

## Refactor

1. Preallocate the float buffer and an input array of 8 records once in the constructor.
2. `step` loops slots and pairs with `for`. It does not allocate, slice, map, or close over new functions.
3. `Math.exp` and `Math.cos` / `Math.sin` are allowed. `Math.random` and `Date.now` are not.
4. `hitStopFrames` is set to 3 on a heavy ram and counts down. It does not skip `step`.

## Tests After

No extra tests. `INV-6` evidence in this phase is the stable `state` reference after 10,000 steps, asserted inside Change J. A Chrome allocation profile is Phase 6's checklist, not a second unit test.

## Implementation Steps

1. Add the Vitest script. Write Change D's test and watch it fail. Implement radius plus the phase timers needed for that test.
2. Repeat for E through K in order.
3. Export `SUMO_CONSTANTS` and `createSumoSimulation`.
4. Keep `IS_BOT` at 0 on every path.

## Todo

- [x] Changes D–K each went red before green
- [x] `step` has no `Math.random` and no `Date.now`
- [x] Buffer length is 88
- [x] No bot module exists

## Verification

Regression gate: `pnpm --filter @games/sumo-dash test`

## Success Criteria

- Eight tests pass, one per change.
- A fresh sim's `state.buffer.byteLength` is 352.
- Calling `step` 10,000 times keeps the same `Float32Array` object.

## Risk Assessment

- `ANGLE_BLEND_PER_SEC = 12` is a plan constant in radians per second, shortest arc. The spec requires a smooth heading and does not give the rate. If a playtest feels wrong, change that constant. Dash direction follows the stick when the stick is outside the deadzone.
- Mutual overlap order must be index-sorted so INV-7 holds.

## Security Considerations

- Inputs are numbers already decoded by the host. Clamp slot index to `0..7` and ignore the rest.
- This module does not read the network.

## Next Steps

Phase 6 mounts this module inside the primary tab. The host calls `applyInput` before every `step`. It repeats the last real packet for at most 100ms, then writes zeros. Those zeros do not count as a button release.
