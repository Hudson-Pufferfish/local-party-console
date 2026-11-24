---
phase: 3
title: "Fastify relay"
status: todo
priority: P1
effort: 4h
dependencies: [1]
---

# Phase 3: Fastify relay

## Goal

Serve one HTTPS origin and relay room traffic. The process stores slots and viewports. It does not step physics and it does not open a `RTCPeerConnection`.

## Context

- `SPEC.md` lines 22, 36–37, and 126–136
- `sumo-dash.md` lines 138–148
- Phase 1 envelope type

## Overview

Priority P1. Two tests protect the relay. The Sumo event names pass through as opaque `type` strings.

## Key Insights

- "Server → All" in the Sumo table means the relay's fan-out. The primary tab builds `sumo:*` payloads.
- Binary frames are the fallback data plane. They are 8 bytes. The relay forwards them to the claimed screen socket.
- One living-room process may keep rooms in a `Map`. A restart clears them. That matches a local party.

## Requirements

- `POST /api/rooms` returns `{ roomId, hostToken }`. `roomId` is 4 letters from `ABCDEFGHJKLMNPQRSTUVWXYZ`. `hostToken` is 128 random bits, hex. The HTTP response is the only place that token appears.
- `GET /api/host` returns `{ lanIp, port }`. `lanIp` is the address the request used when that address is a LAN IPv4. Otherwise it is the first non-internal IPv4 on the machine. The QR host must be a SAN on the cert. If it is not, `/api/host` still returns the address and the screen shows `CERT // HOST NOT IN SAN`.
- `GET /ws?room=CODE&role=screen|controller` upgrades with the `ws` package. `role=screen` also requires `hostToken`. A wrong token closes the socket. Unknown rooms close the socket.
- Text frames are JSON `{ type, payload }`. The server uses the query room, not a room field inside the JSON. Bad JSON is dropped.
- `game:mount` and `sumo:*` are accepted only from the current primary socket. Other text types fan out to every other socket in the room.
- A controller binary frame is 8 bytes. The server prepends that socket's slot index and sends 9 bytes to the current primary. Any other length is dropped. A socket that has not joined is dropped.
- `viewport:claim` is accepted only from a screen socket that presented `hostToken`. It sets `primarySocket`. A later claim does not steal it. Socket close clears `primarySocket` when the closed socket was primary.
- `room:join` payload is `{ name, sessionToken? }`. `name` is stored as plain text, trimmed, at most 16 characters. The reply `room:joined` goes only to that socket and includes `sessionToken` plus the public player list. The public list has index, name, color, teamId, and connected. It has no token. The same token on a later join returns that slot and marks it connected. A new token when 8 slots exist gets `room:full` and is not added to the binary path.
- Cap concurrent sockets per remote address at 12. Set `ws` `maxPayload` to 65536.
- `socket.setNoDelay(true)` and `perMessageDeflate: false`.
- Listen on `0.0.0.0` and the port in `PORT` (default `8443`) with the mkcert key pair. Refuse to start if the cert files are missing. Generate the files outside the repo or in `certs/` and gitignore `certs/*.pem`. `server/README.md` lists Mac `mkcert` commands and the iOS and Android steps to trust that root. `mkcert -install` on the Mac does not trust the phone.

## Architecture

```text
POST /api/rooms
GET  /api/host
GET  /ws?room&role
```

Platform `type` values the server understands: `room:join`, `viewport:hello`, `viewport:claim`, `viewport:heartbeat`.

`signal:*` from a joined socket is forwarded unchanged. `game:mount` and `sumo:*` are forwarded only when the sender is `primarySocket`. Payloads are not edited.

In-memory maps:

- `rooms`: code → `{ players, tokens, primarySocket, sockets }`
- `tokens` maps the secret to a slot and is not copied into broadcasts
- `views`: tabId → `{ view, at }` from `viewport:hello`. v1 Start does not read this map.

No database and no Redis.

## Files to Create / Modify

- Create: `server/src/index.ts`
- Create: `server/src/rooms.ts`
- Create: `server/src/relay.ts`
- Create: `server/src/relay.test.ts`
- Create: `server/vitest.config.ts`
- Create: `server/README.md` with the mkcert commands
- Create: `certs/.gitkeep` and ignore `certs/*` except the keep file if `.gitignore` does not already ignore keys. `.gitignore` already ignores `*.local`. Name the files `certs/dev.pem` and `certs/dev-key.pem` and add `certs/*.pem` to `.gitignore`.
- Modify: `server/package.json` dependencies `fastify`, `ws`

## Tests Before

Change L. One test. Two `ws` clients join one room. Client A sends `{ type: 'game:mount', roomId, payload: { gameId: 'sumo-dash', marker: 7 } }`. Client B receives the same `marker`. The server process does not import `games/sumo-dash`.

Change M. One test. A screen client presents `hostToken` and sends `viewport:claim`. A joined controller in slot 0 sends an 8-byte frame. The screen receives 9 bytes whose first byte is 0 and whose last 8 match. A second controller does not receive them. An unjoined socket's 8-byte frame is not forwarded. A 7-byte frame is not forwarded.

Change M2. One test. A client joins, the test records `sessionToken` from `room:joined`, the socket closes, a new socket joins with that token, and `room:joined.index` matches the first join. The broadcast player list from the second join has no `sessionToken` field.

Write L, see it fail, implement text relay and room create. Then M. Then M2.

Use port `0` in tests. Do not require the mkcert files for the test listener. Production `start` still requires them.

## Refactor

1. Cap each text message at 64 KiB and each binary message at 8 bytes.
2. On `room:join`, reply to the sender with `room:joined` (includes the token) and notify the room with the public player list.
3. On socket close, set that slot `connected: false`. Do not free the slot. Do not send a Sumo elimination. If the socket was `primarySocket`, set `primarySocket` to null.
4. Upgrade routing belongs to this server. The room relay handles only URL paths that start with `/ws`. Phase 4's Vite HMR must use a different path.
4. Heartbeat records are updated and otherwise ignored by game code.

## Tests After

No extra tests.

## Implementation Steps

1. Add Fastify and `ws`. Attach `WebSocketServer` to `fastify.server` after `listen`, or use `noServer` plus the upgrade event if you must bind before listen. The test must be able to read the bound port.
2. Land Change L, then Change M.
3. Add `/api/host` and `/api/rooms`.
4. Write the mkcert steps in `server/README.md`: `mkcert -install`, then `mkcert -key-file certs/dev-key.pem -cert-file certs/dev.pem localhost 127.0.0.1 <lan-ip>`.
5. Load those files in the HTTPS server for `pnpm --filter @server dev`.

## Todo

- [x] Change L red then green
- [x] Change M red then green
- [x] `perMessageDeflate: false` and `setNoDelay(true)` are set
- [x] Server package does not depend on `@games/sumo-dash`, `phaser`, or `solid-js`
- [x] PEM paths are gitignored

## Verification

Regression gate: `pnpm --filter @server test`

## Success Criteria

- The relay tests for text fan-out, slotted binary forward, and token rejoin pass.
- A text payload survives the round trip with the same `gameId` and `marker`.
- Binary fan-out reaches only the claimed screen.

## Risk Assessment

- If a binary frame arrives before `viewport:claim`, it is dropped. The phone send path retries the latest scratch until a send is accepted. Document that in the server file header. Do not add a server-side queue.
- Detecting LAN IP can pick the wrong NIC. `/api/host` prefers the request Host when it is an RFC1918 address. The screen shows that value.

## Security Considerations

- The room code lets a phone join. The `hostToken` lets a tab claim the sim. Anyone on the LAN who can read the TV can join as a player. That is the product. Guessing a code still takes a socket. Unknown codes close, and each address is capped at 12 sockets.
- Drop malformed JSON. Do not eval payloads.
- Do not log session tokens.
- Do not open the port through a tunnel.

## Next Steps

Phase 4 and Phase 5 speak this protocol. They do not add Sumo knowledge to `server/`.
