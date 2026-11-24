# Phase 2 progress

Status: acceptance met. Changes are uncommitted. Plan status was not edited.

## Completed

- Deterministic `sumo-dash` sim in `games/sumo-dash/src`
- `SUMO_CONSTANTS` and `createSumoSimulation` (`startMatch`, `applyInput`, `step`)
- State is one `Float32Array` of 88 floats (352 bytes)
- `IS_BOT` stays 0. No bot module. No Phaser, network, or renderer

## Red then green

- D radius: red, missing `./simulation`. Then green.
- E dash edge: red, `fires` was 0. Then green.
- F draw: red, `aliveCount` stayed 2. Then green.
- G overlap: red, velocity stayed at the damped 96.56. Then green.
- H elimination: green on the first run. `applyInput` already ignored a cleared `ALIVE` bit.
- I countdown aim: red, angle stayed at pi. Then green.
- J fuzz: green on the first run. Invariants already held. The same `state` object survived 10,000 steps.
- K replay: green on the first run. The sim has no `Math.random` and no `Date.now`.

## Checks

- `corepack pnpm --filter @games/sumo-dash test`: 1 file, 8 tests passed (about 2.3s)
- `corepack pnpm --filter @games/sumo-dash exec tsc --noEmit`: exit 0
- Probe, not a checked-in test: spawn slots `[2, 5]` sit on the ring and `aliveMask` is 36. The fuzz seed completes 6 rounds and the score sum is 6. A scripted ring-out reaches `MATCH_OVER` at score 5.

## Review

Inline review only. This dispatch does not allow helper workers. Simplify step skipped: the workspace is not a Git repository. Advice checkpoints were not active (`--tdd --yagni` only).

`step` uses index loops. It does not allocate, and it does not call `Math.random` or `Date.now`. Pair resolution walks the lower index first. Dash writes the parallel velocity to 920 and keeps the perpendicular part. A one-sided ram scales only the victim by 1.75 and sets `stunTimer` to 0.22. A mutual dash scales both by 1.4 and sets `hitStopFrames` to 3. `step` still runs during hit-stop.

## Remaining

- Coordinator verifies this evidence. Phase 3 is still waiting on the shared lockfile.
- No commit. No `git init`.

## Non-blocking suggestions

- `shakeIntensity` stays 0. The spec does not give a sim decay. Phase 6 can set it when the renderer shakes the camera.
- Add a package `exports` map when the screen imports this module.
- A Chrome allocation profile remains a Phase 6 check. This phase only asserts the stable `Float32Array` reference.
