---
phase: 1
title: "Shared Stretch 1 math"
status: pending
priority: P1
effort: 2h
dependencies: []
---

# Phase 1: Shared Stretch 1 math

## Goal

Add pure functions for clock offset, TDMA delay, the 30Hz tier, the 4-byte heartbeat, and HUD sample math. No sockets and no Solid components in this phase.

## Context

- `specifications/SPEC.md` lines 102–103, 180, and 187–195
- [Scout](./reports/scout-report.md)
- `shared/src/codec/input-packet.ts` lines 18–36 (frozen)
- `shared/src/controller/preflight.ts` lines 1–6 (reuse, do not edit)

## Overview

Priority P1. Status pending. This phase is the contract Phases 2 and 3 import. Phase 4 does not import it.

## Key Insights

- `phoneTs` is already mod 65536. One-way delay needs an unwrap or it lies after 65 seconds.
- The SPEC row title says Kalman. The row body only names `getCoalescedEvents` and `getPredictedEvents`. This phase picks the newest predicted sample. It does not invent filter coefficients.
- `classifyPower` already exists. The tier function calls that result. It does not reimplement the 31ms rule.

## Requirements

- New files only, under `shared/src/stretch1/`.
- Zero heap allocation inside `pickPointerSample`, `phaseWaitMs`, `nextDelayMs`, `ntpOffset`, and `oneWayMs`. Return numbers or an object the caller already holds.
- Little-endian heartbeat, matching the input packet.

## Architecture

```typescript
export const WINDOW_MS = 16.6;
export const PHASE_STEP_MS = 2;
export const CAP_MS = 1000 / 30;
export const HEARTBEAT_MS = 40;
export const HEARTBEAT_MAGIC = 0xa5;

export function ntpOffset(t1: number, t2: number, t3: number, t4: number): number;
export function ntpDelay(t1: number, t2: number, t3: number, t4: number): number;
export function phaseWaitMs(hostNow: number, slot: number): number;
export function nextDelayMs(hostNow: number, slot: number, sinceLastMs: number, minIntervalMs: number): number;
export function tierFor(input: { power: 'ok' | 'low-power'; cores: number }): '60' | '30';
export function sendIntervalMs(tier: '60' | '30'): number;
export function encodeHeartbeat(target: Uint8Array, slot: number, phoneTs: number): void;
export function heartbeatSlot(bytes: Uint8Array): number | null;
export function oneWayMs(hostNow: number, phoneTsMod: number, offsetMs: number): number;
export function nextJitter(previous: number, transitDelta: number): number;
export function percentile(sortedAsc: ArrayLike<number>, count: number, p: number): number;

export interface PointerSample {
  clientX: number;
  clientY: number;
  timeStamp: number;
}
export function pickPointerSample(
  fallback: PointerSample,
  coalesced: ArrayLike<PointerSample>,
  predicted: ArrayLike<PointerSample>,
): PointerSample;
```

Locked formulas:

- `ntpOffset` is `((t2 - t1) + (t3 - t4)) / 2`. `ntpDelay` is `(t4 - t1) - (t3 - t2)`.
- Phase for slot `s` is `(s * 2) ms` inside each `16.6ms` window. Slot `7` lands at `14ms`. `phaseWaitMs` returns the wait until the next matching phase. An exact hit returns `0`.
- `nextDelayMs` returns the larger of `phaseWaitMs(hostNow, slot)` and the remaining min interval. `sinceLastMs >= minIntervalMs` contributes `0`.
- `tierFor` returns `'30'` when `power === 'low-power'` or when `cores` is an integer from 1 to 4. Every other input, including `cores <= 0`, returns `'60'`.
- `sendIntervalMs('60')` is `16.6`. `sendIntervalMs('30')` is `CAP_MS`.
- Heartbeat bytes: `[0xA5, slot, phoneTs lo, phoneTs hi]`. `heartbeatSlot` returns `null` when the magic byte is wrong or the slot is outside `0..7`.
- `oneWayMs` unwraps `phoneTsMod` to the value nearest `hostNow - offsetMs`, then returns `hostNow - (unwrapped + offsetMs)`.
- `nextJitter` is `previous + ((abs(transitDelta) - previous) / 16)`.
- `percentile` uses nearest rank: index `min(count - 1, ceil((p / 100) * count) - 1)` on an ascending buffer. `count <= 0` returns `0`.
- `pickPointerSample` uses the last coalesced sample when the list is non-empty, then replaces it with the last predicted sample when that `timeStamp` is greater or equal. It returns one of the input objects. It does not copy.

## Related Code Files

- Create: `shared/src/stretch1/clock.ts`
- Create: `shared/src/stretch1/tdma.ts`
- Create: `shared/src/stretch1/tier.ts`
- Create: `shared/src/stretch1/heartbeat.ts`
- Create: `shared/src/stretch1/metrics.ts`
- Create: `shared/src/stretch1/samples.ts`
- Create: `shared/src/stretch1/stretch1.test.ts`
- Do not modify: `shared/src/codec/input-packet.ts`, `shared/src/controller/preflight.ts`, `shared/src/ui/**`

## Tests before code

Write `shared/src/stretch1/stretch1.test.ts` first. Run `pnpm --filter @shared test` and confirm these two tests fail because the module is missing. Then implement.

1. `ntp offset, tdma phase, tier, and heartbeat bytes`
   - `ntpOffset(1000, 1010, 1012, 1024)` is `-1`.
   - `ntpDelay(1000, 1010, 1012, 1024)` is `22`.
   - `phaseWaitMs(0, 3)` is `6`.
   - `phaseWaitMs(7, 3)` is within `0.001` of `15.6`.
   - `nextDelayMs(0, 0, 10, 16.6)` is `6.6`.
   - `tierFor({ power: 'low-power', cores: 8 })` is `'30'`.
   - `tierFor({ power: 'ok', cores: 4 })` is `'30'`.
   - `tierFor({ power: 'ok', cores: 8 })` is `'60'`.
   - `tierFor({ power: 'ok', cores: 0 })` is `'60'`.
   - `sendIntervalMs('60')` is `16.6`. `sendIntervalMs('30')` equals `1000 / 30`.
   - `encodeHeartbeat` of slot `3` and `phoneTs` `0x1234` writes `[0xa5, 3, 0x34, 0x12]`.
   - `heartbeatSlot` of those bytes is `3`. `heartbeatSlot` of `[0, 3, 0, 0]` is `null`.
2. `one-way unwrap, jitter, percentile, and pointer sample`
   - `oneWayMs(5000, 4990, 0)` is `10`.
   - `oneWayMs(65636, 65500, 0)` is `136`.
   - `nextJitter(0, 16)` is `1`.
   - `percentile([10, 20, 40], 3, 50)` is `20`. `percentile([10, 20, 40], 3, 99)` is `40`.
   - Given fallback `{ clientX: 1, clientY: 1, timeStamp: 5 }`, coalesced `[{ clientX: 2, clientY: 3, timeStamp: 6 }]`, and predicted `[{ clientX: 9, clientY: 8, timeStamp: 7 }]`, the result is the predicted object (`clientX === 9`).
   - The same fallback with an empty predicted list returns the coalesced object (`clientX === 2`).

Do not add a third test.

## Tasks and steps

1. Add the two failing tests.
2. Implement the functions until `pnpm --filter @shared test` passes.
3. Keep each function free of `new`, array spreads, and closures created per call. Module-level constants are fine.

## Todo

- [ ] Write the two failing tests
- [ ] Implement clock, TDMA, tier, heartbeat, metrics, and sample pick
- [ ] `pnpm --filter @shared test` passes
- [ ] `git diff --name-only` lists only `shared/src/stretch1/`

## Success Criteria

- The two named tests pass.
- No file outside `shared/src/stretch1/` changes in this phase.
- `games/sumo-dash/**` and `screen/src/host-loop.ts` are untouched.

## Risk Assessment

- `16.6` is not a binary fraction. Tests that expect a phase wait use a tolerance of `0.001`.
- If `percentile` rank is implemented off-by-one, test 2 fails on the value `20`. Fix the rank. Do not change the test to match a different definition.

## Security Considerations

- These functions do not read the network. They do not trust a slot from a packet by themselves. Callers check `heartbeatSlot`.

## Verification

```bash
pnpm --filter @shared test
```

## Next Steps

Phase 2 and Phase 3 import this folder. They start after this test command exits 0. Phase 4 does not wait.
