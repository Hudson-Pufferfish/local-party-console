---
title: v1.1 heuristic bot plan
date: 2026-11-24
summary: Planned sumo-dash heuristic bots with Stretch 1 file ownership and a labeled lobby-count assumption.
---

# v1.1 heuristic bot plan

## What happened

Wrote `plans/261124-1040-v11-heuristic-bots/` from `SPEC.md` and `sumo-dash.md` on commit `b64f758`. `ak plan validate` passed. No game code changed.

The host already calls `applyInput` from `screen/src/host-loop.ts` for joined slots. `supportsBots` is still false. No heuristic module exists.

## Decision

Phase 1 adds `writeHeuristic` and the `0.85 * R` safety test. Phase 2 adds `screen/src/bot-fill.ts` and one `fillBot` call in the host loop. Assumption L1 fills empty slots only up to `minPlayers`. A disconnected human keeps the slot. `IS_BOT` stays 0. Stretch 1 keeps `controller/src`, the Tab HUD, and NTP/TDMA.

## Next steps

Cook with `/ak:cook /Users/hudson/Developer/local-party-console/plans/261124-1040-v11-heuristic-bots/plan.md --yagni` beside the Stretch 1 plan. Land the bots branch first if both diffs touch `host-loop.ts`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
