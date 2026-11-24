---
phase: 2
title: "Host bot count"
status: todo
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: Host bot count

<!-- Updated: Validation Session 2 - host bot-count toggle replaces auto-fill -->

## Goal

The host chooses how many bots to add. Start follows Assumption L1. Each chosen bot reaches `applyInput` through `writeHeuristic`.

## Context

- Phase 1 `writeHeuristic`
- Assumption L1, L3, and R1 in `plan.md`
- The test matrix in `plan.md` (rows 1–14 and 16–18)
- `screen/src/host-loop.ts` lines 138–160 (joined slots call `applyInput`, then `step`)
- `screen/src/session.ts` `begin`, `start`, `playAgain`, and `returnToLobby` (lines 225–239 and 285–305)
- `screen/src/app.tsx` `startEnabled` (lines 66–74)
- `screen/src/register-games.ts` `ScreenGame`
- `shared/src/view/policy.ts` `canStart` stays the human rule
- `games/sumo-dash/src/manifest.ts`: `minPlayers: 2`, `maxPlayers: 8`

## Overview

Priority P1. Status todo. Depends on Phase 1. The screen shell stays game-agnostic: it calls a writer registered on `ScreenGame`. Sumo math stays in `games/sumo-dash`. Lobby chrome waits for Phase 3. This phase ships the pure rules and the session calls.

## Key Insights

- `applyInput` returns immediately when the slot was not passed to `startMatch`. A bot index has to be in that list.
- The tick loop already calls `applyInput` for every joined slot, then `step(1/120)`. One new branch at the top of that slot loop is enough.
- `state[0]` is `tickId`. `step` increments it after input is applied. Even `tickId` runs the policy (60Hz at a 120Hz step). Odd `tickId` repeats the last Int8 sample, then still calls `applyInput`.
- `playAgain` also calls `startMatch`. It has to pass the frozen bot count or a rematch drops the bots.
- `canStart` stays `connectedCount >= minPlayers`. The bot start rule lives in `bot-fill.ts` so `shared/` stays unchanged.
- `applyPlayers` runs when phones join and leave. It must not write `botCount` and must not rebuild the armed mask.

## Requirements

- Assumption L1. Default count is 0. The count changes only through `nextBotCount`. Zero connected humans makes that call a no-op. Start needs at least one connected human, `humans + bots >= minPlayers`, and `humans + bots <= maxPlayers`.
- A requested count above `maxPlayers - humans` is rejected. The stored count stays put. `clampBotCount` reports the legal ceiling.
- A human join or leave does not change `botCount`. Over cap disables Start. The host clears it by requesting a lower count.
- An index that already has a player record, including `connected === false`, is not free.
- Start sets `locked` true. `nextBotCount` then returns the frozen count. `playAgain` uses that count with the humans still connected. `returnToLobby` sets `locked` false and keeps the count. A new session starts at 0.
- A human leave during a match does not add a bot bit. The human slot still uses the silence path.
- A bot slot calls `applyInput` with the policy sample. A human slot keeps the existing silence and dash-latch path.
- The policy runs on even `tickId` only. Both parities call `applyInput` for bot slots.
- `supportsBots === false` places no bots and ignores count requests.
- One `it` per matrix row. Write the file before `bot-fill.ts` exists.

## Architecture

`ScreenGame` gains an optional field:

```typescript
writeBotInput?: (
  state: Float32Array,
  botIndex: number,
  axisX: Int8Array,
  axisY: Int8Array,
  buttons: Uint8Array,
) => void;
```

`register-games.ts` sets it to `writeHeuristic` for `sumo-dash`.

`bot-fill.ts` exports the helpers below and `createBotFill`.

```typescript
export type BotLobbyState = { botCount: number; locked: boolean };
export type StartBlock = 'no-human' | 'below-min' | 'over-cap';

export function createBotLobby(): BotLobbyState
export function lockBotCount(state: BotLobbyState): BotLobbyState
export function unlockBotCount(state: BotLobbyState): BotLobbyState
export function clampBotCount(requested: number, humans: number, maxPlayers: number): number
export function nextBotCount(
  state: BotLobbyState,
  requested: number,
  humans: number,
  maxPlayers: number,
  supportsBots: boolean,
): BotLobbyState
export function startBlockReason(input: {
  humans: number;
  bots: number;
  minPlayers: number;
  maxPlayers: number;
  supportsBots: boolean;
}): StartBlock | null
export function startNotice(reason: StartBlock | null): string
export function rosterForStart(
  players: readonly PlayerSlot[],
  manifest: { minPlayers: number; maxPlayers: number; supportsBots: boolean },
  botCount: number,
): { slots: number[]; botMask: Uint8Array } | null
export function botMaskAfterHumanLeave(mask: Uint8Array, humanSlot: number): Uint8Array
```

Rules:

- `createBotLobby` returns `{ botCount: 0, locked: false }`.
- `lockBotCount` returns the same count with `locked: true`. `unlockBotCount` returns the same count with `locked: false`.
- `clampBotCount` truncates to an integer and returns a value in `0 .. max(0, maxPlayers - max(0, humans))`.
- `nextBotCount` returns `state` when `locked` is true, when `humans <= 0`, or when `supportsBots` is false. When `requested` is greater than `clampBotCount(...)`, it returns `state`. Otherwise it stores the clamped value and keeps `locked` false.
- `startBlockReason` uses `bots` only when `supportsBots` is true. Otherwise it uses 0. Order: humans `<= 0` returns `no-human`; else `humans + bots > maxPlayers` returns `over-cap`; else `humans + bots < minPlayers` returns `below-min`; else `null`.
- `startNotice` returns `exceed max — modify bot count` for `over-cap`, `need minimum one real player` for `no-human`, and `''` otherwise. Export those two sentences as constants too.
- `rosterForStart` returns `null` when `startBlockReason` is not `null`. It collects connected indices in player-list order. Every player record is occupied, connected or not. When the flag is true it appends the lowest free indices until it has placed `botCount` bots. It returns `null` when a free index is missing. It returns `null` when a slot index is outside `0 .. maxPlayers - 1`. The mask is length 8. Bot slots are 1. Human slots and empty slots are 0.
- `botMaskAfterHumanLeave` returns a copy of the mask. It does not set a new 1 bit. A human slot that was 0 stays 0.

`createBotFill(write)` allocates three length-8 arrays once (`Int8Array`, `Int8Array`, `Uint8Array`) and one `Uint8Array` mask. `arm(mask)` copies eight bytes. `fill(slot, sim)`:

1. Return `false` when `botMask[slot] !== 1`.
2. When `(sim.state[0] & 1) === 0`, call `write`.
3. Call `sim.applyInput(slot, buttons[slot], axisX[slot], axisY[slot])`.
4. Return `true`.

`fill` allocates nothing. `arm` is the only mask write after Start. Player updates do not call `arm` again.

`createHostLoop` gains an optional fourth argument, `fillBot?: (slot: number, sim: ScreenSim) => boolean`. Inside `tick`, after the `joined[slot] === 0` continue:

```typescript
if (fillBot !== undefined && fillBot(slot, sim)) continue;
```

The rest of the slot body stays as it is. A bot slot skips the silence path because `fill` already called `applyInput`.

Session owns one `BotLobbyState`, created with `createBotLobby`. Add a handler `setBotLobby` so the screen can render the count in Phase 3.

- `setBotCount(requested)` calls `nextBotCount` with the connected human count and the selected manifest. Then it publishes the state.
- `start` builds `rosterForStart(players, manifest, state.botCount)`. A `null` roster returns before `startMatch`. Otherwise `lockBotCount`, `arm`, then `startMatch(roster.slots)`.
- `playAgain` calls `rosterForStart` with the locked count and the current connected players, then `arm` with that mask. A `null` roster returns before `startMatch`. It does not unlock. The in-match tick does not call `rosterForStart` or `arm` again.
- `returnToLobby` calls `unlockBotCount` and then the existing `release` path.
- `applyPlayers` does not call `nextBotCount`, `rosterForStart`, or `arm`.
- The loop is created once with `(slot, sim) => bots.fill(slot, sim)`. `begin` still refuses a null game or a non-primary tab. The roster check replaces the `canStart(slots.length, ...)` gate inside `begin`, because `slots.length` will include bots. `canStart` in `shared/` stays as it is.

`app.tsx` `startEnabled` returns false when the tab is not primary or the game is missing. Otherwise it returns `rosterForStart(players(), game, botCount) !== null`. Read `botCount` from the session state. Phase 3 adds the buttons. This phase may publish the state without rendering the control.

## Related Code Files

- Create: `screen/src/bot-fill.ts`
- Create: `screen/src/bot-fill.test.ts`
- Modify: `screen/src/host-loop.ts` (fourth argument and one `if` in the slot loop)
- Modify: `screen/src/register-games.ts` (optional `writeBotInput`)
- Modify: `screen/src/session.ts` (`setBotCount`, `start`, `playAgain`, `returnToLobby`, and the `createHostLoop` call)
- Modify: `screen/src/app.tsx` (`startEnabled` memo, and a `setBotLobby` binding if the memo needs the count)

Do not modify `screen/src/lobby.tsx`, `screen/src/styles.css`, `controller/src/**`, `server/**`, `shared/**`, `games/sumo-dash/src/simulation.ts`, or `games/sumo-dash/src/heuristic.ts`.

## Implementation Steps

1. Write `bot-fill.test.ts` first. Import the helpers from `./bot-fill.ts`. Add one `it` for each row below. Use a `PlayerSlot` fixture `{ index, name: '', color: '#111111', teamId: null, connected }`. Use `{ minPlayers: 2, maxPlayers: 8, supportsBots: true }` unless the row says otherwise.
   - `default bot count is 0`
   - `bot toggle is a no-op when no human is connected`
   - `one human and one bot enables start`
   - `one human and zero bots disables start`
   - `four humans and four bots enable start`
   - `fifth human over cap disables start` (also assert `startNotice` and that a join does not call a setter; the count value stays 4)
   - `locked bot count ignores a change`
   - `last human leaving disables start` (count stays 2, notice is the one-human sentence)
   - `bots alone do not enable start`
   - `lowering bots after over cap enables start` (5 humans, stored 4, request 3)
   - `a raise above remaining seats is rejected` (also `clampBotCount(5, 4, 8) === 4`)
   - `play again keeps the frozen count and the lobby unlocks at that count` (locked roster uses the frozen count; `unlockBotCount` keeps it; a new `createBotLobby()` is 0)
   - `a human leave during a match does not add a bot`
   - `a second human does not change the bot count` (state stays `{ botCount: 1, locked: false }`; 2 humans + 1 bot has reason `null`)
   - `an away slot stays occupied`
   - `supportsBots false adds no bots`
2. Run `corepack pnpm --filter @screen test`. The new tests fail because `bot-fill.ts` is missing.
3. Implement the helpers until those `it` blocks pass. Do not weaken an assertion to match a different rule.
4. Extend the same file with `it('bot fill calls applyInput')`. Do not fold it into another `it`.
   - `createSumoSimulation()`, `startMatch([0, 1])`, set slot `1` `x` to `340` and `y` to `0`.
   - `createBotFill(writeHeuristic)`, `arm` the one-human one-bot mask, `fill(0, sim)` is `false`.
   - `fill(1, sim)` is `true`. Slot `1` angle (`state[22]`) is near `Math.PI` because countdown `applyInput` stores aim and the policy steers to `-X`.
5. Re-run the screen tests. Then add the `host-loop.ts` branch, the registry field, and the session and `startEnabled` call sites.
6. Re-run screen tests and `tsc`. Confirm `heuristic.ts` is unchanged. Confirm `applyPlayers` does not call `nextBotCount`, `rosterForStart`, or `arm`.

## Todo

- [ ] Failing matrix tests exist and fail on the missing module
- [ ] Rows 1–14 and 16–17 pass on the pure helpers
- [ ] Bot `fill` calls `applyInput`; human slot returns false
- [ ] `host-loop.ts` has one `fillBot` call and the silence path is unchanged
- [ ] `start` locks the count, `playAgain` reuses it, `returnToLobby` unlocks it
- [ ] `applyPlayers` does not change the count or the armed mask

## Success Criteria

- `corepack pnpm --filter @screen test` exits 0.
- `corepack pnpm --filter @screen exec tsc --noEmit` exits 0.
- `corepack pnpm --filter @games/sumo-dash test` still exits 0.
- `git diff -- screen/src/host-loop.ts` shows the new parameter and one `fillBot` call. The silence and latch branches are still there.
- `rg -n "nextBotCount|rosterForStart" screen/src/session.ts` shows `setBotCount`, `start`, and `playAgain`. `applyPlayers` does not call those helpers or `arm`.
- `rg -n "ONNX|Heuristic" screen/src/lobby.tsx controller/src` prints nothing. Phase 3 is the first lobby edit.

## Risk Assessment

- Stretch 1 may also edit `session.ts` or `app.tsx` for the Tab HUD. This phase touches `setBotCount`, `start`, `playAgain`, `returnToLobby`, `createHostLoop`, and the `startEnabled` memo. A HUD belongs in a new component. Merge this branch first if both diffs touch `host-loop.ts`.
- Signal that Assumption L1 broke: a human join changes `botCount`, Start enables with zero humans, 4+4 stays disabled, or 5+4 stays enabled. Response: change the helpers and the matching `it` only.
- Signal that Assumption R1 broke: the policy runs on every 120Hz substep and a dash edge fires twice. Response: keep the even-`tickId` sample. `applyInput` already edges bit 0 once per press.
- A + press while the count is already over cap must not store `clampBotCount` in place of the rejected request. That would hide the banner without a host action.

## Security Considerations

The bot mask is built on the host from the roster. Do not read a bot bit from a phone packet or from a new websocket field. A phone still owns only its joined slot.

## Stop if

- A matrix `it` stays red after the helpers match L1.
- The host-loop diff grows past the one `fillBot` branch.
- A fix wants an ONNX picker, an edit under `controller/src`, a change to `canStart`, or a new `/shared/ui` primitive.

## Next Steps

Phase 3 binds the helpers to the lobby control. The manual check waits until that control exists.
