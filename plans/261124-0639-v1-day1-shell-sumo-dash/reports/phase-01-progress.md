# Phase 1 progress

Status: acceptance met. Changes are uncommitted. Plan status was not edited.

## Completed

- pnpm workspace with `shared`, `server`, `screen`, `controller`, and `games/sumo-dash`
- Shared contracts: types, 8-byte codec, view/start policy, transport route policy, empty `GameRegistry`, P1–P8 colors
- Envelope type `{ type, roomId, payload }` exported from `@shared/types`
- Each behavior test was red, then green: codec, view, transport

## Checks

- `pnpm --filter @shared test` (before codec): fail, `Cannot find module './input-packet'`
- Same command after codec: 1 passed
- Same command after the view test file, before `policy.ts`: fail, `Cannot find module './policy'`; codec still passed
- Same command after view policy: 2 passed
- Same command after the transport test file, before `transport/policy.ts`: fail, `Cannot find module './policy'`; 2 passed
- Same command after transport policy: 3 files, 4 tests passed
- `pnpm --filter @server exec tsc --noEmit --listFiles`: exit 0. Files include `server/src/player-slot.ts`, `shared/src/types/index.ts`, `game.ts`, and `envelope.ts`. Libs are ES2022 only.
- `pnpm -r test`: exit 0. Empty packages exit 0. Shared tests pass again.
- `shared/src` has no import of `solid-js`, `phaser`, `fastify`, or `ws`. `inputBufferMode` appears only on the type and in the view test fixture.

## Tooling correction

pnpm 10.34.9 rejects a dependency named `@shared`, `@server`, `@screen`, or `@controller`. Those strings are not `@scope/name`. The package `name` field can still be `@shared`, and `pnpm --filter @shared` works. Do not add `"@shared": "workspace:*"`. The server resolves `import type { PlayerSlot } from '@shared/types'` with `paths` in `server/tsconfig.json`.

Vite is pinned to `8.3.8`. That version is inside `^8.0.0 || ^9.0.0` from `@solidjs/vite-plugin` 3.0.1. Vitest 5.1.1 allows Vite 8. TypeScript is `7.0.2`. pnpm is `10.34.9`.

Active Node is v24.15.0. `.nvmrc` is `22`.

## Review

Inline review only. This dispatch does not allow helper workers. Simplify step skipped: the workspace is not a Git repository. Advice checkpoints were not active (`--tdd --yagni` only).

Journal: `plans/journals/2026-11-24-phase-1-shared-contracts.md`. AgentWiki publish skipped.

## Remaining

- Coordinator verifies this evidence and starts later phases.
- No commit. No `git init`.

## Non-blocking suggestions

- Phase 3 should keep type imports on the tsconfig `paths` entry. A Node runtime import of `@shared/types` does not resolve through the package name `@shared`.
- `standbyCopy` returns null for `team-exclusive`. This phase does not add the heartbeat lock.
- `GameDefinition` is `{ manifest }` in this phase. Later phases can add the sim, renderer, and controller fields.
- A root README can wait until the shell exists.
