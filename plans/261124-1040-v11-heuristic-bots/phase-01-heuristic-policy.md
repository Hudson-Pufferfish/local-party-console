---
phase: 1
title: "Heuristic policy"
status: todo
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Heuristic policy

## Goal

Add the `sumo-dash` steer and dash policy, and turn `supportsBots` on. The host does not call it yet.

## Context

- `specifications/games-spec/sumo-dash.md` lines 15–35 and 102–106, and the safety test at line 253
- `specifications/games-spec/sumo-dash.md` lines 164–178 (state layout, `IS_BOT`)
- `games/sumo-dash/src/simulation.ts` `applyInput` (axes are `axis / 127`)
- `games/sumo-dash/src/manifest.ts` and `manifest.test.ts`
- Base commit `b64f758`

## Overview

Priority P1. Status todo. This phase is a pure function plus the manifest flag. It does not import the screen, the server, or Phaser.

## Key Insights

- `applyInput` stores `axis / 127` and ignores a magnitude below `0.12`. The policy writes Int8 axes in `-127..127`, the same scale as a phone packet.
- `step` stays a pure function of stored input. The policy does not run inside `step`. That keeps `INV-6` and `INV-7`.
- `flags` bit 2 is `IS_BOT`. `placeSpawn` assigns `flags = ALIVE` and would clear that bit. This phase leaves `IS_BOT` at 0. The host tracks bot slots in its own mask in Phase 2.
- There is no `heuristic.ts` on `b64f758`.

## Requirements

- `SUMO_DASH_MANIFEST.supportsBots` is `true`.
- `writeHeuristic` implements the three rules in `sumo-dash.md` lines 104–106.
- The function writes into caller-owned typed arrays. A call allocates nothing.
- One new Vitest covers the safety vector. The existing manifest test changes its `supportsBots` expectation from `false` to `true`.
- Scenario 15 of the lobby test matrix in `plan.md` stays in this phase. `supportsBots` becomes `true`. The safety vector stays in `heuristic.test.ts`.

## Architecture

Layout matches the spec. Header `arenaRadius` is index `3`. Player `i` starts at `8 + i * 10`. `x`, `y`, `vx`, `vy` are `+0..+3`. `flags` is `+8`. Bit 0 is `ALIVE` (`1`).

```typescript
export function writeHeuristic(
  state: Float32Array,
  botIndex: number,
  axisX: Int8Array,
  axisY: Int8Array,
  buttons: Uint8Array,
): void
```

Module-level numbers, not objects inside the function:

| Name | Value | Rule |
|---|---|---|
| `HOME_RADIUS` | `0.72` | Steer to `(0, 0)` when the center is outside this fraction of `arenaRadius` |
| `PREDICT` | `0.15` | Aim point is `p + 0.15 * v` |
| `DASH_RANGE` | `180` | Dash range to the predicted point |
| `ALIGN` | `0.88` | Dot of the steer unit and the unit toward the predicted point |
| `DASH_LIMIT` | `0.85` | A dash is allowed only when the projected center stays inside this fraction of `arenaRadius` |
| Travel | `dashSpeed * dashActive` from `SUMO_CONSTANTS` | `920 * 0.18` |

Rules:

1. Ignore a `botIndex` outside `0..7`.
2. If the bot is not `ALIVE`, write axes `0` and buttons `0`.
3. If the center radius is greater than `0.72 * arenaRadius`, the steer target is `(0, 0)`.
4. Otherwise steer toward the nearest alive opponent. Nearest means the smallest distance between centers. The same distance keeps the lower slot index. The aim point is that puck's `p + 0.15 * v`.
5. If no other puck is alive, write axes `0` and buttons `0` when rule 3 did not select the origin.
6. Convert the steer unit to Int8 with `Math.round(unit * 127)`, clamped to `-127..127`. A zero-length steer writes `0, 0`.
7. Dash (bit 0) requires an alive opponent, distance to that predicted point `< 180`, alignment `> 0.88`, and `hypot(x + ux * travel, y + uy * travel) <= 0.85 * arenaRadius`. Otherwise bit 0 is `0`. Other button bits stay `0`.

`ux, uy` is the steer unit from rules 3–6. Alignment uses that unit and the direction to the predicted point. A bot outside `0.72 * R` steers home, so the dash check usually fails. The safety fixture has no opponent, so the dash bit is `0`.

## Related Code Files

- Create: `games/sumo-dash/src/heuristic.ts`
- Create: `games/sumo-dash/src/heuristic.test.ts`
- Modify: `games/sumo-dash/src/manifest.ts` (`supportsBots: true`, comment points at `heuristic.ts`)
- Modify: `games/sumo-dash/src/manifest.test.ts` (expect `true`)
- Modify: `specifications/games-spec/sumo-dash.md` (manifest flag in the sample, and the heading "Deferred — v1.1 Heuristic Bot" becomes "Heuristic bot")
- Modify: `specifications/games-spec/README.md` (the `sumo-dash` status cell and the sentence that says the heuristic is not part of the v1 build)

Do not modify `games/sumo-dash/src/simulation.ts`, `screen/`, `controller/`, `server/`, or `shared/`.

## Implementation Steps

1. Write the failing test in `heuristic.test.ts` before `heuristic.ts` exists. Build one `Float32Array(88)`. Set index `3` to `400`. Set slot `0` to `x = 340` (`0.85 * 400`), `y = 0`, `flags = 1`. Leave every other slot at `0`. Call `writeHeuristic`. Expect `axisX[0] === -127`, `axisY[0] === 0`, and `(buttons[0] & 1) === 0`.
2. Run `corepack pnpm --filter @games/sumo-dash test`. The new test fails because the module is missing.
3. Add `heuristic.ts` with the rules above. Use number locals only. Do not use `new`, array literals, object literals, or closures inside `writeHeuristic`.
4. Re-run the same test command. The new test passes. Existing sim tests stay green.
5. Set `supportsBots: true` and update the one manifest expectation in the same edit.
6. Update the two spec sentences listed above so they match the flag. Do not rewrite physics.

## Todo

- [ ] Failing safety test exists and fails on the missing module
- [ ] `writeHeuristic` matches the three spec rules and allocates nothing
- [ ] Safety test passes with `axisX === -127`, `axisY === 0`, dash bit `0`
- [ ] Manifest flag and spec lines match

## Success Criteria

- `corepack pnpm --filter @games/sumo-dash test` exits 0.
- `corepack pnpm --filter @games/sumo-dash exec tsc --noEmit` exits 0.
- The body of `writeHeuristic` contains no `new`, no array literal, and no object literal. The import of `SUMO_CONSTANTS` may use braces.
- `supportsBots` is `true` in `manifest.ts` and in the spec sample.

## Risk Assessment

- The dash branch has no direct test. The spec names one vector, and the test budget is one new test. A bad dash still has to honor rule 7 in the function. Phase 2 does not add a second policy test.
- Duplicated layout numbers (`8`, `10`, `1`) can drift from `simulation.ts`. If those three values differ, stop and use the simulation values.
- Signal that Assumption N1 broke: two opponents at the same distance and the bot aims at the higher index. Response: keep the lower index. Do not add a new tie-break mode.

## Security Considerations

The function reads the sim buffer and writes caller arrays. It does not read the network and it does not trust a slot index from a packet.

## Stop if

- The safety test stays red after `heuristic.ts` matches the rules above.
- The fix seems to need `simulation.ts`, `controller/src`, or a second new test.
- Do not start Phase 2 until both commands in Success Criteria exit 0.

## Next Steps

Phase 2 imports `writeHeuristic` and calls it from the host loop.
