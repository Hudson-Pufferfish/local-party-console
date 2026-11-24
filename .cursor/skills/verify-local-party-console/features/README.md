# Local party console verification map

This directory is the maintained source for the user-facing screen and controller. Read this index, then use the matching feature file.

## Baseline preconditions

- Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs launch`.
- The base URL is `https://127.0.0.1:18443` unless `VERIFY_PORT` set another port.
- Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs doctor` and require `ok`.
- Require `lanIpInSan=true` before you open a QR URL. A false value means the phone fails TLS.
- The Mac CA trust does not trust a phone. Doctor does not check the phone.
- Start Chrome with `browser start`. That profile is empty. Do not use the user's Chrome profile.
- Drive only the server this launch started. Do not drive port `8443` while a living-room session owns it.
- One holistic tab may hold `party-sim-<room>` in this profile. Do not open a second holistic tab for that room.

## Driving conventions

- Start from the baseline unless the feature names another entry.
- The harness command is `.cursor/skills/verify-local-party-console/scripts/verify.mjs`.
- Buttons match trimmed button text. Fields match the `placeholder` attribute.
- Use `browser tab use <substring>` and require one match.
- `browser open screen` creates a room. `log:local` and `log:team-1` open the boot room. Those rooms differ.
- `team:team-1` follows the screen tab you have selected.
- Keep every proof file under `.cursor/skills/verify-local-party-console/evidence/`.
- Do not remove proof files during cleanup.

## Proof and skip reporting

- Record the feature id, the entry URL, the action, and the next visible state.
- A pass needs the changed UI and a second observation. For a room, the second observation is the same room code on a reload, plus one `POST /api/rooms`.
- `browser facts` is the UI dump. `evidence/<feature>/` holds the screenshot and the text.
- An unreachable step names the command and the missing precondition. Do not mark it passed through a different path.
- Do not call page internals to finish a match.

## Feature entry contract

Each feature file has an H1, one paragraph, and these H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify.mjs`, `Gotchas`.

## Features

- [Create a room](./create-room.md) opens `/screen/`, shows the room code and QR, and keeps that room on reload.
- [Phone join](./phone-join.md) opens the QR URL, enters a name, taps `JOIN`, and appears as `LIVE` on the screen.
- [Start Sumo Dash](./start-sumo-dash.md) selects `SUMO DASH` and starts the match after two players are `LIVE`.
- [Team view standby](./team-view-standby.md) shows the holistic standby line on a `team-1` tab after the host selects the game.
- [Rematch](./rematch.md) shows `PLAY AGAIN` and `RETURN TO LOBBY` after the match ends.
