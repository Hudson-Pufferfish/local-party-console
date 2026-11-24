---
title: Phase D host apply
date: 2026-11-23
summary: One binary ws frame changes sumo slot velocity on the host.
---

# Phase D host apply

## What happened

Phase D added `screen/src/apply-host-frame.ts`. The failing test was `Cannot find module './apply-host-frame.ts'`. After the module, `corepack pnpm --filter @screen test` passed 1 test. A phone sends one 8-byte codec packet. The relay forwards 9 bytes to the claimed screen. `applyHostFrame` calls `SumoSimulation.applyInput`. One `step` makes slot 0 velocity greater than 0. Slot 1 stays at 0. `corepack pnpm --filter @screen exec tsc --noEmit` exited 0. `corepack pnpm --filter @server test` still passed 3 tests. Server implementation files do not import the sim.

## Decision

The host module lives in `screen/` and calls the sumo sim directly. It does not accept seq, apply silence zeros, or run the 120Hz loop. Those stay in Phase 4. The screen test script is `vitest run` instead of the empty exit-0 script.

## Next steps

Leave the tree uncommitted. The coordinator owns plan status and the checkpoint. Phase 4 can call `applyHostFrame` from `host-loop.ts`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
