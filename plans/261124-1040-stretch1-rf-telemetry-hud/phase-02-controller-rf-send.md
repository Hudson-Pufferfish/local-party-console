---
phase: 2
title: "Controller RF send"
status: pending
priority: P1
effort: 3h
dependencies: [1]
---

# Phase 2: Controller RF send

## Goal

The phone staggers its sends by `slot * 2ms`, caps a weak or low-power phone at 30Hz, keeps the Wi-Fi radio awake with a 4-byte heartbeat, and reads coalesced and predicted pointer samples. The 8-byte input layout does not change.

## Context

- `specifications/SPEC.md` lines 102–103 and 180
- [Phase 1](./phase-01-shared-math.md)
- `controller/src/send-input.ts` lines 57–125
- `controller/src/peer.ts` lines 157–210
- `controller/src/app.tsx` lines 60–73 and 256
- `shared/src/ui/virtual-joystick.tsx` lines 34–45
- `games/sumo-dash/src/controller-view.tsx` line 57 (read only)

## Overview

Priority P1. Status pending. Depends on Phase 1. File set is disjoint from Phase 3 and Phase 4.

## Key Insights

- Sumo already renders `VirtualJoystick` and forwards `onAxes`. Change the sample inside the joystick. Do not change the `(x, y, timeStamp)` callback. That keeps `games/sumo-dash` unmodified.
- `sendButton` currently skips the 16.6ms gate. Both axes and buttons must use the tier interval. The dash bit already stays latched until `flushSend` (`send-input.ts` lines 75–80 and 107–110), so a delayed button still delivers one edge.
- The existing `net:ping` pair feeds the preflight strip and then stops. Leave it. NTP is a new `clock:sync` / `clock:sample` exchange every 2 seconds.
- Until the first offset arrives, TDMA uses offset `0` (phone clock). The host hides net numbers until it receives `clock:offset`.
- Default tier is `'60'` so a phone behaves as it does today until the 10-frame probe finishes.

## Requirements

- Heartbeat period is 40ms (25Hz), inside the SPEC 20–30Hz band, on the same slot phase.
- If an input packet was sent less than 40ms ago, skip that heartbeat. Active play must not emit a second stream on top of input.
- Idle play still emits 4-byte frames at 25Hz on the active route only. That route is the DataChannel, or binary `ws` after the 3 second fallback. Do not send the same heartbeat on both. Use `routeFastInput`, including `bufferedAmount > 64`.
- A low-power result or `hardwareConcurrency` of 1..4 sets the input interval to `1000 / 30`. Otherwise the interval stays `16.6`.
- Joining is never blocked.
- No `requestAnimationFrame` loop. The probe that already exists may stay. Heartbeat and NTP use `setTimeout` only.
- Pre-allocate one `Uint8Array(4)` next to the existing 8-byte scratch. Do not allocate inside `sendAxes`, `sendButton`, or `flushHeartbeat`.

## Architecture

`setSendClock({ slot, offsetMs, tier })` stores three numbers in `send-input.ts`.

`flushSend` writes `phoneTs` from `performance.now()` as it does now. The delay before a send is `nextDelayMs(now + offsetMs, slot, now - lastSend, sendIntervalMs(tier))`. A delay of `0` sends now. Any other delay arms one timeout. A second move while a timeout is armed does not allocate another timeout (the current `arm` rule).

`flushHeartbeat(now)` writes the 4-byte buffer with `encodeHeartbeat` and sends it on the current route. It does not advance `seq` and does not change button latch state.

`controller/src/peer.ts` after `markJoined`:

- Store the joined slot and call `setSendClock`.
- Every 2000ms send `{ type: 'clock:sync', payload: { slot, t1 } }` with `t1 = performance.now()`.
- On `{ type: 'clock:sample' }` for this slot, set `t4 = performance.now()`, compute `ntpOffset(t1, t2, t3, t4)`, call `setSendClock` with that offset, then send `{ type: 'clock:offset', payload: { slot, theta } }`. Ignore a sample for another slot.
- Start a heartbeat timeout chain. Each fire calls `flushHeartbeat` only when `now - lastInputAt() >= 40`. Then it schedules `nextDelayMs` again with `HEARTBEAT_MS`.
- After join, `new PerformanceObserver(...)` on `entryTypes: ['longtask']`. For each entry with `duration > 20`, send `{ type: 'phone:longtask', payload: { slot, n: 1 } }`. If the constructor or `observe` throws, leave the count at zero.
- Clear both timers and disconnect the observer in `close`.

`controller/src/app.tsx` calls `setSendClock` when the probe finishes and when the slot is known. Send `{ type: 'phone:tier', payload: { slot, tier, lowPower, cores } }` once those facts exist. Change the modal sentence from `SEND STAYS 60HZ` to `SEND 60HZ` or `SEND 30HZ` to match the tier.

`virtual-joystick.tsx` `onMove` calls `pickPointerSample` with `event`, `event.getCoalescedEvents?.() ?? empty`, and `event.getPredictedEvents?.() ?? empty`. Use a module-level empty array. Convert the chosen `clientX` / `clientY` to the unit axes, then call `onAxes` before the cap transform. `onDown` and `onUp` stay on the root event.

## Related Code Files

- Modify: `controller/src/send-input.ts`
- Modify: `controller/src/peer.ts`
- Modify: `controller/src/app.tsx`
- Modify: `shared/src/ui/virtual-joystick.tsx`
- Do not modify: `shared/src/stretch1/**` (Phase 1 owns it), `games/sumo-dash/**`, `screen/**`, `server/**`
- Do not modify: `shared/src/ui/arcade-button.tsx` or the other four primitives

## Tests before code

No new test file. Phase 1 already locks the math. Do not mock `send-input`.

Before editing the joystick, re-run `pnpm --filter @shared test` and confirm the two Phase 1 tests still pass. If a later edit breaks them, revert the shared test file. Do not add assertions there in this phase.

## Tasks and steps

1. Add `setSendClock`, `lastInputAt`, and `flushHeartbeat` in `send-input.ts`. Route both axes and buttons through `nextDelayMs`.
2. Arm NTP, heartbeat, and the long-task observer from `peer.ts`. Clear them in `close`.
3. Publish the tier from `app.tsx` and fix the modal sentence.
4. Point the joystick at `pickPointerSample` without changing `onAxes`.
5. Run the controller tests. They should stay green. They do not cover the timer.

## Todo

- [ ] Gate axes and buttons on `nextDelayMs`
- [ ] Send the 4-byte heartbeat when input is idle
- [ ] Exchange `clock:sync` / `clock:sample` every 2s and publish `clock:offset`
- [ ] Report long tasks and the power tier on the control socket
- [ ] Read coalesced and predicted samples in the joystick
- [ ] `pnpm --filter @controller test` passes
- [ ] `pnpm --filter @shared test` still passes

## Success Criteria

- An idle joined phone sends 4-byte frames about every 40ms, aligned to `slot * 2ms`.
- A low-power phone does not send 8-byte input faster than `1000 / 30` ms.
- A phone whose probe is `ok` and whose core count is above 4 still uses `16.6` ms.
- `games/sumo-dash/**` has no diff.
- The preflight strip still warns and still lets the player join.

## Risk Assessment

- `getCoalescedEvents()` may allocate inside the browser. Do not copy that array.
- Safari can omit `getPredictedEvents`. The empty list keeps the coalesced sample. That is the intended fallback.
- If a radio check shows that idle-only heartbeats still let the phone sleep during active 30Hz play, send the heartbeat even after a recent input. Record that in the phase report. Do not add a third timer rate.

## Security Considerations

- `clock:sample` is accepted only when `payload.slot` equals this phone's joined slot. A sample for another slot is ignored.
- The offset is a number. Ignore non-finite `t1..t4`.

## Verification

```bash
pnpm --filter @shared test
pnpm --filter @controller test
```

Manual, after Phase 3 and Phase 4 are also on the branch:

- Chrome DevTools on the phone, idle stick: binary length 4, about 25 per second.
- Low-power pill, moving stick: 8-byte frames at least 33ms apart.
- OK pill and 8 cores: 8-byte frames may be about 16ms apart.

## Next Steps

Phase 3 displays the offset and the tier. Phase 4 forwards the 4-byte frame when the DataChannel is down.
