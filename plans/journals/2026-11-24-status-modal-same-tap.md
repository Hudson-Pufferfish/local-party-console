---
title: STATUS modal same tap
date: 2026-11-24
summary: STATUS opens on release and CLOSE ignores the opening lift.
---

# STATUS modal same tap

## What happened
Hudson said STATUS pops up and vanishes on one tap. The room code matches the Mac, and typing a name updates the badge. JOIN still had no link feedback when he checked, which is the socket path already changed to show `LINK // DOWN`.

STATUS opened on pointerdown. CLOSE closed on any pointerup. The modal covers the screen, so the same lift could hit CLOSE.

## Decision
Open STATUS on pointerup. CLOSE closes only after a pointerdown on CLOSE. A release that did not start there leaves the modal open.

## Next steps
`corepack pnpm --filter @shared test` passed 9 tests. Headless Chrome kept PRE-FLIGHT open after the opening lift and closed it on a later CLOSE tap.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
