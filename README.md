# local-party-console

Local party shell for this Mac. The host is an Apple Silicon M5 Pro MacBook, 16 GB. The display is an external monitor on the Kensington DisplayLink 4K dock (K33621NA). A TV is not required. Chrome on the Mac runs the game. Phones are the controllers.

Screen and controller are SolidJS. The relay is Fastify on port 8443.

## Quick Start / Setup

From the repo root. Node 22 (`/.nvmrc`). Use corepack's pnpm.

```sh
corepack pnpm install
brew install mkcert
mkcert -install
```

`mkcert -install` asks for your Mac password. It trusts this Mac only. It does not trust a phone.

Find the LAN IPv4. Prefer the dock Ethernet address when that adapter is up. Otherwise use Wi-Fi.

```sh
ipconfig getifaddr en0
```

Create the cert. Replace `<lan-ip>` with that address.

```sh
mkdir -p certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev.pem localhost 127.0.0.1 <lan-ip>
```

`certs/*.pem` stays untracked. Phones need the steps in [Phone trust](#phone-trust). The same steps are in [server/README.md](server/README.md).

## When I want to play

```sh
corepack pnpm --filter @server dev
```

The process listens on `0.0.0.0:8443`. When the server is running, `GET https://<lan-ip>:8443/api/host` returns `lanIp`.

In a normal Chrome window on the monitor, open:

```text
https://<lan-ip>:8443/screen/
```

Scan the QR code with each phone. Open the controller page in the browser that trusts the CA below. Pick Sumo Dash. With the bot count at 0, Start stays off until at least 2 players have joined.

Do not open `/screen/` in Incognito. That window has no saved host token, so the page says `HOST ACCESS MISSING — OPEN IN THE ORIGINAL BROWSER WINDOW` and the QR stays empty.

If the LAN IP is missing from the cert, Chrome blocks the page before it loads. Recreate the cert with the current LAN IP.

### Telemetry HUD

Click the host screen window. Press Tab to open the overlay. Press Tab again, or Escape, to close it.

The overlay prints:

```text
VIEWPORTS: THIS <fps>fps | OTHERS —
VIEWPORT SYNC: TICK DELTA — | CLOCK SKEW — | DISPLAYLINK COMP +0ms | FLIGHT REC —
P<n> [T<team>] <name> | <transport> | Hz: <hz> <tier> | Touch: <ms>ms | Net p50/p99/J: <p50>/<p99>/<jitter>ms | Loss: <percent>% | LongTasks: <count>
```

`VIEWPORTS` shows this tab's FPS. `OTHERS`, `TICK DELTA`, `CLOCK SKEW`, and `FLIGHT REC` stay `—`. `DISPLAYLINK COMP` reads `+0ms`.

Phone rows appear on the primary tab. A normal `/screen/` window is that tab. Another screen tab shows `PHONE TELEMETRY AVAILABLE ON PRIMARY TAB ONLY`.

Each row is one connected player:

- `P1`–`P8` is the player slot. `[T<team>]` is the team. A missing team is `[T-]`.
- Transport is `UDP-DIRECT`, `WS-FALLBACK`, or `IDLE`.
- `Hz` is that phone's input rate. The tier is `[TIER 60]` or `[ULP/LOW-POWER]`.
- `Touch` is touch lag in milliseconds.
- `Net p50/p99/J` is the median, the p99, and the jitter, in milliseconds. The field stays `—` until that phone has a clock offset.
- `Loss` is the dropped-packet percent.
- `LongTasks` is the long-task count.

A red value marks high Touch, high Net p99, or Loss above 0.

## When I close the laptop

In the terminal that is running the server, press Ctrl+C. The mkcert root and the phone trust stay installed.

The LAN IP can change on the next network. If it does, recreate `certs/dev.pem` with the new address before you play.

## Phone trust

`mkcert -install` trusts this Mac only. Each phone needs `rootCA.pem`.

On the Mac, the folder is:

```sh
mkcert -CAROOT
```

The file in that folder is `rootCA.pem`.

This command prints the phone URL, then serves the file:

```sh
LAN=$(ipconfig getifaddr en0 || ipconfig getifaddr en1); echo "Phone: http://${LAN}:8080/rootCA.pem"; cd "$(mkcert -CAROOT)" && python3 -m http.server 8080
```

The terminal prints that address. Open it on the phone. The phone and the Mac must be on the same Wi-Fi.

When the file is on the phone, press Ctrl+C in that terminal.

### iPhone

1. Open the downloaded profile. If iOS only saves the file, go to Settings → General → VPN & Device Management and install the profile.
2. Go to Settings → General → About → Certificate Trust Settings. Turn on full trust for the mkcert root.

Chrome on iPhone uses that system trust. Full trust is required. Proceed on the certificate warning does not trust the game socket (`wss`).

### Samsung and Android

On One UI: Settings → Security and privacy → More security settings → Encryption and credentials → Install a certificate → CA certificate.

Confirm the install warning and choose `rootCA.pem`.

Install the CA for the app that will scan the QR. Chrome and Samsung Internet are separate. A warning you accept in one of them does not cover the other. Proceed on the page does not trust `wss`.

## Do not

Do not put play traffic on a Cloudflare Tunnel.
