# Architecture Decision Log

This document records durable architectural decisions for `local-party-console`. Add new entries in chronological order (`ADR-002`, `ADR-003`, ...) when a platform-level choice sets a long-term constraint or trade-off.

## Index

| ID | Title | Status | Date |
| :--- | :--- | :--- | :--- |
| [ADR-001](#adr-001-local-only-lan-webrtc--sdp-filtering) | Local-Only LAN WebRTC & SDP Filtering | Accepted | 2026-11-24 |
| [ADR-002](#adr-002-multi-button-input-loss-protection--toggle-bits) | Multi-Button Input Loss Protection: Toggle Bits vs Rolling Window | Accepted | 2026-11-25 |

---

## ADR-001: Local-Only LAN WebRTC & SDP Filtering

- **Status:** Accepted
- **Date:** 2026-11-24

### Context

`local-party-console` runs on an Apple Silicon MacBook host in Chrome and pairs up to 8 smartphones over local Wi-Fi. Players scan a QR code and play inside Safari or Chrome with no native app install.

This setup creates four networking constraints:

1. **Tight latency budget:** Touch input must reach the host simulation within a few milliseconds on the local network (see [specifications/SPEC.md](../specifications/SPEC.md)). Internet round trips, STUN lookups, and TURN relays add latency and fail when the room has no internet access.
2. **Browser mDNS obfuscation:** Chrome and Safari replace local IPv4 host candidates with `<uuid>.local` mDNS hostnames when the page does not hold camera or microphone permission. Mobile browsers frequently fail to resolve `.local` candidates reliably across local Wi-Fi routers.
3. **Candidate noise on multi-homed hosts:** A MacBook on a dock can expose Ethernet, Wi-Fi, VPN, Docker, loopback, and IPv6 addresses. Advertising unreachable candidates slows ICE checks and risks choosing the wrong path.
4. **Mobile cache stickiness:** Scanning the same room URL after a controller update can load stale cached HTML or assets on mobile Safari and Chrome.

### Decision

1. **Direct host-tab WebRTC with zero ICE servers:**
   - The primary `/screen` Chrome tab owns one `RTCPeerConnection` per player slot (`0..7`). Fastify only serves assets, exposes `GET /api/host`, and relays WebSocket control/signaling frames ([server/src/index.ts](../server/src/index.ts), [server/src/relay.ts](../server/src/relay.ts)).
   - Both [screen/src/peer.ts](../screen/src/peer.ts) and [controller/src/peer.ts](../controller/src/peer.ts) construct `RTCPeerConnection({ iceServers: [] })` and open a pre-negotiated unreliable DataChannel (`ordered: false, maxRetransmits: 0, negotiated: true, id: 0`) for 8-byte binary inputs and 4-byte heartbeats.
2. **Server-resolved RFC 1918 LAN IPv4 and strict SDP candidate filtering:**
   - `GET /api/host` selects an RFC 1918 IPv4 address (`isRfc1918(request.hostname)` or `firstNonInternalIpv4()`).
   - [shared/src/sdp/munge-lan.ts](../shared/src/sdp/munge-lan.ts) (`mungeLanSdp(sdp, lanIp)`) filters both gathered offer SDPs and trickle ICE candidates on the host. It keeps only `typ host` candidates whose address matches `lanIp` or ends with `.local` (rewriting `.local` to `lanIp` while keeping the original port and attributes), and drops `srflx`, `prflx`, `relay`, IPv6, and other-interface candidates.
3. **Visible local-network warning with binary WebSocket fallback:**
   - If `mungeLanSdp` finds zero usable host candidates (`ok: false`) or offer setup throws, the host lobby displays `LOCAL NETWORK BLOCKED — CHECK WI-FI OR BROWSER PERMISSIONS` ([screen/src/lobby.tsx](../screen/src/lobby.tsx)).
   - Phones never hard-fail on blocked WebRTC. [shared/src/transport/policy.ts](../shared/src/transport/policy.ts) (`routeFastInput`, `inputDeliveries`) and [controller/src/send-input.ts](../controller/src/send-input.ts) route fast input over binary WebSocket frames (`CLOSED_CHANNEL_WAIT_MS = 3000`, `OPEN_BUFFER_LIMIT = 64`), which [server/src/relay.ts](../server/src/relay.ts) forwards to the primary screen tab with a 1-byte slot prefix.
4. **Semver QR cache-busting (`CONTROLLER_REV`):**
   - [shared/src/sdp/qr-target.ts](../shared/src/sdp/qr-target.ts) builds `https://<lanIp>:<port>/controller?rev=<CONTROLLER_REV>&room=<code>`. `CONTROLLER_REV` follows semver (`X.Y.Z`, bumped only on controller changes per [AGENTS.md](../AGENTS.md)) to bust phone browser caches on QR rescan.

### Rationale

- **Offline-first, low-latency LAN transport:** Passing `iceServers: []` guarantees zero internet dependency and avoids STUN/TURN infrastructure or cloud hops.
- **No intrusive host permissions:** Rewriting `.local` host candidates to the server-reported `lanIp` bypasses mDNS failure without prompting the host user for microphone or camera access.
- **Fast, deterministic ICE selection:** Pruning non-LAN, IPv6, reflexive, and relay candidates leaves only the active LAN IPv4 host path for phones to dial.
- **Graceful degradation:** Keeping binary WebSocket transport behind the same `GameTransport` seam ensures a match still runs if macOS Local Network privacy or router AP isolation blocks peer-to-peer UDP.
- **Predictable phone updates:** Embedding `rev=<CONTROLLER_REV>` in the QR target and displaying `REV <CONTROLLER_REV>` on the phone eliminates stale-cache debugging during playtests.

### Trade-offs & Consequences

- **Single-subnet LAN only:** With `iceServers: []` and host-only candidate pruning, phones and the host Mac must reach each other directly on the same local network. Remote internet play or double-NAT routing is out of scope.
- **Trusted local HTTPS certificate required:** Phones load `https://<lanIp>:8443/controller?...` and open `wss://`. The local `mkcert` certificate SAN must include the active `lanIp`, and each phone must trust the local CA.
- **Dependence on SDP text munging and rollback:** `mungeLanSdp` edits RFC 5245/8839 `a=candidate:` lines directly, and [screen/src/peer.ts](../screen/src/peer.ts) uses `setLocalDescription({ type: 'rollback' })` before applying the rewritten offer. Browser changes to SDP line structure or local-offer rollback semantics require updating `munge-lan.ts` and its tests.
- **Session-latched lobby warning:** In [screen/src/session.ts](../screen/src/session.ts), `sdpWarning` stays `true` once triggered until the `/screen` tab reloads.
- **Fallback latency cost:** When a phone falls back to binary WebSocket (`mode === 'ws'`), input travels over TCP through Fastify (`Phone -> Fastify -> Chrome`) and is subject to TCP head-of-line blocking under Wi-Fi packet loss.

### References

- [shared/src/sdp/](../shared/src/sdp/)
- [shared/src/sdp/README.md](../shared/src/sdp/README.md)
- [specifications/SPEC.md](../specifications/SPEC.md)
- [shared/src/transport/policy.ts](../shared/src/transport/policy.ts)
- [server/src/index.ts](../server/src/index.ts)
- [server/src/relay.ts](../server/src/relay.ts)
- [screen/src/peer.ts](../screen/src/peer.ts)
- [screen/src/session.ts](../screen/src/session.ts)
- [controller/src/peer.ts](../controller/src/peer.ts)
- [AGENTS.md](../AGENTS.md)

---

## ADR-002: Multi-Button Input Loss Protection: Toggle Bits vs Rolling Window

- **Status:** Accepted
- **Date:** 2026-11-25

### Context

Games expanding beyond single-button mechanics (such as Cyber-Citadel Defense requiring up to 4 actions: Fire, Dash, Shield, Revive) place higher demands on input packet reliability over UDP-backed WebRTC DataChannels:

1. **Unreliable UDP Transport:** WebRTC DataChannels run with `ordered: false, maxRetransmits: 0`. While out-of-order packets are discarded by the host's monotonic `seqAccepted()` sequence filter, lost UDP packets can drop short button taps entirely if only instantaneous state is transmitted.
2. **Packet Constraint:** The platform uses an 8-byte binary input packet (`seq: u16`, `phoneTs: u16`, `touchLag: u8`, `buttons: u8`, `axisX: i8`, `axisY: i8`). Increasing the byte length is undesirable as it affects serialization across the entire network boundary.
3. **Host Tick Latching:** Host physics steps at 120Hz (`STEP_MS = 8.33ms`). Quick taps landing between host ticks require host-side latching for all button bits (0..7), not merely bit 0.

### Options Considered

#### Option 1: Multi-Packet Rolling Edge Redundancy Window
- **Description:** When a button is pressed or released, the phone keeps that button's active transition bit asserted across a rolling window of $N$ consecutive packets (e.g. 2 consecutive packets).
- **Pros:**
  - Conceptually straightforward: each packet duplicates recent transitions.
  - Zero decoding state required on the host beyond standard bitmask reading.
- **Cons:**
  - **Vulnerable to burst loss:** A 2-packet window only tolerates a single dropped packet. Mobile Wi-Fi routinely drops packets in bursts of 2–3, which causes the tap to vanish.
  - **Arbitrary window sizing:** Increasing window depth to 3 or 4 packets increases phantom hold duration on rapid releases, creating latency artifacts.

#### Option 2: Split-Byte State + Alternating Toggle Bits
- **Description:** Divide Byte 5 (`buttons: u8`) into two 4-bit nibbles:
  - **Bits 0–3 (Held State):** Real-time held state of buttons A, B, X, Y (1 = down, 0 = up).
  - **Bits 4–7 (Toggle Bits):** Dedicated 1-bit flip-flop counters for buttons A, B, X, Y. Every new rising-edge button press inverts its corresponding toggle bit (`0 -> 1 -> 0 -> 1`). The host detects a new press whenever the toggle bit differs from the previously received value.
- **Pros:**
  - **Burst-loss resilient:** The toggle bit remains in its flipped state across all subsequent packets until the next press. Even if 3 to 10 packets are lost in a burst, the next arriving packet immediately signals that a press occurred.
  - **Separates continuous hold from discrete press:** Bits 0–3 provide smooth continuous holding (e.g. continuous beam fire or shield deploy), while Bits 4–7 guarantee edge detection.
  - **Zero wire protocol growth:** Fits completely inside the existing 8-byte UDP packet without allocation.
  - **Clean out-of-order interaction:** Stale packets arriving late are rejected by `seqAccepted()`, so they cannot corrupt or revert the toggle state.
- **Cons:**
  - Restricts the split-byte format to 4 distinct buttons (sufficient for all planned console games).
  - Misses an edge only if the exact same button is tapped twice within a completely dropped packet window (<50ms), which is physically impossible for human finger input.

### Decision

**Choose Option 2 (Split-Byte State + Alternating Toggle Bits).**

1. **Packet Encoding:** In `shared/src/codec/input-packet.ts` and `controller/src/send-input.ts`, allocate Bits 0–3 for held buttons and Bits 4–7 for press toggles.
2. **Host-Side Latching:** In `screen/src/host-loop.ts`, update latching so the host detects toggle changes and latches all 8 button bits into the 120Hz simulation tick.
3. **Stream Keep-Alive:** Update `send-input.ts`'s `stickHeld()` to keep streaming inputs while any button is held (`buttons !== 0`), preventing 100ms silence cutoffs on centered joysticks.
4. **Backward Compatibility:** One-button games (Sumo Dash, Bomb Pass, Color Clash) default to Button 0 (`A`), remaining 100% compatible.

### References

- [shared/src/codec/input-packet.ts](../shared/src/codec/input-packet.ts)
- [controller/src/send-input.ts](../controller/src/send-input.ts)
- [screen/src/host-loop.ts](../screen/src/host-loop.ts)

