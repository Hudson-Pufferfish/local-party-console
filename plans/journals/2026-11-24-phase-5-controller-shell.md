---
title: Phase 5 controller shell
date: 2026-11-24
summary: "SolidJS controller shell joins, warns, and sends 8-byte input."
---

# Phase 5 controller shell

## What happened

Phase 5 added the phone controller. Change P and Change Q were red, then green. `quantizeAxis` clamps a unit axis to int8. `classifyPower` returns `low-power` when any frame delta is at least 31ms.

The shell is SolidJS 2. Six primitives live under `shared/src/ui` and export as `@shared/ui` for the browser only. The phone joins with a stored session token, shows POWER / WI-FI / ORIENTATION, and writes one reused 8-byte buffer. `register-games.ts` has no Sumo entry.

`corepack pnpm --filter @shared test` passed 8 tests. `corepack pnpm --filter @controller exec tsc --noEmit` exited 0. Headless Chrome rendered the shell, accepted the name Ada, showed the portrait warning, and kept JOIN enabled. The Fastify origin was not started because `certs/` has no pem files.

## Decision

The screen does not echo `net:ping`. The relay already fans unknown text out, so this phase did not edit the server. WI-FI stays WAIT until a peer sends `net:pong`.

## Next steps

Phase 6 can register the Sumo controller view. A small screen echo of `net:pong` would fill RTT. A LAN check of the 8-byte frame needs the mkcert certs.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
