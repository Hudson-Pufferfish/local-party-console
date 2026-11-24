# Phase D progress

Status: acceptance met. Changes are uncommitted. Plan status was not edited. The coordinator checkpoint was not edited.

## Completed

- Host module `screen/src/apply-host-frame.ts` reads one 9-byte frame
- Byte 0 is the slot. Bytes 1–8 go through the Phase 1 codec `decode`
- The module calls `SumoSimulation.applyInput` for that slot
- One node Vitest drives the Phase 3 relay. The phone sends one 8-byte packet. The claimed screen receives 9 bytes. One `step` then shows slot 0 velocity above 0. Slot 1 stays at 0

## Red then green

- Before the module existed: fail, `Cannot find module './apply-host-frame.ts'`
- After `applyHostFrame`: pass. Slot 0 velocity is greater than 0. Slot 1 velocity stays 0

## Checks

- `corepack pnpm --filter @screen test`: 1 file, 1 test passed
- `corepack pnpm --filter @screen exec tsc --noEmit`: exit 0
- `corepack pnpm --filter @server test`: 1 file, 3 tests passed
- `server/src` implementation files do not mention `sumo-dash`, `createSumoSimulation`, or `games/`
- Screen Vitest resolves the relay and the sim by relative path. `@screen` does not depend on `fastify` or `ws`
- `screen/tsconfig.json` maps `@shared/types` the same way `server/tsconfig.json` does. That map exists so `tsc` can follow the test into `server/src/rooms.ts`

## Review

Inline review only. This dispatch does not allow helper workers. Simplify step skipped: the workspace is not a Git repository. Advice checkpoints were not active (`--tdd --yagni` only).

`applyHostFrame` ignores a frame that is not 9 bytes. `decode` reads the packet as little-endian fields, including signed axes. `applyInput` ignores a slot outside 0–7 and a slot that `startMatch` did not join. The test reaches `ACTIVE` before the frame, because a countdown input does not change velocity.

## Remaining

- Coordinator verifies this evidence.
- No commit. No `git init`.

## Non-blocking suggestions

- Phase 4 `host-loop.ts` can call `applyHostFrame`. Seq acceptance, the 100ms silence zero, and the 120Hz accumulator stay in that phase.
- A later game should reach `applyInput` through the registry. This slice calls `SumoSimulation` directly.
- `decode` allocates one packet object per frame. A scratch view can wait until the pointer-move hot path exists.
