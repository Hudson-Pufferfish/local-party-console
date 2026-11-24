---
phase: 6
title: "Sumo plugin and acceptance"
status: todo
priority: P1
effort: 6h
dependencies: [2, 4, 5]
---

# Phase 6: Sumo plugin and acceptance

## Goal

Register `sumo-dash` as the first game. The primary screen renders it with Phaser 4. Phones morph to the Sumo layout on `game:mount`. The Day-1 checklist is the exit gate.

## Context

- `games-spec/README.md` lines 11–13 and 62–84
- `sumo-dash.md` lines 11–36, 84–100, 181–185, and 247–265
- `SPEC.md` lines 111–120
- Phases 2, 4, and 5

## Overview

Priority P1. This phase is the plugin plus a human checklist. It does not add a new physics test. Phase 2 already covers the invariants.

## Key Insights

- The renderer reads the float buffer. It never writes positions back into the sim.
- Hit-stop skips draws while `hitStopFrames > 0`. The host loop still calls `step`.
- `view=team-1` never constructs `SumoDashRenderer` (`INV-8`).
- The checklist line about an automatic 30Hz cap is not a task. Confirm the warning pill instead.

## Requirements

- Manifest object equals the literal in `sumo-dash.md` lines 15–35, including `supportsBots: false` and `inputBufferMode: 'zero-buffer'`.
- `screen/src/register-games.ts` registers that manifest and the Phaser factory.
- `controller/src/register-games.ts` registers a landscape layout: joystick on the left, one `DASH` button on the right (bit 0), `PlayerBadge` on a slim top bar.
- Dash cooldown on the phone is a CSS transition of 1.5s started on press. No extra socket event is required for the bar.
- `sumo:haptic` with intensity `heavy` or `out` calls `navigator.vibrate(25)` when the API exists.
- Theme tokens from the manifest are set on the screen root and the controller root when the game mounts.
- Procedural Phaser graphics only. Putty `#EAE6DF`, plate `#D6D1C7`, 4px `#111111` rim, puck border 3px, hard shadow offset `(5, 5)`, nose wedge, cooldown arc. Camera shake is at most 8px. Sparks are squares.
- Match-over podium shows Play Again and Return to Lobby. Those controls send `sumo:rematch`.

## Architecture

Renderer options:

```typescript
export function createSumoRenderer(canvas: HTMLCanvasElement, readState: () => Float32Array): { draw(): void; destroy(): void }
```

`draw` reads the current buffer. On a mirror tab, `readState` returns the snapshot copy. On the primary tab, it returns `sim.state`. One code path.

Standby keeps the Phase 4 component. The factory is not called.

Controller factory returns the Solid tree from Phase 5 primitives. Score and `ALIVE` / `OUT` come from relayed `sumo:round_end`, `sumo:elimination`, and `sumo:round_start`.

## Files to Create / Modify

- Create: `games/sumo-dash/src/manifest.ts`
- Create: `games/sumo-dash/src/manifest.test.ts`
- Create: `games/sumo-dash/src/renderer.ts`
- Create: `games/sumo-dash/src/controller-view.tsx`
- Create: `games/sumo-dash/src/events.ts` with `eventsFromHeaderDiff(prev, next)`
- Modify: `screen/src/register-games.ts` and `controller/src/register-games.ts` (created in Phases 4 and 5)
- Modify: `screen/src/host-loop.ts` so it calls `eventsFromHeaderDiff` and sends the returned envelopes
- Modify: `screen/src/app.tsx` so the clear canvas is replaced by the Phaser draw
- Add `phaser@4` to `games/sumo-dash` and `screen`. Do not add `phaser` to `server` or `controller`.

## Tests Before

Change R. One test. Import `SUMO_DASH_MANIFEST`. Expect `id === 'sumo-dash'`, `viewConfig.mode === 'holistic'`, `viewConfig.inputBufferMode === 'zero-buffer'`, `supportsBots === false`, `minPlayers === 2`, `maxPlayers === 8`.

Write it red, then add the manifest object.

Do not add a Phaser render test and do not add a bot test.

## Refactor

1. Replace the Phase 4 clear with `draw` once it paints the plate and the pucks. Pass the Solid canvas ref into the Phaser game config. Do not let Phaser append its own canvas.
2. Keep `createSim` pointed at Phase 2. Do not fork a second sim for the renderer.
3. Apply theme tokens by setting CSS variables. Do not introduce a second theme engine.

## Tests After

No extra automated tests.

## Implementation Steps

1. Land Change R.
2. Implement the Phaser renderer against a fake float buffer in a manual browser pass, then wire `readState`.
3. Implement the controller view and both `register-games.ts` files.
4. Run the checklist below on the M4 host. Record pass or fail under this phase's Todo by editing the checkboxes when the run happens. A failed row stops the claim that v1 is done.

## Checklist

- [x] pass. `corepack pnpm -r test` passed. Shared 8 tests, screen 1, server 3, sumo 9, controller exit 0.
- [x] pass. 2026-11-24 01:08 rerun: mkcert 1.4.4 is installed. `certs/dev.pem` covers `localhost`, `127.0.0.1`, and `10.0.0.72`. `corepack pnpm --filter @server dev` listens on `0.0.0.0:8443`. Curl with the mkcert CA got `{"lanIp":"10.0.0.72","port":8443}` from `/api/host`, and 200 from `/screen/` and `/controller/`. Dock Ethernet `en7` was inactive, so the address is Wi-Fi. `mkcert -install` did not trust the system store: sudo needs a Mac password. Headless Chrome without an ignore-cert flag saved an empty document.
- [x] fail. No phone trusted the mkcert root. Wake Lock was not granted.
- [x] fail. Two phones did not join. Slot restore was not observed.
- [x] fail. Headless Chrome showed `START` disabled with zero players. Two players were not seated, so the enabled state was not observed.
- [x] fail. Holistic lobby showed `SUMO DASH` and no match canvas. Team-1 showed `VIEW // TEAM 1`, `SUMO DASH`, and no 800px canvas. `STANDBY // THIS GAME USES HOLISTIC VIEW` was not observed, because `game:mount` needs the relay.
- [x] fail. A phone dash was not played.
- [x] fail. A phone leave and rejoin was not played.
- [x] fail. The phone page was HTTP Vite only. `isSecureContext` was not true.
- [x] fail. No DataChannel was opened.
- [x] fail. Binary `ws` fallback was not timed.
- [x] fail. Low Power Mode was not used. The warning pill exists from Phase 5. This run did not show it on a phone.
- [x] fail. iPhone Safari and Android Chrome were not used.
- [x] fail. A match was not played to 5 wins. The podium buttons are in the screen shell and send `sumo:rematch`.
- [x] pass. The lobby and the phone waiting page have no Tab HUD, bot toggle, or flight-recorder control. App source under `screen/src`, `controller/src`, and `games/sumo-dash/src` does not use `SharedArrayBuffer`.

## Todo

- [x] pass. Change R went red (`Cannot find module './manifest'`), then green.
- [x] pass. The renderer reads the float buffer and does not write it. A fake buffer painted putty `234,230,223`, plate `214,209,199`, and puck `255,77,0`.
- [x] fail. The phone view is registered for `game:mount`. A live morph was not observed. The waiting page stayed on `NO GAME` because the relay was down (`LINK // DOWN`).
- [x] pass. Checklist rows are filled with pass or fail.
- [x] pass. `server/src` has no import from `games/` or `phaser`.

## Verification

Regression gate: `pnpm -r test`

Browser gate: the checklist. There is no automated multi-phone run in v1.

## Success Criteria

- The manifest test passes and the full test script passes.
- Two humans can finish a round on one TV.
- A team view stays on standby.
- The checklist's transport rows have a recorded result.

## Risk Assessment

- Phaser 4's API may differ from older examples in the skills. Read the installed type declarations before calling scene or graphics APIs. Do not import `phaser/arcade` or `phaser/matter`.
- Allocation inside `draw` is acceptable. Allocation inside `step` or `pointermove` is not. If the checklist's devtools pass shows heap growth on the phone during a held joystick, move that allocation to startup.
- The motion-to-photon targets in `sumo-dash.md` lines 116 are measured by hand from the 8-byte fields plus host logs. v1 does not draw the Stretch 1 HUD. A failed target is a logged number, not a reason to build the HUD.

## Security Considerations

- Theme tokens are a fixed object from the manifest. Do not apply arbitrary CSS from the wire.
- `navigator.vibrate` is called only for the known intensity strings.

## Next Steps

Stop. Stretch work is a later plan. The next execution command is `/ak:cook` on this plan after Hudson accepts it.
