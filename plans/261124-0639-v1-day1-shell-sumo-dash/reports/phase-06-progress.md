# Phase 6 progress

Status: implemented, with living-room rows failed.

## Completed

- Reconciled the coordinator checkpoint. Phases 4 and 5 are accepted. No continuation handoff. Phase 6 had no plugin files yet.
- Change R went red (`Cannot find module './manifest'`), then green. The manifest is the v1 literal: `sumo-dash`, holistic, `zero-buffer`, `supportsBots: false`, players 2–8.
- `screen/src/register-games.ts` registers that manifest, `createSumoSimulation`, `eventsFromHeaderDiff`, and `createSumoRenderer`.
- `controller/src/register-games.ts` registers the landscape view. The local manifest tokens are copied onto the shell. The wire theme is not applied.
- The host loop already called `eventsFromHeaderDiff` after a step batch. This phase adds `state`, so the primary renderer reads `sim.state`. A mirror tab reads the snapshot copy. `view=team-1` does not call `createSumoRenderer`.
- The phone view uses `VirtualJoystick`, one `DASH` button, and `PlayerBadge`. Dash cooldown is a 1.5s CSS scale. `sumo:haptic` with `heavy` or `out` calls `navigator.vibrate(25)` when that function exists.
- Phaser is `4.2.1` on `@games/sumo-dash` and `@screen` only. The game package also depends on `solid-js@2.0.3` and `@solidjs/web@2.0.3` so the controller view can compile. `server/` and `controller/` do not depend on Phaser.

## Checks

- `corepack pnpm -r test`: exit 0. Shared 7 files / 8 tests, screen 1, server 3, sumo 2 files / 9 tests, controller exit 0.
- `corepack pnpm --filter @screen exec tsc --noEmit`: exit 0.
- `corepack pnpm --filter @controller exec tsc --noEmit`: exit 0.
- Headless Chrome at `http://127.0.0.1:5176/screen/`: `VIEW // HOLISTIC`, game button `SUMO DASH`, `START` disabled. No reactive error.
- Same host, `/screen/?view=team-1`: `VIEW // TEAM 1`, `SUMO DASH`, no 800px canvas. The standby sentence did not appear. `game:mount` was not sent.
- A throwaway page imported `createSumoRenderer` with a fake `Float32Array`. After Phaser booted, the canvas read corner `234,230,223` (`#EAE6DF`), plate `214,209,199` (`#D6D1C7`), and puck `255,77,0`. The page was deleted after the pass.
- Headless Chrome at `http://127.0.0.1:5177/controller/?room=ABCD`: room `ABCD`, `JOIN`, `NO GAME` / `WAITING`, `LINK // DOWN`. The Sumo layout was not mounted. No reactive error.
- `mkcert` is not installed. `certs/dev.pem` and `certs/dev-key.pem` are absent. `corepack pnpm --filter @server dev` was not started.
- Advice was not requested. No cook gate needed a decision.
- Review was inline. This task does not allow subagents.
- Step 3.S was skipped. This folder is not a git repo.

## Rerun 2026-11-24 01:08

Hudson approved mkcert. mkcert 1.4.4 is installed. The local CA is at `~/Library/Application Support/mkcert`. `mkcert -install` created that CA and then failed: `security add-trusted-cert` needs sudo, and no Mac password was available. The system trust store does not trust the CA.

Dock Ethernet (`en7`, DisplayLink) was inactive. The active LAN address is Wi-Fi `en0` `10.0.0.72`. Cert names are `localhost`, `127.0.0.1`, and `10.0.0.72`. `certs/*.pem` stays gitignored.

`corepack pnpm --filter @server dev` is running on `0.0.0.0:8443`. Curl with the mkcert CA: `/api/host` returned `{"lanIp":"10.0.0.72","port":8443}`; `/screen/` and `/controller/` returned 200.

Headless Chrome without ignoring certificate errors saved an empty document. The same Chrome with `--ignore-certificate-errors` showed `VIEW // HOLISTIC`, room `BALP`, and `https://10.0.0.72:8443/controller?room=BALP`. That flag is not system trust. No phone joined. Living-room play is not claimed.

## Remaining acceptance

- Hudson runs `mkcert -install` in a terminal and types the Mac password so Chrome trusts the cert.
- Hudson installs `rootCA.pem` from `mkcert -CAROOT` on each phone, then trusts it. Mac install does not trust phones.
- After both trusts, rerun join, dash, leave/rejoin, DataChannel, binary `ws` fallback, Low Power, podium, and the team-view standby string. Those rows stay fail.

## Non-blocking suggestions

- The screen still does not answer `net:ping`, so the phone `WI-FI` pill stays `WAIT` until some peer sends `net:pong`.
- `sumo:rematch` from the podium uses `action: 'again'`. The spec word is `restart`. The mirror tab already listens for `again`.
- `eventsFromHeaderDiff` sets `knockedBy` to null. The float buffer does not store who hit whom.
- A draw does not increment the score sum, so the next `roundNumber` can repeat.
