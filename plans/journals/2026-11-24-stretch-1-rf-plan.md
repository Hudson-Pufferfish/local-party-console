---
title: Stretch 1 RF plan
date: 2026-11-24
summary: "Stretch 1 plan is ready for audit: TDMA, heartbeat, NTP, 30Hz cap, and the Tab HUD."
---

# Stretch 1 RF plan

## What happened

Wrote `plans/261124-1040-stretch1-rf-telemetry-hud/` from `SPEC.md` and the Day-1 tree at `b64f758`. Four phases keep disjoint files so this plan can cook beside `plans/261124-1040-v11-heuristic-bots/`.

## Decision

`--yagni` cut Kalman coefficients, flight-recorder export, and SharedArrayBuffer. The HUD prints `—` for those fields. `screen/src/host-loop.ts` and `games/sumo-dash/**` stay with the bots plan. NTP text uses the existing fan-out. Only a 4-byte binary frame needs a relay change.

## Next steps

Audit the plan, then cook `feat/stretch1-rf-telemetry-hud` from `b64f758`. Phase 1 and Phase 4 can run together. Phase 2 and Phase 3 start after the shared tests are green. No application code is in this change.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
