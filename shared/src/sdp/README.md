# SDP and LAN QR Module

`shared/src/sdp/` contains the LAN WebRTC SDP filter and the phone QR URL builder for `local-party-console`. The module lets phones on the same Wi-Fi connect directly to the host Chrome tab without STUN, TURN, or internet access.

For the architectural rationale and trade-offs, see [ADR-001 in `docs/architecture-decision.md`](../../../docs/architecture-decision.md#adr-001-local-only-lan-webrtc--sdp-filtering) and [specifications/SPEC.md](../../../specifications/SPEC.md).

## Module Inventory

| File | Exports / Role | Package Subpath |
| :--- | :--- | :--- |
| [munge-lan.ts](./munge-lan.ts) | `MungeResult`, `mungeLanSdp(sdp, lanIp)` — filters ICE candidates and rewrites `.local` mDNS host candidates to the host LAN IPv4. | `@shared/sdp/munge-lan` |
| [munge-lan.test.ts](./munge-lan.test.ts) | Vitest unit test for `.local` host rewriting and candidate pruning. | — |
| [qr-target.ts](./qr-target.ts) | `CONTROLLER_REV`, `qrTarget(lanIp, port, code)` — builds the cache-busted HTTPS controller URL for the lobby QR code. | `@shared/sdp/qr-target` |
| [qr-target.test.ts](./qr-target.test.ts) | Vitest unit test locking `CONTROLLER_REV` and the `qrTarget()` URL format. | — |

## Local-Only LAN WebRTC DataChannel (No STUN/TURN)

The primary `/screen` Chrome tab on the Apple Silicon Mac owns both the game simulation and one `RTCPeerConnection` per connected phone slot (`0..7`). Fastify ([server/src/index.ts](../../../server/src/index.ts), [server/src/relay.ts](../../../server/src/relay.ts)) serves bundles, exposes `GET /api/host`, relays WebSocket signaling, and relays binary WebSocket fallback frames. Fastify does not run physics and does not terminate WebRTC.

Both peers configure WebRTC for LAN-only delivery:

- **Zero ICE servers (`iceServers: []`):** [screen/src/peer.ts](../../../screen/src/peer.ts) (`offer`) and [controller/src/peer.ts](../../../controller/src/peer.ts) (`startPeer`) both call `new RTCPeerConnection({ iceServers: [] })`.
- **Pre-negotiated unreliable DataChannel:** Both sides open the `'input'` channel with `{ ordered: false, maxRetransmits: 0, negotiated: true, id: 0 }` and `binaryType = 'arraybuffer'`.

Avoiding STUN and TURN removes external DNS lookups, NAT hairpinning, and cloud relay hops. Phones talk directly to the host Mac over local Wi-Fi, so gameplay stays low-latency and works completely offline.

## ICE / SDP LAN-Candidate Filtering and Optimization

### 1. Host LAN IPv4 Selection

[server/src/index.ts](../../../server/src/index.ts) resolves the host IPv4 address for `GET /api/host`:

- `isRfc1918(address)` checks private RFC 1918 IPv4 ranges (`10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`).
- If `request.hostname` is an RFC 1918 address, `/api/host` returns `request.hostname`.
- Otherwise, `/api/host` calls `firstNonInternalIpv4()` across `os.networkInterfaces()` and defaults to `'127.0.0.1'` if no non-internal IPv4 exists.

[screen/src/session.ts](../../../screen/src/session.ts) (`loadHost`) fetches `/api/host`, stores `lanIp`, computes `qrTarget(body.lanIp, body.port, room)`, renders the QR canvas, and calls `offerConnected()`.

### 2. `mungeLanSdp(sdp, lanIp)` Rules

Browsers hide the host's local IPv4 behind `.local` mDNS hostnames when a page does not hold camera or microphone permission. Phones on LAN Wi-Fi often fail to resolve `.local` candidates or waste time testing unreachable virtual, IPv6, or non-LAN interfaces.

`mungeLanSdp(sdp: string, lanIp: string): MungeResult` in [munge-lan.ts](./munge-lan.ts) cleans the SDP before the host sends it:

1. Detects the line ending (`\r\n` if present, else `\n`) and splits `sdp` on `/\r?\n/`.
2. Keeps every line that does not start with `'a=candidate:'` unchanged.
3. Splits each `'a=candidate:'` line on spaces. Reads the candidate address at `parts[4]` and the candidate type right after the `'typ'` token.
4. Drops the candidate if `address === undefined` or `type !== 'host'`. This removes `srflx` (server-reflexive), `prflx` (peer-reflexive), `relay`, and malformed candidates.
5. Keeps a `typ host` candidate unchanged when `address === lanIp`, and increments `keptHost`.
6. Rewrites a `typ host` candidate when `address.toLowerCase().endsWith('.local')` by replacing `parts[4]` with `lanIp` (keeping port, transport, priority, and generation tokens intact), and increments `keptHost`.
7. Drops all other `typ host` candidates (such as other subnets, Docker/VPN interfaces, loopback, cellular, or IPv6 addresses).
8. Returns `{ sdp, ok: false }` (with the original unmodified `sdp`) when `keptHost === 0`. Otherwise returns `{ sdp: next.join(newline), ok: true }`.

### 3. Signaling Flow Between `screen`, `server`, and `controller`

1. **Primary lock & host lookup ([screen/src/session.ts](../../../screen/src/session.ts)):** The primary holistic `/screen` tab acquires `party-sim-<room>` (`holdSim`), loads `lanIp` from `GET /api/host`, and calls `peers.offer(slot, lanIp)` when a phone slot connects.
2. **Trickle ICE filtering ([screen/src/peer.ts](../../../screen/src/peer.ts)):** Inside `offer(slot, lanIp)`, `pc.onicecandidate` normalizes each non-empty candidate line with a leading `a=`, runs `mungeLanSdp(\`${line}\r\n\`, lanIp)`, and drops the trickle candidate if `!munged.ok`. Valid candidates have the leading `a=` stripped and are sent as `signal:ice`.
3. **Offer gathering & SDP rewrite ([screen/src/peer.ts](../../../screen/src/peer.ts)):** The host calls `pc.createOffer()`, `pc.setLocalDescription(created)`, and awaits `waitForIce(pc)` (resolves on `iceGatheringState === 'complete'` or after a `1500 ms` timeout). It then runs `mungeLanSdp(current, lanIp)` on the gathered SDP and calls `hooks.onSdp(munged.ok)`.
4. **Local description update ([screen/src/peer.ts](../../../screen/src/peer.ts)):** When `munged.ok && munged.sdp !== current`, the host rolls back (`setLocalDescription({ type: 'rollback' })`) if `pc.signalingState === 'have-local-offer'`, applies `setLocalDescription({ type: 'offer', sdp: munged.sdp })`, marks `record.offered = true`, and sends `signal:offer` with `{ toSlot: slot, sdp: munged.sdp }`.
5. **WebSocket relay ([server/src/relay.ts](../../../server/src/relay.ts)):** Fastify fans out `signal:*` text messages (`signal:offer`, `signal:answer`, `signal:ice`) to other open sockets in the same room.
6. **Phone answer ([controller/src/peer.ts](../../../controller/src/peer.ts)):** On `room:joined`, the phone calls `startPeer()` (`iceServers: []`, negotiated `'input'` channel `id: 0`, starts `startedAt` timer, forwards local `signal:ice`). When `signal:offer` matches its slot, `answer(sdp)` calls `setRemoteDescription`, `createAnswer`, `setLocalDescription`, and replies with `signal:answer`.
7. **Host completion ([screen/src/peer.ts](../../../screen/src/peer.ts)):** `handleText` applies incoming `signal:answer` (`setRemoteDescription`) and `signal:ice` (`addIceCandidate`) to the slot's peer once `record.offered` is true.

## `qrTarget` and `CONTROLLER_REV` Cache-Busting

[qr-target.ts](./qr-target.ts) defines:

```ts
export const CONTROLLER_REV = '0.0.2';

export function qrTarget(lanIp: string, port: number, code: string): string {
  return `https://${lanIp}:${port}/controller?rev=${CONTROLLER_REV}&room=${code}`;
}
```

With the default Fastify HTTPS port (`8443`), `qrTarget('192.168.1.20', 8443, 'ABCD')` returns:

```text
https://192.168.1.20:8443/controller?rev=0.0.2&room=ABCD
```

- **Why `rev=` exists:** Mobile Safari and mobile Chrome cache controller pages aggressively across QR scans. Changing `?rev=` forces phones to fetch the updated controller bundle instead of serving stale HTML, CSS, or scripts.
- **On-screen visibility:** [controller/src/app.tsx](../../../controller/src/app.tsx) renders `REV {CONTROLLER_REV}` in the controller top bar so players and hosts can confirm the loaded controller revision.
- **Semver bump rules (from [AGENTS.md](../../../AGENTS.md)):**
  - `CONTROLLER_REV` uses semver `X.Y.Z` (started at `0.0.0`, currently `'0.0.2'`).
  - Bump `CONTROLLER_REV` on every change that affects the phone controller.
  - Do not bump `CONTROLLER_REV` for screen-only, server-only, or docs-only changes.
  - **PATCH** (`x.y.Z`): bug, CSS, or copy fixes.
  - **MINOR** (`x.Y.0`): backwards-compatible controller features.
  - **MAJOR** (`X.0.0`): breaking phone-to-server protocol or input changes.

## `LOCAL NETWORK BLOCKED` Handling and WebSocket Fallback

### Trigger Conditions

[screen/src/peer.ts](../../../screen/src/peer.ts) calls `hooks.onSdp(false)` in two cases:

1. `mungeLanSdp(current, lanIp)` returns `ok: false` because zero `typ host` candidates matched `lanIp` or ended with `.local` after `waitForIce` (for example, macOS Local Network privacy permissions or browser settings blocked host candidate gathering).
2. `offer(slot, lanIp)` throws during offer creation or `setLocalDescription` (the `catch` block also closes that slot's peer via `close(slot)`).

### Lobby Notice

In [screen/src/session.ts](../../../screen/src/session.ts), `onSdp` sets `sdpWarning` to `true` when `ok` is `false`. [screen/src/app.tsx](../../../screen/src/app.tsx) passes `sdpWarning` to [screen/src/lobby.tsx](../../../screen/src/lobby.tsx), which renders:

```text
LOCAL NETWORK BLOCKED — CHECK WI-FI OR BROWSER PERMISSIONS
```

### Fast Input and Binary WebSocket Fallback

Blocking WebRTC LAN candidates does not stop a player from playing:

- [shared/src/transport/policy.ts](../transport/policy.ts) defines `routeFastInput()` with `OPEN_BUFFER_LIMIT = 64` bytes and `CLOSED_CHANNEL_WAIT_MS = 3000` ms.
  - When the DataChannel is open and `bufferedAmount <= 64`, the route is `'dc'`.
  - When the DataChannel is open and `bufferedAmount > 64`, the route is `'drop'`.
  - When the DataChannel is not open, the route stays `'wait'` for 3000 ms after `startPeer()`, then switches to `'ws'`.
- `inputDeliveries(route)` keeps WebSocket delivery active (`ws: true`) on `'dc'`, `'ws'`, `'drop'`, and `'wait'`, and sends over the DataChannel (`dc: true`) only on `'dc'`. In [controller/src/send-input.ts](../../../controller/src/send-input.ts), 8-byte input packets continue flowing over binary WebSocket even if the DataChannel never opens, and 4-byte heartbeats (`flushHeartbeat`) send on `'ws'` once the 3000 ms wait expires.
- [server/src/relay.ts](../../../server/src/relay.ts) (`handleBinary`) prepends the 1-byte `slotIndex` to each 8-byte input frame (9 bytes total) or 4-byte heartbeat frame (5 bytes total) and forwards it to the primary screen WebSocket (`TCP_NODELAY`, `perMessageDeflate: false`).
- [screen/src/peer.ts](../../../screen/src/peer.ts) (`handleBinary`) reads the slot byte, marks `modes[slot] = 'ws'`, and passes the payload into the same `onPacket` / `onHeartbeat` handlers used by the DataChannel.

## Verification

Run the `@shared` unit tests from the repository root:

```sh
corepack pnpm --filter @shared test
```

The test files in this folder check two invariants:

- [munge-lan.test.ts](./munge-lan.test.ts): Passes an SDP containing one `.local` host candidate (port `51234`), one `srflx` candidate (`8.8.8.8:19302`), and one non-matching host candidate (`10.9.8.7:40000`) to `mungeLanSdp(sdp, '192.168.1.20')`. Verifies `result.ok === true`, `.local` is rewritten to `192.168.1.20` while keeping port `51234`, `8.8.8.8`, `.local`, `10.9.8.7`, and `40000` are removed, and exactly one `a=candidate:` line remains.
- [qr-target.test.ts](./qr-target.test.ts): Verifies `CONTROLLER_REV === '0.0.2'` and `qrTarget('192.168.1.20', 8443, 'ABCD')` returns `https://192.168.1.20:8443/controller?rev=0.0.2&room=ABCD`.
