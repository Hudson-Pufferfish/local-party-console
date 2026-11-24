# Phase 4 progress

Status: done.

## Completed

- Reconciled the coordinator checkpoint. Phase 4 was not started. No continuation handoff.
- Change N: `mungeLanSdp` keeps one host candidate, rewrites a `.local` address to the LAN IP, and drops the other candidates.
- Change O: `qrTarget` builds `https://192.168.1.20:8443/controller?room=ABCD`.
- `/screen` is SolidJS 2. Pins are `solid-js@2.0.3`, `@solidjs/web@2.0.3`, and `@solidjs/vite-plugin@3.0.1`.
- The lobby shows the room code, the LAN QR URL from `GET /api/host`, and `GAMES // NONE` while `screenGames` is empty.
- A holistic tab requests `party-sim-<room>`. A team tab does not. Every tab holds `party-antinap-<room>-<tabId>`.
- The host loop steps only a registered sim on the primary holistic tab. Mirrors copy snapshots and do not call `step`.
- Fastify `start()` mounts the screen and controller Vite apps on the relay origin. `startRelay()` does not load Vite.
- Session startup writes signals from an effect apply callback. A write during the component body throws `REACTIVE_WRITE_IN_OWNED_SCOPE` and leaves `#root` empty.

## Checks

- `corepack pnpm --filter @shared test`: 5 files, 6 tests, exit 0. Change N and Change O are included.
- `corepack pnpm --filter @screen test`: 1 file, 1 test, exit 0.
- `corepack pnpm --filter @screen exec tsc --noEmit`: exit 0 after the effect fix.
- `corepack pnpm --filter @server test`: 1 file, 3 tests, exit 0.
- `corepack pnpm --filter @server exec tsc --noEmit`: exit 0.
- HTTPS smoke on `https://127.0.0.1:8443/screen`: headless Chrome showed room `ENFM`, `VIEW // HOLISTIC`, and `https://10.0.0.72:8443/controller?room=ENFM`. The QR canvas had dark modules. The stylesheet contained `2.5px solid`. Body font was `"Space Grotesk"`. No reactive error.
- Same browser profile, `view=team-1`: `VIEW // TEAM 1`, the same room, and the same LAN URL. No standby string. No token warning.
- Temporary localhost certs were removed after the smoke. `certs/` is `.gitkeep` only. Port 8443 is free.
- Advice was not requested. No cook gate needed a decision.
- Review was inline. This task does not allow subagents.
- Step 3.S was skipped. This folder is not a git repo.
- AgentWiki publish skipped.

## Remaining acceptance

- The standby string `STANDBY // THIS GAME USES HOLISTIC VIEW` is wired to a holistic `game:mount`. This phase cannot send that message. `register-games.ts` has no Sumo entry. Phase 6 registers the game.

## Non-blocking suggestions

- The Space Grotesk package has no weight 800 file. CSS asks for 800 and loads `700.css`.
- `server/README.md` mentions `CERT // HOST NOT IN SAN`. This phase does not inspect the certificate SAN.
- A team-exclusive start lock needs viewport heartbeats from other tabs. The relay stores hello and heartbeat and does not broadcast them. Start stays `canStart(connectedCount, minPlayers)`.
- `applyHostFrame` remains the Phase D helper. The host loop owns seq, silence, and the dash latch.
