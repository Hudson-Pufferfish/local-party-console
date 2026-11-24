# Rematch

Rematch lets the host play the same match again or return to the lobby after the match ends. The buttons `PLAY AGAIN` and `RETURN TO LOBBY` are visible only then.

## Sub-features

- `rematch-hidden` keeps both buttons off the screen during the lobby and during play.
- `rematch-podium` shows both buttons on the holistic screen when the match is over.
- `rematch-again` hides the buttons and keeps the match canvas.
- `rematch-lobby` returns to the same room code and the lobby.

## How to get to it (user POV)

- Start a Sumo Dash match with two players. See [Start Sumo Dash](./start-sumo-dash.md).
- Play until the match ends. The controller shows the score.
- On the host screen, tap `PLAY AGAIN` or `RETURN TO LOBBY`.

## Driving it with verify.mjs

Preconditions:

- `doctor` prints `ok`.
- The holistic tab is primary and a match is on screen.
- The match has ended, so `PLAY AGAIN` is already visible. This harness cannot drag `MOVE`, so it cannot finish the match by itself.

- **Confirm the buttons are absent first.** During the lobby or just after `START`, run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser text`. The text does not contain `PLAY AGAIN` or `RETURN TO LOBBY`. That observation is not a rematch pass.
- **Wait for the podium.** When the match has ended, run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser wait-text "PLAY AGAIN" --timeout 15000` on the holistic tab. The text also contains `RETURN TO LOBBY`. If the wait times out, report the missing podium and the reason: the harness has no joystick drag, and fewer than two humans cannot finish a match. Stop. Do not call `playAgain` from the console.
- **Play again.** Run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser click --text "PLAY AGAIN"`. The two buttons leave. The match canvas remains. The room does not change.
- **Return to the lobby.** Reach the podium again, then run `.cursor/skills/verify-local-party-console/scripts/verify.mjs browser click --text "RETURN TO LOBBY"`. The text contains `ROOM`, the same room code, `PLAYERS`, and `GAMES`.
- **Proof.** Save the podium text and the lobby text under `.cursor/skills/verify-local-party-console/evidence/rematch/`. Both files must contain the same room code.

## Gotchas

- The buttons are not in the DOM until the match ends. A lobby screenshot does not prove rematch.
- The controller shows the score. The match ends when a score reaches 5. A short drive will not get there.
- `browser click` clicks a button. It does not drag the `MOVE` joystick. Report the podium as not reached when the buttons are absent.
- Only the primary holistic tab shows the buttons. A team tab stays on the standby line for this game.
- `PLAY AGAIN` keeps the room. A new room code means the page created a room instead of restarting the match.
