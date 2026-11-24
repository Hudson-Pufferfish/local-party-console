# Phase 5 progress

Status: done.

## Completed

- Reconciled the coordinator checkpoint. Phase 4 is accepted. No continuation handoff. `controller/` had a package file only.
- Change P went red (`Cannot find module './quantize'`), then green. `quantizeAxis(1)` is `127`, `quantizeAxis(-1)` is `-127`, `quantizeAxis(0)` is `0`, and `quantizeAxis(2)` is `127`.
- Change Q went red (`Cannot find module './preflight'`), then green. `classifyPower([16, 16, 32])` is `low-power`. `classifyPower([16, 16, 16])` is `ok`. An empty list returns `ok`.
- The controller is SolidJS 2. Pins match the screen: `solid-js@2.0.3`, `@solidjs/web@2.0.3`, `@solidjs/vite-plugin@3.0.1`.
- Six primitives live in `shared/src/ui` and export from `@shared/ui` with a browser condition only. `server/tsconfig.json` still includes `src` only.
- The phone page shows the name field, the three pre-flight pills, and the six primitives. `controller/src/register-games.ts` is an empty map. A `game:mount` whose id is missing from that map stays on this screen. Theme tokens come from the local manifest. Unknown CSS keys are ignored. A `roomId` on `game:mount` that does not match the joined room is ignored.
- One module `ArrayBuffer(8)` and one `DataView` feed `encodeInto`. `pointermove` calls `sendFastInput` before it writes the cap transform. The only `requestAnimationFrame` loop collects 10 deltas and then stops.
- `net:ping` is not in the relay's handled set. Unknown text falls through to `fanOut`. The server does not answer it. No server edit.

## Checks

- `corepack pnpm --filter @shared test`: 7 files, 8 tests, exit 0.
- `corepack pnpm --filter @controller exec tsc --noEmit`: exit 0.
- Headless Chrome at `http://127.0.0.1:5175/controller/?room=ABCD`: room `ABCD`, badge, `POWER OK 10`, `WI-FI WAIT`, `ORIENTATION TURN` with the warning fill, and an enabled `JOIN`. Typed name `Ada` showed on the badge. `BUTTON` set `data-pressed` and cleared the 6px shadow. The joystick cap moved to `translate3d(27px, 0px, 0px)` and returned home. Body font was `"Space Grotesk"`. Button padding was `36px`.
- The same page at 390×667 kept `STATUS` inside the shell (`actions` bottom 631, client height 667). At 390×844 the pad was 305px tall and the actions sat at 808.
- `LINK // DOWN` appeared because this Vite server is HTTP and the phone opens `wss://`. No `certs/dev.pem`, so the Fastify origin was not started. DataChannel and binary `ws` were not observed against the host.
- Advice was not requested. No cook gate needed a decision.
- Review was inline. This task does not allow subagents.
- Step 3.S was skipped. This folder is not a git repo.
- AgentWiki publish skipped.

## Remaining acceptance

- The screen does not answer `net:ping`, so the `WI-FI` pill stays `WAIT` until some peer sends `net:pong`. The phone sends two pings and answers a ping with `net:pong`.
- A joined phone's 8-byte frame was not captured on the Phase 4 host. The send path writes the codec layout and chooses `dc`, `wait`, `drop`, or `ws`. Proving it on the LAN needs the mkcert certs in `server/README.md`.

## Non-blocking suggestions

- Add a screen echo: on `net:ping`, send `net:pong` with the same `t`. That fills RTT and the second sample fills jitter. It is outside this phase's write scope.
- The Space Grotesk package has no weight 800 file. CSS asks for 800 and loads `700.css`. Same as Phase 4.
- Chrome's used border width for `2.5px` was `2px` in this headless run. The stylesheet still says `2.5px`.
