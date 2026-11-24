# JOIN fix

Status: done.

## Cause

Cause 1 matches the code. `controller/src/peer.ts` queued `sendText` while the socket was not open. `onLink(false)` ran only on `close`. A socket that never opens never closes. JOIN stayed enabled, the message sat in the queue, and the phone showed no `LINK // DOWN`.

The live relay is fine when the socket is open. A screen socket plus `room:join` for `Ada` produced `room:players` with that name. Headless Chrome on `https://10.0.0.72:8443/controller/?room=DHQU` did the same. The badge became `P1` / `ADA`. The screen list was `[{ index: 0, name: "Ada", connected: true }]`.

Cause 2 does not explain a fresh scan. An unknown room already destroys the socket. Room `ZZZZ` closed with code 1006 and the page already showed `LINK // DOWN`. JOIN stayed enabled, so a tap still did nothing. A refresh of `/screen?room=CODE` keeps that room. A new room is created only when the screen URL has no room code.

Cause 3 does not match. Solid 2.0.3 effects use `_equals: false`, so `createEffect(() => undefined, apply)` runs the apply function. Chrome opened `wss://10.0.0.72:8443/ws?room=...&role=controller` and sent `net:ping`. `link` was set.

Cause 4 does not match this path. `pointerdown` on JOIN sent `room:join`. A synthetic `touchstart` with no pointer event does not press the button. A real tap produces a pointer event.

The name badge shows `OPEN` until a name is typed. That is the empty-name label. An empty name can still join. The Mac list then shows `PLAYER`.

## Change

- If the socket is still connecting, `sendText` queues the frame and flushes it on open.
- If the socket errors, closes, or is still unopened after 2 seconds, the phone calls `onLink(false)`.
- The phone shows `LINK // DOWN` and disables JOIN.
- An open socket clears `LINK // DOWN`.
- If `link` was never assigned, JOIN shows `LINK // DOWN` and does not send.

README join order is unchanged. The written steps are still the scan, the controller page, then the game.

## Files

- `controller/src/peer.ts`
- `controller/src/app.tsx`
- `controller/src/peer.test.ts`
- `controller/vitest.config.ts`
- `controller/package.json`
- `shared/src/ui/arcade-button.tsx`

## Check

Command:

```sh
corepack pnpm --filter @controller test
```

Result: 1 file, 1 test, exit 0. The test failed first with `expected [] to include false`.

`corepack pnpm --filter @controller exec tsc --noEmit` exited 0.

Headless Chrome, phone size 390×844, cert trusted:

- Open room `DHQU` after 2.5s: no `LINK // DOWN`, JOIN enabled. Tap JOIN as `Ada`. Screen `room:players` listed Ada. The phone showed `P1` / `ADA` and hid JOIN.
- Room `ZZZZ`: `LINK // DOWN`, JOIN `disabled`.
- A fresh load of both URLs logged no reactive error.

The dev server on port 8443 was already running. This fix did not start it and did not stop it.
