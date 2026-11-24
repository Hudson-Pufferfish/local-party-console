# Phase 3 progress

Status: acceptance met. Changes are uncommitted. Plan status was not edited. The coordinator checkpoint was not edited.

## Completed

- Fastify HTTP routes `POST /api/rooms` and `GET /api/host`
- `ws` relay on paths that start with `/ws`
- Text fan-out, slotted 9-byte binary forward, and session-token rejoin
- mkcert steps in `server/README.md`
- `certs/*.pem` ignored, `certs/.gitkeep` added

## Red then green

- Change L before the relay existed: fail, `Cannot find module './index.ts'`
- Change L after room create and text fan-out: pass. `game:mount` kept `gameId` `sumo-dash` and `marker` 7
- Change M before join and binary forward: fail, `timed out waiting for room:joined`
- Change M after slot join and 9-byte forward: pass
- Change M2 before token rejoin: fail, second `room:joined.index` was 1
- Change M2 after rejoin: pass. The observer frames had no `sessionToken`

## Checks

- `corepack pnpm --filter @server test`: 1 file, 3 tests passed
- `corepack pnpm --filter @server exec tsc --noEmit`: exit 0
- `start()` with no cert files throws `Refusing to start. Missing certs/dev.pem or certs/dev-key.pem.`
- Raw `GET /api/host` with `Host: 192.168.1.20` returned `{"lanIp":"192.168.1.20",...}`
- The same route without an RFC1918 host returned `lanIp` `10.0.0.72` on this machine
- `server/src` implementation files do not import `games/sumo-dash`, `phaser`, `solid-js`, or `RTCPeerConnection`. The test file names `sumo-dash` only as an opaque payload
- `perMessageDeflate: false`, `maxPayload: 65536`, and `socket.setNoDelay(true)` are set in `server/src/relay.ts`
- `server/package.json` depends on `fastify` and `ws` only

## Review

Inline review only. This dispatch does not allow helper workers. Simplify step skipped: the workspace is not a Git repository. Advice checkpoints were not active (`--tdd --yagni` only).

`room:joined` goes only to the joining socket. `payload` holds `index`, `sessionToken`, and `players`. Other sockets get `room:players` with the public list. The list fields are index, name, color, teamId, and connected.

## Remaining

- Coordinator verifies this evidence.
- No commit. No `git init`.

## Non-blocking suggestions

- The screen should clear `lastSeq` from `room:players` when a slot becomes connected again. `room:joined` is private to the phone and includes the token.
- `server/src/player-slot.ts` is unused by the relay. It remains from the earlier typecheck probe.
