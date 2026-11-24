---
title: Phase 2 sumo simulation
date: 2026-11-24
summary: Deterministic sumo-dash sim passes eight Vitest cases.
---

# Phase 2 sumo simulation

## What happened

Phase 2 added the `sumo-dash` simulation under `games/sumo-dash`. Each of D through G and I failed once, then passed after the matching rule landed. H, J, and K were already green because those rules were already in the sim. The gate is `corepack pnpm --filter @games/sumo-dash test`: 8 tests passed. `tsc --noEmit` exits 0.

## Decision

The sim keeps one 88-float buffer and reads stored inputs only. `step` does not allocate, and it does not call `Math.random` or `Date.now`. A one-sided ram scales only the victim. `IS_BOT` stays 0. No renderer, network, or bot module.

## Next steps

Leave the tree uncommitted. The coordinator owns plan status and Phase 3. `shakeIntensity` stays 0 until a later phase defines the camera decay.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
