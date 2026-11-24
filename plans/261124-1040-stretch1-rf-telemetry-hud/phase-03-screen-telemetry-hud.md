---
phase: 3
title: "Screen telemetry HUD"
status: pending
priority: P1
effort: 4h
dependencies: [1]
---

# Phase 3: Screen telemetry HUD

## Goal

The primary screen tab answers the NTP handshake and shows a `Tab` overlay with per-phone transport, send rate, touch lag, one-way net, jitter, loss, and long-task count. The sim loop does not change.

## Context

- `specifications/SPEC.md` lines 148–181 and 201–213
- [Phase 1](./phase-01-shared-math.md)
- `screen/src/peer.ts` lines 15–44 and 130–133
- `screen/src/session.ts` lines 90–93 and 378–417
- `screen/src/host-loop.ts` lines 102–120 (read only, do not edit)
- `screen/src/app.tsx` lines 76–78
- `shared/src/types/game.ts` lines 3–8
- `screen/src/styles.css` lines 25–39 (match the badge; do not edit the file)

## Overview

Priority P1. Status pending. Depends on Phase 1. May run at the same time as Phase 2 and Phase 4. Do not edit `screen/src/host-loop.ts`.

## Key Insights

- `onPacket` has one caller (`session.ts` line 91). Extend that callback. Keep `accept(slot, seq, buttons, axisX, axisY, now)`.
- A heartbeat must not call `accept`. A heartbeat is not input, and it must not reset the 100ms silence timer inside the host loop.
- Phone rows exist only on the primary tab. The primary owns the DataChannels. A mirror tab does not invent those rows.
- Viewport timestamps, the DisplayLink slider, and the flight recorder are later stretches. The overlay prints those labels and the value `—` or `+0ms`. It does not add buttons.
- `decode` already allocates one object per input packet. Pass the numbers through. Do not decode again in the ingest path.

## Requirements

- Overlay toggles on `Tab` on the screen page. `preventDefault` so the kiosk tab does not move focus. `Escape` closes it.
- Typography is JetBrains Mono with tabular numbers. Border is `2.5px solid #111111`. Background is `#f4f1ea`. No blur, no `shadow-lg`, no gradient, no Inter.
- While the overlay is open, repaint it at 4Hz with `setInterval`. Do not add a permanent `requestAnimationFrame` game loop. A short rAF sample may run only while the overlay is open to show this tab's frames per second.
- Hot path (`onInput`) writes into preallocated rings of 300 samples per slot. `read` may allocate. Call `read` from the 4Hz paint, not from `onmessage`.
- One-way net stays blank until `clock:offset` for that slot is finite.
- Loss uses seq gaps on input packets only. The first seq counts as one received packet and adds no gap. A later packet adds `delta - 1` gaps when `1 < delta <= 32767` and counts as one received packet. Seq `1`, `2`, `4` is therefore 25% loss (`1` gap and `3` received). A backwards seq increments an out-of-order counter and does not move `lastSeq`. Heartbeats do not affect loss.

## Architecture

`screen/src/telemetry/ingest.ts` exports `createIngest()`:

- `onInput(slot, seq, phoneTs, touchLag, hostNow)`
- `onHeartbeat(slot, hostNow)`
- `onOffset(slot, theta)`
- `onTier(slot, tier, lowPower, cores)`
- `onLongTask(slot, n)`
- `setTransport(slot, mode: 'idle' | 'dc' | 'ws')`
- `read(slot)` returns numbers: `hz`, `tier`, `lowPower`, `cores`, `touchMs` (`touchLag * 0.5`), `netP50`, `netP99`, `jitter`, `lossPct`, `longTasks`, `transport`, `hasOffset`

`hz` is the input packets in the last 1000ms of host time. `netP50` / `netP99` come from `percentile` on the one-way ring. `jitter` is `nextJitter` across successive one-way samples. `lossPct` is `100 * gaps / (gaps + received)`.

`screen/src/telemetry/clock-reply.ts` exports `replyClock(payload, hostNow, isPrimary)`. It returns `{ slot, t1, t2, t3 }` or `null`. `t2` and `t3` are both `hostNow`. A non-primary returns `null`. A payload without a finite `t1` or a slot outside `0..7` returns `null`.

`screen/src/peer.ts`:

- `onPacket` gains `phoneTs` and `touchLag`.
- Add `onHeartbeat(slot)`.
- DataChannel `byteLength === 4`: parse with `heartbeatSlot`. On a match, call `onHeartbeat`. Do not call `onPacket`.
- DataChannel `byteLength === 8`: current input path, plus the two extra numbers.
- `handleBinary` `byteLength === 5`: byte 0 is the slot, bytes 1..4 are the heartbeat. Magic must match.
- `handleBinary` `byteLength === 9`: current input path.
- Any other length returns.
- `handleText` accepts `clock:sync` when `isPrimary()` is true, and sends `{ type: 'clock:sample', payload: { slot, t1, t2, t3 } }` through the existing `send` hook.
- `handleText` accepts `clock:offset` and `phone:tier` and `phone:longtask` on every screen tab that receives them. Store them in the ingest. Ignore a bad slot.

`PeerHooks` gains `isPrimary(): boolean`. The only caller is `startSession`.

`screen/src/session.ts` changes are only these:

- Pass `isPrimary: () => primary`.
- `onPacket` calls `ingest.onInput` and then `loop?.accept` with the same argument list `accept` has today.
- `onHeartbeat` calls `ingest.onHeartbeat` and does not call `accept`.
- Forward `clock:sync`, `clock:offset`, `phone:tier`, and `phone:longtask` to `peers.handleText`. Leave `net:ping` as it is.

`screen/src/telemetry/tab-hud.tsx` plus `tab-hud.css`:

- Render beside `<Badge>` from `screen/src/app.tsx`.
- Header line: `VIEWPORTS // THIS: {fps}fps | OTHERS: —`
- Second line: `VIEWPORT SYNC // TICK DELTA: — | CLOCK SKEW: — | DISPLAYLINK COMP: +0ms | FLIGHT REC: —`
- One row per connected player from the existing `players` signal: `P{n} [T{team}] {name} | UDP-DIRECT or WS-FALLBACK | Hz: {hz} [TIER 60] or [ULP/LOW-POWER] | Touch: {ms} | Net p50/p99/J: {a}/{b}/{j}ms | Loss: {%} | LongTasks: {n}`
- `UDP-DIRECT` when transport is `dc`. `WS-FALLBACK` when transport is `ws`.
- Net cells render `—` when `hasOffset` is false.
- Mark touch `>= 12`, net p99 `>= 15`, or loss `> 0` with a solid `#c4371a` color on that cell. No glow.
- A mirror tab (`primary === false`) shows the two header lines and the sentence `PHONE ROWS // PRIMARY TAB`.
- Do not add export buttons. Do not write `SharedArrayBuffer`. Do not change `SNAPSHOT_BYTES`.

## Related Code Files

- Create: `screen/src/telemetry/ingest.ts`
- Create: `screen/src/telemetry/ingest.test.ts`
- Create: `screen/src/telemetry/clock-reply.ts`
- Create: `screen/src/telemetry/tab-hud.tsx`
- Create: `screen/src/telemetry/tab-hud.css`
- Modify: `screen/src/peer.ts`
- Modify: `screen/src/session.ts` (`onPacket`, `onHeartbeat`, and the four forwarded types only)
- Modify: `screen/src/app.tsx` (render `<TabHud>` beside `<Badge>` only)
- Do not modify: `screen/src/host-loop.ts`, `screen/src/lobby.tsx`, `screen/src/styles.css`, `screen/src/bot-fill.ts`, `screen/src/register-games.ts`, `games/sumo-dash/**`, `controller/**`, `server/**`, `shared/src/stretch1/**`
- Do not edit `start`, `playAgain`, the `createHostLoop` call, or the `startEnabled` memo. The bots plan owns those.

## Tests before code

Write `screen/src/telemetry/ingest.test.ts` first. Run `pnpm --filter @screen test`. Confirm this test fails because `createIngest` is missing. Then implement. Do not add a second test.

`three input packets record one seq gap and a 10ms one-way delay`

- `onOffset(0, 0)`
- `onInput(0, 1, 4990, 4, 5000)`
- `onInput(0, 2, 5000, 4, 5010)`
- `onInput(0, 4, 5020, 4, 5030)`
- `onHeartbeat(0, 5040)` does not change the loss
- `read(0).lossPct` is `25`
- `read(0).netP50` is `10`
- `read(0).touchMs` is `2`
- `read(0).hasOffset` is true
- A fresh ingest `read(1).hasOffset` is false and `read(1).netP50` is `null`

`clock-reply.ts` is covered by the same behavior rule: do not add a test file for it. The manual checklist confirms a primary tab answers.

## Tasks and steps

1. Add the failing ingest test.
2. Implement the ring and `read`.
3. Extend `peer.ts` and the two `session.ts` seams. Do not open `host-loop.ts`.
4. Add the overlay and mount it from `app.tsx`.
5. Run `pnpm --filter @screen test`.

## Todo

- [ ] Write the failing ingest test
- [ ] Record input, heartbeat, offset, tier, and long tasks without calling `accept` for heartbeats
- [ ] Primary tab replies to `clock:sync`
- [ ] `Tab` shows and hides the overlay
- [ ] Placeholder fields stay `—` / `+0ms` with no export control
- [ ] `pnpm --filter @screen test` passes
- [ ] `git diff -- screen/src/host-loop.ts` is empty

## Success Criteria

- The named ingest test passes.
- `Tab` on the primary tab shows one row per connected phone after input arrives.
- Net cells stay `—` until `clock:offset`.
- A heartbeat does not move a sumo body and does not change loss.
- `screen/src/host-loop.ts` has no diff.

## Risk Assessment

- v1.1 may also edit `session.ts` and `app.tsx`. Keep the Stretch 1 edits to the `onPacket` / `onHeartbeat` callbacks, the four forwarded message types, and the `<TabHud>` element. Do not reformat the rest of those files.
- If `Tab` is swallowed by the browser, the checklist fails. Keep `preventDefault` on the screen window only.

## Security Considerations

- `clock:offset` changes HUD numbers only. Do not pass `theta` into `accept` or into `applyInput`.
- The relay does not stamp the sender on text frames (`server/src/relay.ts` lines 215–221). A joined phone can lie about another slot's offset. That can skew the HUD. It cannot move the sim. Do not add server auth in this phase.

## Verification

```bash
pnpm --filter @screen test
```

Manual checklist (host Chrome, mkcert LAN URL, one phone):

- [ ] `Tab` shows the overlay. `Tab` again hides it.
- [ ] The flight-recorder cell is `—`. There is no download button.
- [ ] After about 2 seconds the net cells become numbers.
- [ ] The transport cell reads `UDP-DIRECT` when the DataChannel is open.
- [ ] A second screen tab shows `PHONE ROWS // PRIMARY TAB` and does not step physics.
- [ ] Colors stay inside the neo-brutalism ban list (no blur, no purple gradient).

## Next Steps

Phase 4 makes the transport cell able to read `WS-FALLBACK` for an idle heartbeat when the DataChannel never opens.
