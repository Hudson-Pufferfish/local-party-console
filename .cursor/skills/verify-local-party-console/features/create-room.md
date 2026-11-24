# Create a room

Create a room lets the host open the screen, read a four-letter room code, and show a QR code for phones. `START` stays off until two players are connected.

## Sub-features

- `create-open` loads `/screen/` and replaces the address with `room` and `view=holistic`.
- `create-lobby` shows the room code, the QR code, `SUMO DASH`, and a disabled `START`.
- `create-keep` reloads that address and stays on the same room.

## How to get to it (user POV)

- Open `https://<lan-ip>:8443/screen/` in a normal Chrome window. The verification server uses port `18443` and `127.0.0.1`.
- Do not open that page in Incognito. A window with no stored host token shows `HOST // TOKEN MISSING` and an empty QR area.

## Driving it with verify.mjs

Preconditions:

- `doctor` prints `ok`.
- Chrome is not already started by this skill, or you can `browser stop` first.
- No second holistic tab is open for the new room.

- **Open the screen.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser open screen`. The address changes from `/screen/` to `/screen?room=<code>&view=holistic`. The code uses the letters `ABCDEFGHJKLMNPQRSTUVWXYZ`.
- **Read the lobby.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser wait-text "VIEW // HOLISTIC"`, then `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser facts`. The title is `Screen`. The text contains the room code, `SUMO DASH`, and `START`. The `START` button is `disabled`. `qrCanvas` is true. `qrUrl` contains `/controller?rev=7&room=` and the same code. `hostKeys` contains `party-host-<code>`. The text does not contain `HOST // TOKEN MISSING`.
- **Confirm the create.** Read `.cursor/skills/verify-local-party-console/.run/network.jsonl`. It has one `POST` `/api/rooms`. `roomId` matches the address. `tokenStored` is true. The line does not contain the token.
- **Reload the same room.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser open` with the `url` from facts. The room code stays the same. The network log still has one `POST`.
- **Proof.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs drive create-room`. It performs this journey and writes `.cursor/skills/verify-local-party-console/evidence/create-room/`. `summary.txt` says `result=pass`.

## Gotchas

- The server log's `local` link is the boot room. `browser open screen` creates a different room. Do not mix the two codes.
- `drive create-room` replaces `evidence/create-room/`. It does not delete other evidence folders.
- `START` is disabled with zero players. That is the correct lobby. Do not select the game during this journey.
- A second load that shows a new room code means the host token was not stored. That is a failure.
- The screenshot must show the room code and `VIEW // HOLISTIC`. A blank page is not proof.
