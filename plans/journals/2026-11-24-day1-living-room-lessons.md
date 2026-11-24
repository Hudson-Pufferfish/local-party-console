# Day-1 living room, 2026-11-24

Facts from the first session with phones. No certificates and no tokens in this note.

## Code path vs a real room

Phases 4–6 (screen shell, controller shell, Sumo plugin) and the Option D host apply were green as code. That did not mean living-room play. Living-room rows stay open until phones trust the cert and join. A headless Mac browser is not that check.

## Certificates

`mkcert -install` trusts the Mac only. Each phone needs `rootCA.pem` from `mkcert -CAROOT`.

Same Wi-Fi download from the Mac:

```sh
cd "$(mkcert -CAROOT)" && python3 -m http.server 8080
```

On the phone, open `http://<lan-ip>:8080/rootCA.pem`. Ctrl+C that server when the file is downloaded.

iPhone: install the profile under Settings → General → VPN & Device Management, then turn on full trust under Settings → General → About → Certificate Trust Settings. Chrome on iPhone uses that system trust.

Samsung One UI: Settings → Security and privacy → More security settings → Encryption and credentials → Install a certificate → CA certificate.

Proceed on the page warning does not trust `wss`. Chrome and Samsung Internet are separate apps. The CA has to be trusted in the app that scans the QR.

Recreate the dev cert when the LAN IP changes. `certs/*.pem` stays untracked.

## Host screen

`HOST // TOKEN MISSING` means this browser has no host token for that room. Incognito does that. So does a stale `?room=` link opened without the token. The QR stays empty, so phones are not joining a live host.

Bare `/screen/` creates a room and stores the token. After the next `@server dev` start, the terminal prints clickable links for one shared room: holistic, local (`127.0.0.1`), team-1, and team-2. Each link carries the host token. The page stores it and removes it from the address bar.

Sumo is holistic. `view=team-1` and `view=team-2` do not run the sim. They stand by once a holistic game is mounted.

START stays off unless this tab holds the exclusive `party-sim-<room>` lock. Extra `/screen` tabs on the same room do not become primary. Close them.

## Phone JOIN

A JOIN tap could queue `room:join` while the socket was still connecting and change nothing visible. The only failure line was 12px, so a dead socket looked the same as a missed tap.

The controller now shows a large `JOIN // SENT` or `LINK // DOWN` banner. The phone stamp under the room code is `REV N`. The QR query `rev=` is only a cache bust. Those two drifted (`rev=3` in the QR, REV 4 on the phone). Both now read `CONTROLLER_REV` in `shared/src/sdp/qr-target.ts`.

## Joystick

Dragging the stick on Samsung Chrome and on Chrome for iPhone showed the browser’s blue selection highlight. The move listener was passive, so the page could not cancel that gesture. `touch-action` and `user-select` on the page root were not enough.

The joystick and the swipe pad now cancel the native drag (non-passive touch and pointer handlers, plus `-webkit-user-select`, `-webkit-touch-callout`, and `-webkit-user-drag`).

## Docs

Root `README.md` (Phone trust) and `server/README.md` have the CA download and the iPhone and Samsung install steps. Open `/screen/` in a normal Chrome window, not Incognito.
