# Start Sumo Dash

Start Sumo Dash lets the host select the game and start the match. The controller leaves the waiting card when the game is selected. The match canvas replaces the lobby only after `START`. `START` stays off until two players are `LIVE`.

## Sub-features

- `start-select` marks `SUMO DASH` pressed and mounts the controller.
- `start-blocked` leaves `START` disabled when fewer than two players are `LIVE`.
- `start-match` replaces the lobby with the match canvas after two players join and the host taps `START`.

## How to get to it (user POV)

- On the host screen, tap `SUMO DASH`.
- On two phones, tap `JOIN`.
- On the host screen, tap `START`.
- v1 has no bots. A single phone cannot fill the second seat.

## Driving it with verify.mjs

Preconditions:

- `doctor` prints `ok`.
- The holistic tab is the only holistic tab for this room, so it holds the sim lock.
- One player may already be `LIVE` from [Phone join](./phone-join.md).
- A second `LIVE` player requires a second browser profile. This harness starts one profile.

- **Select the game.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab use "room=<code>&view=holistic"`. Then run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser click --text "SUMO DASH"`. `browser facts` shows `SUMO DASH` with `pressed` `true`. The screen still shows `ROOM` and `START`.
- **Read the phone.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab use "controller?rev=4&room=<code>"`. The text contains `ALIVE 0`, `MOVE`, and `DASH`. It does not contain `NO GAME`.
- **See START stay off.** Return to the holistic tab. With one `LIVE` player, `START` is `disabled`. Stop here when you have only this Chrome profile. Report the missing second player. Do not call the click a start.
- **Start with two players.** When two names show `LIVE`, `START` is enabled. Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser click --text START`. The lobby headings `PLAYERS` and `GAMES` leave. A match canvas is on screen. `PLAY AGAIN` is absent.
- **Proof.** Save the disabled-start facts when the second player is missing. Save the post-start text only after `START` succeeds. Put both files in `.cursor/skills/verify-local-party-console/evidence/start-sumo-dash/`.

## Gotchas

- Selecting `SUMO DASH` mounts the phone UI. It does not start the match. The lobby remains until `START`.
- `START` checks the connected count, the selected game, and the sim lock. A holistic tab that lost `party-sim-<room>` keeps `START` disabled.
- One profile cannot seat two humans. The second tab reuses `party-session-<room>`. Report that precondition. Do not add a bot.
- `browser click` does not drag `MOVE`. You do not need a drag to prove `START`.
- The team tab also has a `SUMO DASH` button. Click it only on the holistic tab. A team tab is not primary and does not mount the game.
