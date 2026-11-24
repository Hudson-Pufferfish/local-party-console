---
title: Phone JOIN link down
date: 2026-11-24
summary: JOIN no longer queues forever when the phone socket never opens.
---

# Phone JOIN link down

## What happened
Phone JOIN looked dead. The page loaded over HTTPS and the badge stayed OPEN until a name was typed. The Mac PLAYERS list stayed empty.

Cause 1 matched `controller/src/peer.ts`. `sendText` queued while the socket was closed, and `onLink(false)` ran only on `close`. A socket that never opens never closes, so the phone showed no `LINK // DOWN`.

An open socket already reached the relay. Headless Chrome joined room DHQU as Ada and the screen received `room:players`. An unknown room already showed `LINK // DOWN`, but JOIN stayed enabled. The Solid 2 effect does run, and `pointerdown` does send `room:join`.

The fix reports the link down on error, close, or after 2 seconds unopened. JOIN disables while that notice is up. A connecting socket still queues and flushes on open.

## Decision
Show `LINK // DOWN` and disable JOIN when the socket is down. Keep a join queued only while the socket is still connecting.

## Next steps
Hudson can scan the current QR again. If the phone shows `LINK // DOWN`, that browser does not have a live socket to this room. A fresh scan after the screen room is up should list the player.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
