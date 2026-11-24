---
name: verify-local-party-console
description: "Drive local-party-console the way a host and a phone do. Use when you must launch the Fastify relay, open /screen or /controller in Chrome, prove a lobby journey, and keep the proof after cleanup."
---

# Verify local-party-console

The user surface is the host screen and the phone controller. Both are SolidJS pages served by the `@server` Fastify process. The screen at `/screen/` creates a room, shows the QR code, and runs the match. The controller at `/controller` joins that room. The relay does not simulate the game.

This skill is the platform check. Vitest covers the sim. Do not use a test-only endpoint. Do not call `session.start` or `playAgain` from the console.

Run every command from the repo root. The harness is `.cursor/skills/verify-local-party-console/scripts/verify.mjs`.

## Launch

Start a verification server. Do not reuse a living-room server on port `8443`.

```sh
.cursor/skills/verify-local-party-console/scripts/verify.mjs launch
```

`VERIFY_PORT` overrides the port. The default is `18443`. The process listens on `0.0.0.0` at that port. The command sets `PORT` for `@server` and runs `corepack pnpm --filter @server dev`.

Ready means all three of these are true:

- The server log contains `https://127.0.0.1:<port>/screen/?room=`.
- `GET /api/host` returns JSON with that port.
- `GET /screen/` returns HTML whose title is `Screen`.

The launch command waits up to 90 seconds for that state. There is no database and no seed. A new process starts with an empty room map. The process then creates one boot room and prints four links: `holistic`, `local`, `team-1`, and `team-2`. Those links include `hostToken`. Do not commit them.

Opening `/screen/` with no query creates a second room. The boot-room links do not point at that room.

Launch is safe to repeat. If this skill's server is already up, the command prints `already-running` and does not start another process. If the port belongs to some other process, launch stops and names that pid. Do not kill it by name.

The screen needs `certs/dev.pem` and `certs/dev-key.pem`. Create them with the README `mkcert` command when they are missing. `mkcert -install` trusts this Mac only. It asks for the Mac password. This skill does not run `sudo`.

One `party-sim-<room>` lock exists per browser profile. Only the holistic tab requests it. A second holistic tab for the same room is not primary, and `START` stays off. A team tab does not take the lock. Do not open two holistic tabs for one room. Do not drive the user's normal Chrome profile. The harness uses its own profile under `.cursor/skills/verify-local-party-console/.run/chrome-profile`.

Stop the server with Cleanup. A failed launch already kills the process it started.

## Doctor

Run this before the first drive, and again after any surprise.

```sh
.cursor/skills/verify-local-party-console/scripts/verify.mjs doctor
```

Exit 0 prints `ok`. It checks the recorded pid, the listener on the verification port, `GET /api/host`, `GET /screen/`, and the cert SAN. The SAN must include `localhost` and `127.0.0.1`.

Doctor also prints these lines. Read them. Do not treat a caveat as a pass for a phone.

- `node=` and `nvmrc=` record the running Node and `.nvmrc`. `.nvmrc` asks for Node 22. A newer Node is not a failure when the server is up.
- `gitRev=` is the checkout revision recorded at launch. The server does not report a build id.
- `lanIpInSan=false` means the QR host is not on the cert. Recreate `certs/dev.pem` with that address. The screen source does not render `CERT // HOST NOT IN SAN`. Chrome fails TLS before the page loads.
- The mkcert caveat means this Mac may trust the CA and a phone still does not. Doctor does not check a phone. Doctor does not run `sudo`.

A TLS failure tells you to run `mkcert -install` in a terminal and enter the Mac password. A doctor failure means the instance is not worth driving. Run Cleanup only for a server this skill started, then Launch again.

## Drive

Read `features/README.md`, then the feature file. Prefer `browser tab use <substring>` over a tab index. Chrome does not keep a stable tab order. `tab use` must match one URL.

```sh
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser start
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser open screen
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab open qr
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab use "view=holistic"
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser click --text "SUMO DASH"
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser fill --placeholder NAME --value Ada
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser wait-text "VIEW // HOLISTIC"
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser facts
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser text
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser screenshot .cursor/skills/verify-local-party-console/evidence/create-room/lobby.png
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser stop
```

`browser start` deletes the old profile and opens headless Chrome. `browser open screen` loads `https://127.0.0.1:<port>/screen/` and waits until the address contains `room=`. `browser tab open qr` reads `p.url` on the screen tab and opens the controller. `team:team-1` builds a team URL for the selected screen tab's room. `log:local` and `log:team-1` open the boot room from the server log, which is a different room from `/screen/`.

`browser click` calls `HTMLElement.click()` on the button whose trimmed text matches. Screen game buttons and `JOIN` honor that click. `browser fill` sets the input and dispatches `input`. Visible text is `innerText`. The controller uppercases names through CSS, so the phone text shows `ADA` when the field was `Ada`. The screen player row shows `Ada`.

`browser facts` prints JSON. It includes the URL, the button `disabled` and `data-pressed` values, the QR URL, and `hostKeys`. It does not print token values. Room creates append one redacted line to `.run/network.jsonl`.

The proved command is:

```sh
.cursor/skills/verify-local-party-console/scripts/verify.mjs drive create-room
```

That command runs doctor, drives the create-room feature, writes the evidence bundle, and stops Chrome. It leaves the server up.

## Evidence

Write proof under `.cursor/skills/verify-local-party-console/evidence/`. Cleanup does not delete that directory.

`drive create-room` writes:

- `evidence/create-room/summary.txt` with `result=pass`, the room code, and `postCount=1`
- `evidence/create-room/facts.json` and `second-facts.json`
- `evidence/create-room/lobby.txt` and `second-lobby.txt`
- `evidence/create-room/lobby.png`
- `evidence/create-room/network.json` with `tokenStored=true` and no token string
- `evidence/create-room/doctor.txt`

Capture the action and the next state. For create-room, the action is opening `/screen/`. The next state is the same room on a second load, one `POST /api/rooms`, and localStorage key `party-host-<room>`. The screenshot shows the room code, `VIEW // HOLISTIC`, the QR code, `SUMO DASH`, and `START`.

This proof used headless Chrome on the Mac at `127.0.0.1:18443`. It did not install the CA on a phone. It did not open the living-room server on port `8443`. It did not use the user's normal Chrome window. A phone journey stays unverified until a phone that trusts `rootCA.pem` joins.

## Cleanup

Stop only the server and Chrome this skill recorded.

```sh
.cursor/skills/verify-local-party-console/scripts/verify.mjs cleanup
```

The command sends `SIGTERM` to the recorded process tree, then `SIGKILL` if it is still alive. It deletes `.cursor/skills/verify-local-party-console/.run/`. It leaves `evidence/` in place. Confirm the evidence files still exist after cleanup. Confirm port `18443` is free. Do not kill a process because its name is `node` or `Chrome`.

Run cleanup after a failed drive too, so a broken attempt does not keep the port.

## Helpers

The helper is executable. From the repo root:

```sh
.cursor/skills/verify-local-party-console/scripts/verify.mjs help
.cursor/skills/verify-local-party-console/scripts/verify.mjs launch
.cursor/skills/verify-local-party-console/scripts/verify.mjs doctor
.cursor/skills/verify-local-party-console/scripts/verify.mjs url local
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser start
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser open screen
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab list
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab use "view=holistic"
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab open qr
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab open team:team-1
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser click --text "SUMO DASH"
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser fill --placeholder NAME --value Ada
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser wait-text "P1" --timeout 15000
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser text
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser facts --out .cursor/skills/verify-local-party-console/evidence/create-room/facts.json
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser screenshot .cursor/skills/verify-local-party-console/evidence/create-room/lobby.png
.cursor/skills/verify-local-party-console/scripts/verify.mjs browser stop
.cursor/skills/verify-local-party-console/scripts/verify.mjs drive create-room
.cursor/skills/verify-local-party-console/scripts/verify.mjs cleanup
```

`url local` prints a boot-room link. That link contains `hostToken`. Do not write it into a committed file. `team:team-1` is different: it uses the selected screen tab's room, and the log line redacts the token.

Set `CHROME_PATH` when Chrome is not at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

## Maintenance

Keep this map honest with `/maintain-verification-skill` as the screen, the controller, or the relay changes. Do not edit the game to make a journey pass.
