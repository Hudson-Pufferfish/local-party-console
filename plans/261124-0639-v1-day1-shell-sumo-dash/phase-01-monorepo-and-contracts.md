---
phase: 1
title: "Monorepo and shared contracts"
status: done
priority: P1
effort: 4h
dependencies: []
---

# Phase 1: Monorepo and shared contracts

## Goal

Create the workspace and the pure shared contracts the other packages import. No sockets, no canvas, and no Sumo physics in this phase.

## Context

- `specifications/SPEC.md` lines 30, 44–69, and 187–195
- `specifications/games-spec/README.md` lines 26–50
- `specifications/games-spec/sumo-dash.md` line 13
- `AGENTS.md` lines 36–38
- [Stack research](./research/researcher-02-stack.md)

## Overview

Priority P1. Status pending. This phase makes `pnpm -r test` able to run node tests for codecs and policies.

## Key Insights

- The import path `@shared/types` is already fixed by the Sumo spec.
- View policy and transport policy are pure functions. They can be tested before any browser exists.
- Server code must be able to import protocol types without pulling Solid into Node.

## Requirements

- pnpm workspace with `shared`, `server`, `screen`, `controller`, and `games/sumo-dash`.
- TypeScript strict mode. Vitest in `shared`.
- Exports: `GameManifest`, `GameViewConfig`, `GameDefinition`, `PlayerSlot`, `ScreenViewTarget`.
- 8-byte codec, view/start policy, transport route policy, empty `GameRegistry`.

## Architecture

`shared` is a Node-tested library. UI components arrive in Phase 5 under `@shared/ui` and stay out of the server graph.

```typescript
export type ScreenViewTarget = 'holistic' | 'team-1' | 'team-2' | 'team-3' | 'team-4';

export interface PlayerSlot {
  index: number;
  name: string;
  color: string;
  teamId: number | null;
  connected: boolean;
}

export interface GameDefinition {
  manifest: GameManifest;
}
```

`GameViewConfig` matches `games-spec/README.md` lines 27–37. `inputBufferMode` is stored and unread in v1. The sim applies the newest input on the tick it is received.

Player colors, in order P1–P8: `#FF4D00`, `#00C853`, `#F5C518`, `#E10600`, `#FF2BD6`, `#00B7C2`, `#111111`, `#F4F1EA`.

## Files to Create / Modify

- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc` (`22`)
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`
- Create: `shared/src/types/game.ts`
- Create: `shared/src/registry.ts`
- Create: `shared/src/codec/input-packet.ts`
- Create: `shared/src/codec/input-packet.test.ts`
- Create: `shared/src/view/policy.ts`
- Create: `shared/src/view/policy.test.ts`
- Create: `shared/src/transport/policy.ts`
- Create: `shared/src/transport/policy.test.ts`
- Create: `server/package.json`, `screen/package.json`, `controller/package.json`, `games/sumo-dash/package.json` with private package names `@server`, `@screen`, `@controller`, `@games/sumo-dash` and a `test` script that exits 0 until later phases add tests
- Modify: none

## Tests Before

Change A. Write `input-packet.test.ts` first. One test encodes seq `0x1234`, phoneTs `1000`, touchLag `8`, buttons `0x01`, axisX `-10`, axisY `127`. Assert the raw bytes are `34 12 E8 03 08 01 F6 7F`. Decode those bytes back to the same fields. `DataView` calls pass `true` for little-endian.

Change B. Write `policy.test.ts` for the view. One test: `mode: 'holistic'` and view `team-1` returns standby copy `STANDBY // THIS GAME USES HOLISTIC VIEW`. `mode: 'holistic'` and view `holistic` returns no standby copy.

Change C. Write `transport/policy.test.ts`. Two tests:

1. `bufferedAmount: 65` and an open channel returns `'drop'`. `bufferedAmount: 64` returns `'dc'`.
2. A closed channel whose age is `2999` returns `'wait'`. Age `3000` returns `'ws'`.

Land A, then B, then C. Do not add a third test to any of these changes.

## Refactor

1. Root `package.json` is `private`. `packageManager` is an exact `pnpm@10.x.y` that Corepack can fetch. Workspace globs are `shared`, `server`, `screen`, `controller`, `games/*`. Pin `vite` to the peer range declared by `@solidjs/vite-plugin` 3.x. If pnpm blocks install scripts, allow-list the packages that toolchain needs. Do not pin Phaser in this phase.
2. `shared` depends on `typescript` and `vitest` only.
3. Implement the codec so Change A passes. Reject a byte length other than 8.
4. Implement `standbyCopy(view, config)`. v1 Start uses `minPlayers` only. Do not add a team-exclusive heartbeat lock in this phase.
5. Implement `routeFastInput({ channelOpen, channelAgeMs, bufferedAmount })` with the table in Tests Before.
6. `GameRegistry` stores manifests by id. `register` replaces the same id. `list` returns insertion order. `get` returns `undefined` for an unknown id. No test in this phase. Phase 6 tests registration of Sumo.

## Tests After

No further tests. The failing tests above are the contract.

## Implementation Steps

1. Add the workspace files and empty package manifests. `pnpm install` must finish.
2. Land Change A (failing test, then codec).
3. Land Change B (failing tests, then view policy).
4. Land Change C (failing tests, then transport policy).
5. Add `GameRegistry` and the color table in `shared/src/registry.ts`.
6. Confirm `server` can `import type { PlayerSlot } from '@shared/types'` under `pnpm --filter @server exec tsc --noEmit` once its tsconfig exists. If that import pulls a test or a DOM lib, split exports in `shared/package.json`.

## Todo

- [x] Workspace install works
- [x] Change A codec test was red, then green
- [x] Change B view tests were red, then green
- [x] Change C transport tests were red, then green
- [x] Registry and color table exist
- [x] Server typecheck imports `@shared/types` only

## Verification

Regression gate: `pnpm --filter @shared test`

## Success Criteria

- The four shared tests pass (codec, standby, drop, fallback).
- No file under `shared/src` imports `solid-js`, `phaser`, `fastify`, or `ws`.
- `GameViewConfig` matches the spec union, including `inputBufferMode`, and no runtime branch reads that field.

## Risk Assessment

- Solid or Phaser in `shared` would force the server to load a browser package. Keep them out.
- A round trip that hides endianness is not the test. The raw bytes `34 12` for seq `0x1234` are the contract.

## Security Considerations

- The codec does not parse JSON and does not allocate a fresh buffer on encode. `encodeInto(view)` writes the caller's `DataView`.
- Room codes and tokens are not created here.

## Next Steps

Phase 2 uses the codec types only as documentation. It owns the `Float32Array`. Phase 3 imports `PlayerSlot` and the envelope types you should add in `shared/src/types/envelope.ts` during Change C if the transport file needs them. Envelope shape is `{ type: string; roomId: string; payload: unknown }`.
