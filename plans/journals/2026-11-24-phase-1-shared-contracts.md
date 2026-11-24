---
title: Phase 1 shared contracts
date: 2026-11-24
summary: "pnpm workspace and shared codec, view, and transport contracts are green."
---

# Phase 1 shared contracts

## What happened

Phase 1 added the pnpm workspace and the pure shared contracts. The codec, view, and transport tests each failed once because the module was missing, then passed after the implementation. The final shared run is 4 tests. The server typecheck resolves `PlayerSlot` from `@shared/types` and pulls no DOM lib.

## Decision

pnpm 10.34.9 rejects dependency names `@shared`, `@server`, `@screen`, and `@controller`. The package name fields stay as the phase wrote them so `pnpm --filter @shared` still works. The server uses tsconfig `paths` for the type import. Vite is pinned to 8.3.8, inside the `@solidjs/vite-plugin` 3.x peer range.

## Next steps

Leave the tree uncommitted. Phase 2 and Phase 3 are not started. Do not add `"@shared": "workspace:*"` or the install fails.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
