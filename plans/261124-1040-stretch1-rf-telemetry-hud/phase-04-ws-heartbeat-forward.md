---
phase: 4
title: "WebSocket heartbeat forward"
status: pending
priority: P1
effort: 1h
dependencies: []
---

# Phase 4: WebSocket heartbeat forward

## Goal

When the DataChannel is not open, the Fastify relay forwards a 4-byte phone heartbeat to the primary screen socket with the same slot prefix it already uses for 8-byte input.

## Context

- `specifications/SPEC.md` lines 37 and 102
- `server/src/relay.ts` lines 19 and 196–203
- `server/src/relay.test.ts` lines 160–174
- [Scout](./reports/scout-report.md)

## Overview

Priority P1. Status pending. No dependency on Phase 1. The server does not parse the four bytes. Phase 3 checks the magic on the screen.

## Key Insights

- Text NTP messages already fan out (`relay.ts` lines 155–160). This phase does not add a `clock:sync` branch.
- The existing test sends a 7-byte buffer and expects it to be dropped (`relay.test.ts` lines 172–174). Only length `4` joins length `8`. Length `5`, `6`, `7`, and anything else still drop.
- The screen is not in this phase. A 4-byte frame becomes 5 bytes on the primary socket: `[slot, b0, b1, b2, b3]`.

## Requirements

- A joined controller socket may send a 4-byte binary frame.
- The primary receives 5 bytes. Byte 0 is the sender slot. The other bytes are unchanged.
- An unjoined socket's 4-byte frame is not forwarded.
- Another controller does not receive the frame.
- A 7-byte frame is still not forwarded.
- The 8-byte path stays `[slot, ...8 bytes]`.

## Architecture

```typescript
const INPUT_FRAME = 8;
const HEARTBEAT_FRAME = 4;

function handleBinary(...): void {
  const size = data.length;
  if ((size !== INPUT_FRAME && size !== HEARTBEAT_FRAME) || client.slotIndex === null) return;
  const primary = primaries.get(client.room);
  if (primary === undefined || primary.ws.readyState !== WebSocket.OPEN) return;
  const out = Buffer.alloc(size + 1);
  out[0] = client.slotIndex;
  data.copy(out, 1);
  primary.ws.send(out);
}
```

Reuse the current primary lookup and slot prefix. Do not allocate a second buffer type. Do not JSON-encode the heartbeat.

## Related Code Files

- Modify: `server/src/relay.ts`
- Modify: `server/src/relay.test.ts` (one new test)
- Do not modify: `server/src/rooms.ts`, `server/src/player-slot.ts`, `screen/**`, `controller/**`, `shared/**`, `games/**`

## Tests before code

Add one test to `server/src/relay.test.ts` before changing `handleBinary`. Run `pnpm --filter @server test`. Confirm the new test fails and the existing 8-byte test still passes. Then change the relay. Do not add a second new test.

`a 4-byte heartbeat is prefixed with the slot`

Copy the room, host claim, and two-controller setup from the existing binary test (`relay.test.ts` around lines 140–166).

- Slot 0 sends `Buffer.from([0xa5, 0x00, 0x34, 0x12])`.
- The primary screen receives length `5`, byte 0 is `0`, and bytes 1..4 equal the payload.
- The other controller receives no binary frame.
- Slot 0 then sends `Buffer.from([1, 2, 3, 4, 5, 6, 7])`. After a short settle, the screen has not received that 7-byte payload.

## Tasks and steps

1. Add the failing test.
2. Accept length 4 and length 8 in `handleBinary`.
3. Re-run the server tests. The old 9-byte assertion must still pass.

## Todo

- [ ] Write the failing 4-byte test
- [ ] Forward length 4 with a slot prefix
- [ ] Leave length 7 dropped
- [ ] `pnpm --filter @server test` passes
- [ ] No clock-sync code added to the server

## Success Criteria

- The new test and the existing binary test pass.
- `git diff --name-only -- server` lists only `relay.ts` and `relay.test.ts`.

## Risk Assessment

- `Buffer.alloc` on each binary frame is the existing relay cost. Do not redesign it here.
- If Phase 3 is not on the branch yet, the screen will ignore the 5-byte frame until `handleBinary` there learns length 5. That is expected. This phase is still done when the server test passes.

## Security Considerations

- The slot prefix still comes from `client.slotIndex`, which the server set at join. The phone does not choose the prefix.
- Forwarding 4 opaque bytes does not parse JSON and does not grant a new role.

## Verification

```bash
pnpm --filter @server test
```

## Next Steps

None. End-to-end fallback belongs to the manual checklist in `plan.md` after Phases 2 and 3 are merged on the same branch.
