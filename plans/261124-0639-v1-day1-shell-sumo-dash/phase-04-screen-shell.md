---
phase: 4
title: "Screen shell"
status: done
priority: P1
effort: 6h
dependencies: [2, 3]
---

# Phase 4: Screen shell

## Goal

Open `/screen` in host Chrome. Show the room QR code, elect one primary tab, step the Sumo sim on that tab, and paint snapshots on every other `/screen` tab.

## Context

- `SPEC.md` lines 10, 48–51, 73–85, 99–101, and 126–132
- `sumo-dash.md` lines 181–185 and 243
- Phases 1–3

## Overview

Priority P1. The screen package is the WebRTC offerer. The Sumo renderer is still a placeholder canvas that draws puck centers. Phase 6 replaces that placeholder with Phaser. The sim from Phase 2 is already real.

## Key Insights

- Import the sim from `@games/sumo-dash`. Build `sumo:*` JSON in the host loop by diffing the header. Do not import the sim from `server/`.
- A `team-1` tab during Sumo mounts no sim and no renderer. It renders the standby string from Phase 1.
- SDP munging keeps the gathered UDP port. It only rewrites the address.

## Requirements

- SolidJS 2 app at `/screen` served by Fastify on the same origin as `/ws` and `/api`.
- Missing `room` creates a room, then replaces the URL with `/screen?room=CODE&view=holistic`.
- QR target is `https://{lanIp}:{port}/controller?room={code}` from `GET /api/host`.
- If the page host is `localhost` or `127.0.0.1`, the visible URL is still the LAN URL.
- Primary tab runs the 120Hz accumulator and is the RTC peer for each joined slot.
- Mirror tabs apply the latest 352-byte snapshot. They do not call `step`.
- Every screen tab holds an anti-nap lock and a silent Web Audio oscillator.
- Lobby lists `GameRegistry.list()`. Start is enabled when the connected player count is at least `manifest.minPlayers`. Disconnected slots do not count.
- Carousel selection sends `game:mount` with the manifest and the player list.
- Corner badge text is `VIEW // HOLISTIC` or `VIEW // TEAM 1`.
- Typography and the ban list in `SPEC.md` lines 75–84 apply to the lobby. Use `Space Grotesk` and `JetBrains Mono` from `@fontsource` packages. Borders are `2.5px solid #111111`. No blur, no `shadow-lg`, no purple gradient, no `Inter`.

## Architecture

`mungeLanSdp(sdp, lanIp)` in `shared/src/sdp/munge-lan.ts` runs on the host offer only:

- Keep an `a=candidate` line when `typ host` and the address is already `lanIp`.
- When `typ host` and the address ends in `.local`, replace the address with `lanIp` and keep the port token.
- Drop every other candidate line.
- If no host candidate remains, leave the SDP unchanged and return `ok: false` so the UI can show `SDP // NO LAN CANDIDATE`. Do not invent a port.

Host loop, primary tab only:

```text
substeps = 0
accumulator += min(frameDelta, 100ms)
while accumulator >= 1000/120 and substeps < 4:
  for each slot:
    if no real packet for >= 100ms: applyInput(slot, 0, 0, 0)
    else: applyInput(slot, lastRealButtons, lastRealAxisX, lastRealAxisY)
  sim.step(1/120)
  accumulator -= 1000/120
  substeps += 1
if substeps == 4: accumulator = 0
```

Synthesized zeros do not update `lastRealButtons`. A dash edge is taken if any real packet in the tick had bit 0 set and the previous real packet did not. Call the game's `eventsFromHeaderDiff` when the registry provides one. Phase 6 adds that function. Until then the loop sends no `sumo:*` frames.

Copy the 352 bytes into a second buffer. Post `{ epoch, bytes }` on `BroadcastChannel` `party-snap-{room}`. Bump `epoch` in `startMatch` and on rematch. Mirrors copy the message only when `epoch` is newer. They keep the last bytes if a post is missed. They do not call `step`.

WebRTC, once per joined slot, only after the sim lock is held:

1. `new RTCPeerConnection({ iceServers: [] })`
2. `createDataChannel('input', { ordered: false, maxRetransmits: 0, negotiated: true, id: 0 })`
3. `createOffer`, `mungeLanSdp`, `setLocalDescription` with the munged SDP
4. Send `signal:offer` with `toSlot`
5. Apply `signal:answer` and `signal:ice` only when the sending socket is the joined phone for that slot. Ignore `signal:offer` on this tab.
6. On a DataChannel message, decode 8 bytes. On a 9-byte `ws` binary frame, the first byte is the slot and the rest is the packet. Accept seq when the slot has no `lastSeq` yet, or when `((seq - lastSeq) & 0xffff)` is in `1..32767`. On `room:joined` for an existing token, clear `lastSeq` for that slot before the next packet.

The lock winner sends `viewport:claim` before the first offer. A `team-1` tab never requests `party-sim-{room}` and never sends `viewport:claim`.

Match start calls `startMatch` with the connected slot indexes. Podium buttons on the primary tab zero scores and call `startMatch` or return to the lobby, bump `epoch`, then send `sumo:rematch` so other clients follow.

Dev wiring: one Fastify origin. `screen` Vite `base` is `/screen/`. `controller` Vite `base` is `/controller/`. Register `@fastify/middie` and mount each dev server under its base. The upgrade listener sends paths that start with `/ws` to the room relay and other upgrade paths to the matching Vite HMR server. Do not attach a catch-all `WebSocketServer` to every upgrade. The QR port is this listen port.

## Files to Create / Modify

- Create: `shared/src/sdp/munge-lan.ts`
- Create: `shared/src/sdp/munge-lan.test.ts`
- Create: `screen/index.html`, `screen/vite.config.ts`, `screen/src/main.tsx`, `screen/src/app.tsx`
- Create: `screen/src/lobby.tsx`, `screen/src/badge.tsx`, `screen/src/standby.tsx`
- Create: `shared/src/sdp/qr-target.ts`
- Create: `shared/src/sdp/qr-target.test.ts`
- Create: `screen/src/host-loop.ts`, `screen/src/peer.ts`, `screen/src/register-games.ts`
- Create: `screen/src/styles.css`
- Modify: `server/src/index.ts` to mount the two Vite apps in dev
- Modify: root dependencies for `solid-js@2.0.3`, `@solidjs/web@2.0.3`, `@solidjs/vite-plugin` 3.x, `tailwindcss` 4, `@tailwindcss/vite`, `qrcode`, `@fontsource/space-grotesk`, `@fontsource/jetbrains-mono`

## Tests Before

Change N. One test in `munge-lan.test.ts`. Input SDP has a host candidate whose address ends in `.local` and port `51234`, plus a candidate that contains `8.8.8.8`. Output contains `192.168.1.20` and `51234`. Output does not contain `8.8.8.8` or `.local`. A second host candidate whose address is already a different IPv4 is dropped rather than rewritten.

Change O. One test in `shared/src/sdp/qr-target.test.ts`. `qrTarget('192.168.1.20', 8443, 'ABCD')` equals `https://192.168.1.20:8443/controller?room=ABCD`.

Land N before the peer module. Land O before the lobby renders a QR string.

## Refactor

1. Read the Solid 2 skill before writing components. Effects use the two-argument form. Props stay as `props.name`.
2. The mirror path copies bytes into a preallocated `Float32Array`. Phase 4 clears the canvas. Phase 6 draws the arena. Create `screen/src/register-games.ts` with an empty factory map in this phase.
3. `BroadcastChannel` messages are the raw 352-byte buffer.
4. Only a holistic tab requests `party-sim-{room}` with `{ mode: 'exclusive', ifAvailable: true }`. The callback returns a promise that settles on `pagehide`. `party-antinap-{room}-{tabId}` is held for the life of every screen tab, including standby tabs.
5. Start the silent oscillator with `AudioContext` and a gain of `0.0001`. Resume it on the first click if the browser blocks autoplay. The lobby Start control counts as that click.

## Tests After

No extra tests. Peer connection behavior is on the Phase 6 checklist.

## Implementation Steps

1. Add the Solid and Tailwind toolchain. The screen dev URL is the Fastify origin plus `/screen`.
2. Land Change N and Change O.
3. Build the lobby, QR, badge, and standby states.
4. Add the host loop and the peer map.
5. Leave `register-games.ts` empty of Sumo. Phase 6 adds the manifest and `createSim`. The server never imports that file.
6. Confirm a second tab with `view=team-1` shows standby copy and never calls `createSim`.

## Todo

- [x] Change N red then green
- [x] Change O red then green
- [x] Primary tab is the only caller of `step`
- [x] Standby tab does not construct the sim
- [x] QR string uses `lanIp` from `/api/host`
- [x] Lobby uses the ban-list rules

## Verification

Regression gate: `pnpm --filter @shared test && pnpm --filter @screen exec tsc --noEmit`

`@screen` has no Vitest component test in this phase. `qrTarget` and `mungeLanSdp` stay in `shared` so the gate runs in Node.

## Success Criteria

- `mungeLanSdp` and `qrTarget` tests pass.
- Screen typecheck passes.
- Manual smoke, after Phase 3's server boots: `/screen` shows a code and a LAN QR URL. A second view shows the standby string once a holistic game is mounted.

## Risk Assessment

- Chrome may omit host candidates. `ok: false` is the visible failure. Do not add STUN to force a candidate.
- A lock callback that returns `undefined` drops the lock before the offer. Return the `pagehide` promise. A team tab that claims first is a failed election. Do not request the sim lock from that view.
- Vite middleware and Fastify HTTPS must share one certificate. Do not start a second HTTP port for the screen.

## Security Considerations

- Log the transport mode per slot in memory. Do not log SDP bodies.
- Ignore `signal:offer` on the screen. Apply `signal:answer` and `signal:ice` only for the slot this tab offered.
- The page is a secure context because the server is HTTPS.

## Next Steps

Phase 5 builds the phone peer that answers these offers. Phase 6 draws the arena on the same snapshot buffer.
