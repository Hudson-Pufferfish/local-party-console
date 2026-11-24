---
title: Phase 4 screen shell
date: 2026-11-23
summary: "SolidJS 2 /screen lobby, LAN QR, and primary host loop."
---

# Phase 4 screen shell

## What happened

Phase 4 added `mungeLanSdp`, `qrTarget`, and the `/screen` SolidJS 2 shell. The first browser load threw `REACTIVE_WRITE_IN_OWNED_SCOPE` because `startSession` wrote signals during the component body. The write moved into a `createEffect` apply callback. Headless Chrome then showed room ENFM and `https://10.0.0.72:8443/controller?room=ENFM`. A team view in the same profile showed `VIEW // TEAM 1` and no standby string. `screenGames` stays empty. Shared tests, screen tests, server tests, and both typechecks passed. The temporary localhost certs were deleted.

## Decision

The host loop does not call `applyHostFrame`. That helper applies one packet and skips seq, silence, and the dash latch. Standby copy runs only after a holistic `game:mount`. Phase 6 registers Sumo.

## Next steps

Leave the tree uncommitted. The coordinator owns plan status and the checkpoint. Phase 5 answers the screen offers.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
