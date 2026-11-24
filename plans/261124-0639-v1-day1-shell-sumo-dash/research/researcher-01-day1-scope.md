# Researcher 1 — Day-1 scope from the specs

Authority read in full:

- `specifications/SPEC.md`
- `specifications/games-spec/README.md`
- `specifications/games-spec/sumo-dash.md`
- `AGENTS.md`

## Outcome that v1 must produce

A person opens host Chrome on `/screen`. The page shows a 4-letter room code and a QR code. Up to 8 phones open `/controller` in Safari or Chrome. One sim runs in the primary `/screen` tab. That tab is the WebRTC peer. Fastify serves the apps and relays `ws`. It does not simulate and it does not terminate WebRTC (`SPEC.md` lines 10 and 36–37). `sumo-dash` is the only registered game. It is holistic and zero-buffer. Players are human (`SPEC.md` line 115, `games-spec/README.md` lines 11–13).

## Seams that v1 implements

1. `GameTransport`: `sendReliable` on raw `ws`. `sendFastInput` on a negotiated DataChannel, with binary `ws` if that channel is still closed at 3 seconds. Drop a send when `bufferedAmount > 64` (`SPEC.md` lines 44–47).
2. `GameSimulation`: one `Float32Array` for `MAX_PLAYERS = 8`, stepped only in the primary tab. Other tabs render `BroadcastChannel` snapshots (`SPEC.md` lines 48–51).
3. `GameDefinition`: manifest + simulation + screen renderer + controller view. Shells stay game-agnostic (`games-spec/README.md` lines 19–21).

## Day-1 behavior that is easy to drop and must stay

- Pre-flight strip warns. It does not block join and it does not cap send rate (`SPEC.md` lines 94 and 115).
- Zero heap allocation on `pointermove` send and on `simulation.step` (`SPEC.md` line 95, `AGENTS.md` line 66).
- Phone has no continuous `requestAnimationFrame` loop (`SPEC.md` line 96).
- Controls sit at least 36px from the screen edge. `setPointerCapture` is required (`SPEC.md` line 98).
- Wake Lock, `touch-action: none`, and a standalone manifest (`SPEC.md` line 99).
- Every `/screen` tab holds a Web Lock and a silent Web Audio node (`SPEC.md` line 100).
- LAN IPv4 is written into the SDP. Non-LAN candidates are removed (`SPEC.md` line 101).
- Local HTTPS via Caddy or mkcert. No Cloudflare Tunnel (`SPEC.md` line 22).
- Six primitives only: `ArcadeButton`, `VirtualJoystick`, `SwipeZone`, `PlayerBadge`, `GameCard`, `HudModal` (`SPEC.md` line 85).
- The 8-byte input header exists. The Tab HUD does not (`SPEC.md` lines 187–201).
- Disconnect zeroes that slot's axes and buttons. It does not eliminate the puck (`SPEC.md` line 133, `sumo-dash.md` lines 93–94).

## Removed from this plan (YAGNI)

v1.1 heuristic bots. Stretch 1 HUD, TDMA, NTP handshake, 30Hz send cap. Stretch 2 SharedWorker, SAB, WASM, COOP/COEP. Stretch 3 flight recorder and adaptive buffer. Stretch 4 ONNX. Tauri. DisplayLink delay slider. Extra games.

## Spec contradiction to resolve in the plan

`sumo-dash.md` line 263 says a Low Power phone "auto-caps" to 30Hz. `sumo-dash.md` line 119 and `SPEC.md` lines 94 and 115 say v1 warns and still accepts full-rate input. The plan follows the warning rule.
