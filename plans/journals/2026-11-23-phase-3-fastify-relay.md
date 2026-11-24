---
title: Phase 3 Fastify relay
date: 2026-11-23
summary: The Fastify relay stores slots and forwards text and binary frames.
---

# Phase 3 Fastify relay

## What happened

Phase 3 added the Fastify room relay under `server/`. Change L failed on a missing module, then passed when `game:mount` kept marker 7. Change M failed waiting for `room:joined`, then passed when an 8-byte frame became 9 bytes for the claimed screen only. Change M2 failed because a second join took index 1, then passed when the same session token returned index 0 and the broadcast omitted the token. `corepack pnpm --filter @server test` passed 3 tests. `tsc --noEmit` exited 0. `start()` refuses to run when the mkcert files are missing.

## Decision

The server keeps rooms in memory and does not simulate. `room:joined` goes only to the joining socket. Other sockets receive `room:players` with no session token. A binary frame before `viewport:claim` is dropped. There is no server queue.

## Next steps

Leave the tree uncommitted. The coordinator owns plan status. The screen should clear lastSeq from `room:players` when a slot connects again.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
