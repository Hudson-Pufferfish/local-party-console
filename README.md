# Local Party Arcade

A living-room party console that turns your laptop and phones into a multiplayer arcade.

The main screen (your laptop or connected TV/monitor) runs the games in Chrome, while players use their own smartphone browsers as wireless controllers—no app installs required. Up to 8 players can jump in instantly via a QR code.

## Available Games

- **Sumo Dash — 1 to 8 players:** Slide, collide, and time powerful dashes to knock rival pucks from a shrinking ring. Solo players can add bots, and bots can fill open places or be turned off.
- **Bomb Pass — 1 to 8 players:** Chase opponents and pass a live bomb before its fuse ends in a fast hot-potato showdown. Solo players can add bots, and bots can fill open places or be turned off.
- **Color Clash — 1 to 8 players:** Paint the floor, steal rival territory, and race for the golden tile when a round ends in a tie. Solo players can add bots, and bots can fill open places or be turned off.
- **Last Light — 1 to 8 players:** Lock in as late as you dare before a lamp blows out at a secret moment. Solo players can add bots, and bots can fill open places or be turned off.
- **Citadel Defense — 1 to 8 players:** Work together through eight waves to defend the Core with lasers, dashes, walls, revives, and a squad EMP. Play truly solo, add bots, or turn bots off for a local squad.

**[Read the full Games Guide (docs/games.md)](docs/games.md)**

## Quick Start / Setup

Run all commands from the repo root. Use Node 22 (`/.nvmrc`) and corepack's `pnpm`.

Install workspace dependencies first:

```sh
corepack pnpm install
```

### 1. Install mkcert

**macOS**

```sh
brew install mkcert
mkcert -install
```

**Windows (PowerShell)**

```powershell
winget install FiloSottile.mkcert
# Or with Chocolatey: choco install mkcert
mkcert -install
```

Open a new PowerShell window if `mkcert` is not on `PATH` after install. `mkcert -install` asks for administrator approval. It trusts the host computer only. It does not trust a phone.

### 2. Find LAN IPv4

Prefer Ethernet when that adapter is up. Otherwise use Wi-Fi.

**macOS**

```sh
ipconfig getifaddr en0
```

**Windows (PowerShell)**

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notlike '169.254.*' } | Select-Object InterfaceAlias, IPAddress
```

### 3. Generate Dev Certificate

Replace `<lan-ip>` with the LAN IPv4 address from step 2.

**macOS**

```sh
mkdir -p certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev.pem localhost 127.0.0.1 <lan-ip>
```

**Windows (PowerShell)**

```powershell
New-Item -ItemType Directory -Force -Path certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev.pem localhost 127.0.0.1 <lan-ip>
```

`certs/*.pem` stays untracked.

### 4. Install Certificate on Phones (One-Time)

`mkcert -install` trusts the host computer only. Each phone needs `rootCA.pem` from the folder printed by `mkcert -CAROOT`.

Run the one-liner for your OS. It prints the phone URL and serves `rootCA.pem` on port `8080`:

**macOS**

```sh
LAN=$(ipconfig getifaddr en0 || ipconfig getifaddr en1); echo "Phone: http://${LAN}:8080/rootCA.pem"; cd "$(mkcert -CAROOT)" && python3 -m http.server 8080
```

**Windows (PowerShell)**

```powershell
$lan = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress; Write-Host "Phone: http://${lan}:8080/rootCA.pem"; python -m http.server 8080 --directory "$(mkcert -CAROOT)"
```

Open that URL on each phone. The phone and host must be on the same network. If Windows Defender Firewall prompts for `python`, allow access on Private networks. Press `Ctrl+C` in that terminal when the file is on the phone.

#### iPhone

1. Open the downloaded profile. If iOS only saves the file, go to Settings → General → VPN & Device Management and install the profile.
2. Go to Settings → General → About → Certificate Trust Settings. Turn on full trust for the mkcert root.

Chrome on iPhone uses that system trust. Full trust is required. Clicking Proceed on a certificate warning does not trust the game socket (`wss`).

#### Samsung and Android

1. On One UI, go to Settings → Security and privacy → More security settings → Encryption and credentials → Install a certificate → CA certificate.
2. Confirm the install warning and choose `rootCA.pem`.

Install the CA for the browser that scans the QR code. Chrome and Samsung Internet are separate. A warning accepted in one does not cover the other. Clicking Proceed on the page does not trust `wss`.

## When I Want to Play

Start the server from the repo root:

```sh
pnpm play
```

The server listens on `0.0.0.0:8443`. When running, `GET https://<lan-ip>:8443/api/host` returns `lanIp`.

Open this URL in a normal Chrome window on the main screen:

```text
https://<lan-ip>:8443/screen/
```

Scan the QR code with each phone and open the controller page in the browser that trusts the mkcert CA. Pick a game and start. With the bot count at 0, Start stays off until at least 2 players join.

- Do not open `/screen/` in Incognito. That window has no saved host token, so the page shows `HOST ACCESS MISSING — OPEN IN THE ORIGINAL BROWSER WINDOW` and the QR stays empty.
- If Chrome blocks the page before it loads, the LAN IP is missing from the certificate. Regenerate `certs/dev.pem` with the current LAN IP.

## When I Close the Laptop

Press `Ctrl+C` in the terminal running the server.

The mkcert root certificate and phone trust stay installed across restarts. Regenerate `certs/dev.pem` only when your LAN IP changes on a new Wi-Fi network.

## Developer Guide

- **Telemetry HUD:** On-screen FPS and phone transport diagnostics are documented in [docs/telemetry.md](docs/telemetry.md).
- **Architecture Decisions:** Durable platform choices, network protocols, and trade-offs are documented in [docs/architecture-decision.md](docs/architecture-decision.md). Server runtime details live in [server/README.md](server/README.md).
- **CI & Security Verification:**
  - **GitHub Actions CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): Runs on pushes to `main` and every pull request. Installs with the frozen lockfile, typechecks and tests every workspace package, and builds the `controller` and `screen` apps with Vite. It does not start the HTTPS relay, so it does not need `mkcert` or `certs/*.pem`.
  - **CodeQL** ([`.github/workflows/codeql.yml`](.github/workflows/codeql.yml), [`.github/codeql/codeql-config.yml`](.github/codeql/codeql-config.yml)): Runs automated `security-extended` scans across `server`, `screen`, `controller`, `shared`, and `games` on pushes to `main`, pull requests to `main`, and every Monday.
  - **Dependabot** ([`.github/dependabot.yml`](.github/dependabot.yml)): Checks weekly for npm workspace dependency and GitHub Actions workflow updates.

## Future Plan & Roadmap

- [Modular Party Game Engine Architecture & 2D/3D Extensibility RFC](https://github.com/Hudson-Pufferfish/local-party-console/issues/83)
- Expand party games catalog (new 2D & 3D titles)
