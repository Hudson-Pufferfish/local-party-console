# Team view standby

Team view standby lets a second screen show `STANDBY // THIS GAME USES HOLISTIC VIEW` for Sumo Dash. Sumo Dash is a holistic game. The team tab does not run the sim.

## Sub-features

- `team-open` opens `view=team-1` for the same room as the holistic tab.
- `team-lobby` shows `VIEW // TEAM 1` and the lobby before the host selects a game.
- `team-standby` replaces that lobby with the standby line after the host selects `SUMO DASH`.

## How to get to it (user POV)

- The host already has the holistic screen open for the room.
- Open the same room with `view=team-1` in another window.
- On the holistic window, tap `SUMO DASH`.
- The team window shows the standby line.

## Driving it with verify.mjs

Preconditions:

- `doctor` prints `ok`.
- A holistic tab for the room is open. Create it with [Create a room](./create-room.md), not with `log:local`, unless you mean the boot room on purpose.
- The team tab is opened after you select that holistic tab.

- **Select the holistic tab.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab use "room=<code>&view=holistic"`. Require one match.
- **Open team view.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab open team:team-1`. The command redacts `hostToken` in its log line.
- **Read the team lobby.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab use "room=<code>&view=team-1"`. Then run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser wait-text "VIEW // TEAM 1"`. The text contains the same room code. It does not yet contain `STANDBY // THIS GAME USES HOLISTIC VIEW`.
- **Select the game on the host.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab use "room=<code>&view=holistic"`, then `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser click --text "SUMO DASH"`.
- **Read the standby line.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab use "room=<code>&view=team-1"`, then `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser wait-text "STANDBY // THIS GAME USES HOLISTIC VIEW"`. The team text no longer shows `GAMES`.
- **Proof.** Save the team text before the click and after the standby line under `.cursor/skills/verify-local-party-console/evidence/team-view-standby/`. The heading text must match exactly.

## Gotchas

- `browser open log:team-1` opens the boot room. If the host used `browser open screen`, that boot room is the wrong room. The team tab then never follows the host's `SUMO DASH` click.
- Select the holistic tab before `team:team-1`. The command copies the host token from the selected screen tab.
- A team tab does not take `party-sim-<room>`. Do not expect `START` on that tab to start the match.
- Click `SUMO DASH` on the holistic tab. The same button on the team tab does not mount the game.
- A screen tab opened after a player joined can show an empty player list. The relay does not push the current roster on connect. The standby line does not depend on that list.
- The badge `VIEW // TEAM 1` remains above the standby line. The standby text is the `h1`.
