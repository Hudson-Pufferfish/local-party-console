# local-party-console

Local party shell for this Mac. Chrome on the Mac runs the game. Phones are the controllers.

The host is an Apple Silicon M5 Pro MacBook, 16 GB. The display is an external monitor on the Kensington DisplayLink 4K dock (K33621NA). A TV is not required.

Screen and controller are SolidJS. The relay is Fastify. The default port is 8443.

## One-time setup

Work from the repo root. Node 22 is in `.nvmrc`. Use corepack's pnpm.

```sh
corepack pnpm install
brew install mkcert
mkcert -install
```

`mkcert -install` asks for your Mac password. It trusts this Mac only.

Find the LAN IPv4. Prefer the dock Ethernet address when that adapter is up. Otherwise use Wi-Fi.

```sh
ipconfig getifaddr en0
```

Create the cert. Replace `<lan-ip>` with that address.

```sh
mkdir -p certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev.pem localhost 127.0.0.1 <lan-ip>
```

`certs/*.pem` stays untracked. Each phone still needs [Phone trust](#phone-trust). The same CA steps are in [server/README.md](server/README.md).

## Play

```sh
corepack pnpm --filter @server dev
```

The process listens on `0.0.0.0:8443`. `GET https://<lan-ip>:8443/api/host` returns `lanIp` and `port`.

Open this URL in a normal Chrome window on the monitor:

```text
https://<lan-ip>:8443/screen/
```

Scan the QR code with each phone. Open the controller in the browser that trusts the CA in [Phone trust](#phone-trust). Select `SUMO DASH`. With the bot count at 0, Start stays off until 2 players are connected.

Open `/screen/` in the Chrome window that saved the host token. A window with no token, including Incognito, shows `HOST ACCESS MISSING — OPEN IN THE ORIGINAL BROWSER WINDOW` and the QR stays empty.

If the LAN IP is missing from the cert, Chrome blocks the page before it loads. Recreate `certs/dev.pem` with the current LAN IP.

## Telemetry HUD

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

## Stop

In the server terminal, press Ctrl+C. The mkcert root and the phone trust stay installed.

The LAN IP can change on the next network. Recreate `certs/dev.pem` with the new address before you play.

## Phone trust

Each phone needs `rootCA.pem`. `mkcert -install` on the Mac does not install it.

On the Mac, the folder is:

```sh
mkcert -CAROOT
```

The file in that folder is `rootCA.pem`. This command prints the phone URL, then serves the file:

```sh
LAN=$(ipconfig getifaddr en0 || ipconfig getifaddr en1); echo "Phone: http://${LAN}:8080/rootCA.pem"; cd "$(mkcert -CAROOT)" && python3 -m http.server 8080
```

Open that address on the phone. The phone and the Mac must be on the same Wi-Fi. Press Ctrl+C in that terminal when the download has finished.

### iPhone

1. Open the downloaded profile. If iOS only saves the file, go to Settings → General → VPN & Device Management and install the profile.
2. Go to Settings → General → About → Certificate Trust Settings. Turn on full trust for the mkcert root.

Chrome on iPhone uses that system trust. A certificate warning you accept does not trust the game socket (`wss`).

### Samsung and Android

On One UI: Settings → Security and privacy → More security settings → Encryption and credentials → Install a certificate → CA certificate.

Confirm the install warning and choose `rootCA.pem`.

Install the CA in the browser that will open the QR. Chrome and Samsung Internet keep separate trust stores. A certificate warning you accept does not trust `wss`.
