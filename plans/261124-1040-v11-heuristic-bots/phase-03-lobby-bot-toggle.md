---
phase: 3
title: "Lobby bot toggle"
status: todo
priority: P1
effort: "2h"
dependencies: [2]
---

# Phase 3: Lobby bot toggle

<!-- Updated: Validation Session 2 - host bot-count toggle replaces auto-fill -->

## Goal

The host sets the bot count from the lobby. The screen shows the over-cap banner and the one-human warning from `startNotice`. The buttons call `nextBotCount`. They do not grow a second rule.

## Context

- Phase 2 helpers and the session `setBotCount` / `setBotLobby` binding
- `screen/src/lobby.tsx` (player list, `.notice`, Start button with `class="key"`)
- `screen/src/app.tsx` lobby branch (lines 85–100) and the match branch with Play Again and Return to Lobby (lines 112–120)
- `screen/src/styles.css` lines 82–86: `.notice` uses `text-transform: uppercase`
- SPEC.md Part 4: six `/shared/ui` primitives. This phase adds no seventh
- SolidJS 2. `Lobby` is already a `VoidComponent`

## Overview

Priority P1. Status todo. Depends on Phase 2. The component renders props. The session owns the count, the lock, and Start.

## Key Insights

- The lobby unmounts while a match is on screen. The lock inside `nextBotCount` still ignores a late `setBotCount`.
- `.notice` already uppercases text. The helper stores Hudson's sentence. The screen shows the uppercase form. Cook does not edit `styles.css` to change that case.
- Minus and plus use the same `button.key` control as Start. `ArcadeButton` is the phone press control. The lobby does not import it.
- `botControlEnabled` is false when the connected human count is 0 or the selected manifest has `supportsBots: false`. The buttons use the `disabled` attribute. The click handler also returns when the control is disabled.

## Requirements

- Show the control only when the selected game has `supportsBots: true`.
- The label shows the integer `botCount`. A new room shows 0.
- Minus requests `botCount - 1`. Plus requests `botCount + 1`. Both go through `session.setBotCount`.
- Zero humans: both buttons are disabled. The notice is `need minimum one real player` when that is the start reason.
- Over cap: Start is disabled. The notice is `exceed max — modify bot count`.
- Below `minPlayers`: Start is disabled. The notice stays empty.
- Return to Lobby shows the last count and enables the buttons when at least one human is connected.
- Play Again does not open the lobby and does not change the frozen count.
- No bot names in the player list. No mode picker.

## Architecture

Add these props to `Lobby`:

```typescript
botCount: number;
botControlEnabled: boolean;
botNotice: string;
onBotStep: (delta: -1 | 1) => void;
```

Render a short row under the games panel: a minus `button.key`, a `span.mono` with `botCount`, and a plus `button.key`. Render `botNotice` with the existing notice element when the string is not empty. Keep the room notice and the SDP notice as they are.

`app.tsx` passes:

- `botCount` from the session state
- `botControlEnabled`: selected game `supportsBots` and the connected human count is greater than 0
- `botNotice`: `startNotice(startBlockReason(...))` with the same humans, count, and manifest the memo uses for Start
- `onBotStep`: `(delta) => session.setBotCount(botCount + delta)`

`startEnabled` stays the Phase 2 roster check. The button `disabled` flag stays `!props.startEnabled`.

## Related Code Files

- Modify: `screen/src/lobby.tsx` (count row and notice text)
- Modify: `screen/src/app.tsx` (the four `<Lobby>` props)

Do not modify `screen/src/bot-fill.ts`, `screen/src/host-loop.ts`, `screen/src/styles.css`, `controller/src/**`, `server/**`, `shared/**`, or `games/sumo-dash/**`. A missing prop is a Phase 2 gap. Stop and fix the binding. Do not copy the start rule into `lobby.tsx`.

## Implementation Steps

1. Confirm Phase 2 tests are green: `corepack pnpm --filter @screen test`.
2. Add the four props and the count row in `lobby.tsx`. Pass them from `app.tsx`.
3. Re-run `corepack pnpm --filter @screen test` and `corepack pnpm --filter @screen exec tsc --noEmit`.
4. Eyeball the checklist below on the host screen. The pure rows already lock the reasons. This pass checks that the buttons and the notice are wired.

## Eyeball checklist

Do this on the primary `/screen` tab after Phase 1 has set `supportsBots: true`.

- [ ] A fresh lobby shows bot count 0. One phone alone leaves Start disabled and the bot notice empty.
- [ ] With zero phones, minus and plus do nothing and are disabled.
- [ ] One phone, plus once: count 1, Start enables.
- [ ] Four phones and count 4: Start enables.
- [ ] A fifth phone: Start disables. The notice reads the over-cap sentence in uppercase.
- [ ] Minus once from that state (count 3 with five phones): Start enables. The over-cap notice clears.
- [ ] Plus while four phones already hold count 4: the count stays 4.
- [ ] One phone and count 2, then that phone leaves: Start disables. The notice reads the one-human sentence. The count stays 2. The buttons are disabled.
- [ ] Start a match at one phone and one bot. The lobby is gone. Disconnect the phone during the match. The bot puck keeps moving. No extra puck appears.
- [ ] Play Again keeps two slots in that match. Return to Lobby shows count 1 and enables the buttons while the phone is connected.
- [ ] The player list has phone rows only.

## Todo

- [ ] Count row uses `button.key` and `span.mono`
- [ ] Notice uses `startNotice` and the existing `.notice` class
- [ ] Disabled buttons when the human count is 0
- [ ] Eyeball checklist done

## Success Criteria

- `corepack pnpm --filter @screen test` exits 0.
- `corepack pnpm --filter @screen exec tsc --noEmit` exits 0.
- The lobby file contains no `minPlayers` check and no `rosterForStart` call.
- The eyeball checklist is complete.

## Risk Assessment

- Stretch 1 mounts `<TabHud>` beside `<Badge>` in `app.tsx`. This phase edits the `<Lobby>` element only. Leave the Badge line alone.
- A second start rule inside the component will drift from `bot-fill.ts`. Signal: the button enables while `rosterForStart` is `null`, or the notice string is written by hand in `lobby.tsx`. Response: pass `botNotice` from the parent.

## Security Considerations

The control only calls the host session. It does not send a bot count to the phone and it does not trust a bot count from a packet.

## Stop if

- The screen test goes red after the prop wiring.
- The fix wants a new shared primitive, a CSS edit, or a copy of `startBlockReason` inside `lobby.tsx`.

## Next Steps

Cook stops. The eyeball checklist is the manual gate for the toggle.
