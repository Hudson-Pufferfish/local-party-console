---
phase: 5
title: "Controller shell"
status: done
priority: P1
effort: 5h
dependencies: [1, 3]
---

# Phase 5: Controller shell

## Goal

A phone scans the QR code, joins a slot, and sends 8-byte input on the DataChannel or on binary `ws`. The shell shows the six primitives and the pre-flight strip. It does not know Sumo rules.

## Context

- `SPEC.md` lines 14, 37, 85, and 94–99
- `games-spec/README.md` lines 67–70
- `sumo-dash.md` lines 84–91 for the layout that Phase 6 mounts
- Phase 1 codec and transport policy

## Overview

Priority P1. This phase delivers an empty controller that can join, warn, and send a joystick plus one button through a slot map. Phase 6 registers the Sumo layout into that map on `game:mount`.

## Key Insights

- Encode into one module-level `ArrayBuffer(8)` created at startup. `pointermove` writes that buffer and calls `sendFastInput` before it writes the DOM.
- The phone has no continuous `requestAnimationFrame` loop.
- Pre-flight classification is a pure function. The probe that collects samples is browser-only.
- The 30Hz path sets a warning bit. It does not change the send interval.

## Requirements

- `/controller?room=CODE` shows a name field, then joins with `room:join` payload `{ name, sessionToken }`. Read `sessionToken` from `localStorage['party-session-'+room]` when it exists. Store the token from `room:joined`. Also store the last sent `seq` beside that token.
- Pre-flight strip shows three pills: `POWER`, `WI-FI`, `ORIENTATION`. A sample interval `>= 31` marks power as low. Portrait orientation marks orientation as a warning. One `net:ping` / `net:pong` pair fills RTT, and a second sample fills an RFC 3550 jitter estimate. Record `navigator.hardwareConcurrency` on the probe result. The strip does not block the join button.
- Wake Lock `screen` after the first gesture. Manifest `"display": "standalone"`.
- Root CSS: `touch-action: none`, `user-select: none`, `overscroll-behavior: none`. Interactive controls use padding `>= 36px`.
- `setPointerCapture` on pointer down.
- `routeFastInput` from Phase 1 chooses `dc`, `drop`, `wait`, or `ws`.
- The DataChannel is created with the same negotiated options as the screen. The phone waits for `signal:offer`, does not rewrite its answer addresses, and sends `signal:answer`. Ignore a second offer while `signalingState` is not `stable`.
- If the channel is still closed at 3000ms from peer start, further sends use an 8-byte binary `ws` frame.
- Six components exist under `shared/src/ui/` and are exported from `@shared/ui`: `ArcadeButton`, `VirtualJoystick`, `SwipeZone`, `PlayerBadge`, `GameCard`, `HudModal`.
- Pressed style matches `SPEC.md` lines 80–83: translate 6px, shadow cleared, 35ms transition.
- `game:mount` carries `gameId`. The phone loads the controller factory from `controller/src/register-games.ts`. Until that map has the id, the phone stays on the name and pre-flight screen. Theme tokens come from the local manifest, not from the wire. Unknown CSS keys are ignored. Render `name` as a text node.

## Architecture

Pure helpers in `shared/src/controller/`:

```typescript
export function quantizeAxis(unit: number): number
export function classifyPower(deltasMs: number[]): 'ok' | 'low-power'
```

`quantizeAxis` maps `-1..1` to an int `-127..127` and clamps. `classifyPower` returns `low-power` when any delta is `>= 31`, else `ok`. An empty list returns `ok`.

Send path:

- Module-level `scratch = new ArrayBuffer(8)` and one `DataView`. Button bits and axes also live in module fields.
- Module-level `flushSend` function. No per-event closure.
- Each successful send writes a wrapping `Uint16` seq, `phoneTs` (`performance.now() mod 65536`), and touch lag in 0.5ms steps (`performance.now() - event.timeStamp`), then the button mask and axes.
- Joystick `pointermove` updates axis fields. If `now - lastSend < 16.6`, it arms one timeout that calls `flushSend`. Else it sends immediately.
- Button down and button up cancel that timeout and send immediately. A dash press sets `dashEdge` until a send that includes bit 0 actually queues.
- `sendFastInput` checks the policy, then `dc.send(scratch)` or `ws.send(scratch)`. A `'drop'` or `'wait'` returns without a send and leaves `dashEdge` set. The timeout retries the latest fields. The phone sends 8 bytes. It does not prepend a slot.

The 300ms probe collects 10 `requestAnimationFrame` deltas once, during name entry, then stops. That probe is the only `rAF` on the phone.

RTT for the `WI-FI` pill is one `ws` text `{ type: 'net:ping', payload: { t } }` echoed by the peer's own reply `{ type: 'net:pong' }`. The server relays it. The server does not answer it. Add no server code if Phase 3 already relays unknown types. Confirm that `net:ping` is not in the server's "understood" set.

## Files to Create / Modify

- Create: `shared/src/ui/*.tsx` for the six primitives
- Create: `shared/src/controller/quantize.ts`
- Create: `shared/src/controller/quantize.test.ts`
- Create: `shared/src/controller/preflight.ts`
- Create: `shared/src/controller/preflight.test.ts`
- Create: `controller/index.html`, `controller/vite.config.ts`, `controller/src/main.tsx`, `controller/src/app.tsx`, `controller/src/register-games.ts`
- Create: `controller/src/send-input.ts`, `controller/src/peer.ts`, `controller/src/preflight-strip.tsx`
- Create: `controller/public/manifest.webmanifest`
- Modify: `shared/package.json` exports for `@shared/ui` with a browser condition. `server` tsconfig must not include `shared/src/ui`.

## Tests Before

Change P. One test. `quantizeAxis(1)` is `127`, `quantizeAxis(-1)` is `-127`, `quantizeAxis(0)` is `0`, `quantizeAxis(2)` is `127`.

Change Q. One test. `classifyPower([16, 16, 32])` is `low-power`. `classifyPower([16, 16, 16])` is `ok`.

Land each test red, then implement the function.

## Refactor

1. Primitives take colors and labels as props. They do not import Sumo.
2. `VirtualJoystick` reports unit x and y. It does not apply the 0.12 deadzone. The sim does that.
3. `ArcadeButton` sets `data-pressed` and calls `onPressedChange(boolean)`.
4. Keep a single `pointermove` listener path that finishes the socket write before `element.style` or a signal write. Set the signal after `sendFastInput` returns.

## Tests After

No extra tests.

## Implementation Steps

1. Land Change P and Change Q in `shared`.
2. Build the six primitives and the ban-list CSS.
3. Build join, token restore, and the pre-flight strip.
4. Build the peer answerer and `send-input.ts`.
5. Create `register-games.ts` as an empty map. On `game:mount`, render the mapped view when the id exists. Phase 6 adds the Sumo view. Do not ship a second joystick layout in the shell.

## Todo

- [x] Change P red then green
- [x] Change Q red then green
- [x] Scratch buffer is allocated once
- [x] No perpetual `rAF` in `controller/src`
- [x] Edge padding is at least 36px
- [x] Server still has no Sumo import

## Verification

Regression gate: `pnpm --filter @shared test && pnpm --filter @controller exec tsc --noEmit`

## Success Criteria

- Quantize and pre-flight tests pass.
- A joined phone sends 8-byte frames that the Phase 4 host can decode.
- Low Power shows a warning pill and the send path still uses the 16.6ms joystick interval.

## Risk Assessment

- iOS will not grant Wake Lock or a DataChannel until the phone trusts the mkcert root and `isSecureContext` is true. The Mac `mkcert -install` does not do that. Follow `server/README.md`.
- Safari may leave a negotiated channel in `connecting` when the phone is the DTLS server. The host stays the offerer because the spec writes the LAN address into the host offer. The 3s binary `ws` path is the recovery. Do not move the offer to the phone.
- A timeout flush and a button send can interleave on one buffer. Both run on the same thread. `flushSend` and the button send must copy nothing and must finish the `DataView` writes before `send`. Do not await between the writes and `send`.

## Security Considerations

- Session token stays in `localStorage` for that room. Do not put it in the QR code.
- Ignore `game:mount` whose `roomId` does not match the joined room.

## Next Steps

Phase 6 adds the Sumo controller body and the Phaser view. It consumes this send path unchanged.
