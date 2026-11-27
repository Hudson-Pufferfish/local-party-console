---
title: Tap haptic review fixes
date: 2026-11-27
summary: "CONTROLLER_REV 0.7.0, one Color Clash boost buzz, iOS switch fallback"
---

# Tap haptic review fixes

## What happened
PR #68 review asked for a minor controller revision, a single Color Clash boost buzz, and an iOS Taptic fallback. `CONTROLLER_REV` is now `0.7.0`. `eventsFromHeaderDiff` no longer emits `color:haptic` light when boost becomes active. Shove still emits `heavy` and Golden Tile capture still emits `golden`. `ControllerShell` sends `onButton` before cooldown updates and vibration. When `navigator.vibrate` is missing, the press clicks a hidden `<label>` that wraps a checkbox switch.

## Decision
The boost timer still rises in `games/color-clash/src/simulation.ts`. That file does not emit haptics, so it stayed unchanged. The phone ignores a leftover `light` intensity so it cannot cancel the local 20ms pulse.

## Next steps
`pnpm -r test` and `pnpm typecheck` passed. A phone still needs to confirm `rev=0.7.0`, an iPhone Taptic click, and one buzz on a ready BOOST tap.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
