# Phone join

Phone join lets a player open the QR link, type a name, tap `JOIN`, and show up as `LIVE` on the host screen.

## Sub-features

- `join-open` opens the controller URL printed under the QR code.
- `join-name` stores a name of up to 16 characters.
- `join-tap` sends the join and shows `P1` for the first player.
- `join-screen` lists that name and `LIVE` on the holistic screen.

## How to get to it (user POV)

- Scan the QR code on the host screen. The URL looks like `https://<lan-ip>:<port>/controller?rev=4&room=<code>`.
- Type a name in the field marked `NAME`.
- Tap `JOIN`.
- A page with no `room` query shows `ROOM // MISSING` and no `JOIN` button.

## Driving it with verify.mjs

Preconditions:

- `doctor` prints `ok` and `lanIpInSan=true`.
- A holistic screen tab is already on a room from [Create a room](./create-room.md).
- `browser facts` on that tab has a `qrUrl`.

- **Open the controller.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab open qr`. The new tab's address contains `/controller?rev=4&room=` and the screen's room code. The screen tab stays open.
- **Enter the name.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser fill --placeholder NAME --value Ada`.
- **Tap JOIN.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser click --text JOIN`. Then run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser wait-text "P1" --timeout 15000`. The phone text contains `P1` and `ADA`. The `JOIN` button is gone. The card reads `NO GAME` and `WAITING`.
- **Read the screen.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab use "room=<code>&view=holistic"`. The substring must match one tab. Then run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser wait-text "LIVE"`. The screen text contains `Ada` and `LIVE`. `START` is still disabled.
- **Proof.** Save `browser text` from both tabs and a screenshot of each under `.cursor/skills/verify-local-party-console/evidence/phone-join/`. The screen shot must show `Ada` and `LIVE`.

## Gotchas

- The controller CSS uppercases the badge. Wait for `P1` and `ADA` on the phone. Wait for `Ada` and `LIVE` on the screen. `Ada` is not a failure on the screen.
- `JOIN // SENT` can disappear as soon as the join succeeds. A stable `P1` is the phone proof. A lasting `LINK // DOWN` means the socket did not open.
- This Chrome profile stores `party-session-<room>` after the first join. A second controller tab in the same profile rejoins `P1`. It does not create `P2`.
- The harness window is landscape, so the orientation pill reads `OK`. A portrait phone shows `TURN`. That pill does not block `JOIN`.
- `log:team-1` is not this room. Do not join the boot room by mistake.
- A phone that has not installed `rootCA.pem` never reaches `JOIN`. Mac trust is not phone trust. This harness does not install the phone CA.
