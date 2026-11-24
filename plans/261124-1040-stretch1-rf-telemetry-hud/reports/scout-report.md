# Scout — Stretch 1 starting point

HEAD is `b64f758` on `main`. This report records the seams the plan uses. It is not a spec.

## Already on Day 1

- The input packet is 8 bytes. `phoneTs` is `Uint16` milliseconds mod 65536. `touchLag` is `Uint8` in 0.5ms steps. `shared/src/codec/input-packet.ts` lines 18–36. Do not change this layout.
- `controller/src/send-input.ts` keeps one `ArrayBuffer(8)`. `sendAxes` waits 16.6ms (`send-input.ts` lines 63–66). `sendButton` cancels that wait and sends immediately (`send-input.ts` lines 88–89).
- `classifyPower` returns `low-power` when any rAF delta is `>= 31`. `shared/src/controller/preflight.ts` lines 1–6. The phone probe stops after 10 frames. `controller/src/app.tsx` lines 60–73. The status modal says `SEND STAYS 60HZ` (`app.tsx` line 256).
- `VirtualJoystick` emits one `onAxes(x, y, timeStamp)` per `pointermove`. It does not read coalesced or predicted events. `shared/src/ui/virtual-joystick.tsx` lines 34–45. Sumo uses that same component. `games/sumo-dash/src/controller-view.tsx` line 57. The callback type must stay the same so this plan does not edit `games/sumo-dash`.
- The screen peer decodes 8-byte DataChannel payloads and 9-byte WebSocket frames (slot byte plus 8). `screen/src/peer.ts` lines 39–44 and 130–133. `onPacket` drops `phoneTs` and `touchLag`. The only caller is `screen/src/session.ts` lines 90–93, which calls `loop.accept(...)`.
- `accept` on `screen/src/host-loop.ts` lines 102–120 stores seq, buttons, and axes. It does not read timestamps. Stretch 1 does not change this function.
- `server/src/relay.ts` line 19 sets `BINARY_FRAME = 8`. `handleBinary` (lines 196–203) drops every other length. A 7-byte frame is already asserted as dropped. `server/src/relay.test.ts` lines 172–174.
- Unknown text is fanned out to every other socket in the room. `server/src/relay.ts` lines 155–160. `clock:*` text does not need a new server branch. `net:ping` / `net:pong` already exist and stop after two samples (`controller/src/peer.ts` lines 157–164). That pair is the preflight strip. It is not the NTP handshake.
- Viewport heartbeats are screen-tab liveness. `screen/src/session.ts` lines 423–428. They are not the phone anti-PSM heartbeat.
- JetBrains Mono is already loaded. `screen/src/styles.css` line 3. The badge uses that face. `styles.css` lines 25–39.
- `PlayerSlot` has `index`, `name`, `teamId`, and `connected`. `shared/src/types/game.ts` lines 3–8. There is no device model field.

## Not present

- No `Tab` listener, no telemetry overlay, no NTP offset, no 4-byte heartbeat, no 30Hz send cap.
- `decode` returns a new object. `shared/src/codec/input-packet.ts` lines 28–37. The hot path must not decode a second time.

## Parallel plan

`plans/261124-1040-v11-heuristic-bots/` owns `games/sumo-dash/**`, `screen/src/host-loop.ts`, `screen/src/bot-fill.ts`, `screen/src/register-games.ts`, the `start` / `playAgain` / `createHostLoop` lines in `session.ts`, and the `startEnabled` memo in `app.tsx`. This plan does not edit that folder. The ownership table in `plan.md` is the boundary.
