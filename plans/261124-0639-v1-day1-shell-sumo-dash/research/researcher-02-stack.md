# Researcher 2 — stack constraints for an empty tree

## Layout

`SPEC.md` line 30 names `/shared`, `/server`, `/screen`, and `/controller`. `sumo-dash.md` line 3 names `/games/sumo-dash`. `sumo-dash.md` line 13 imports `GameManifest` from `@shared/types`. The packages use those directory names and that import path.

There is no existing app code, so nothing is reused. Do not generate a second layout under `packages/`.

## Versions named by the repo

- Solid: `solid-js@2.0.3` and `@solidjs/web@2.0.3` (`.agents/skills/solidjs-v2/SKILL.md` line 8).
- Vite plugin: `@solidjs/vite-plugin` 3.x (`.agents/skills/solidjs-v2/references/typescript-setup.md` line 6).
- Styling: Tailwind 4 (AGENTS.md skills table).
- 2D: Phaser 4 as a renderer. No Arcade and no Matter (`AGENTS.md` lines 20–21).
- Server: Node Fastify + the `ws` package.
- Tests: Vitest for the sim and for pure functions. Device checks stay on a checklist (`AGENTS.md` lines 36–42).

## Test budget

At most two new tests per change. Write the failing test before the code it protects (`AGENTS.md` lines 36–38). Phase 2 spreads the Sumo invariant list across separate changes so the budget holds.

## Transport shape

One origin. Fastify listens on `0.0.0.0` with an mkcert certificate. The QR code uses the LAN IPv4 from the server, so a tab opened on `localhost` still prints a phone-reachable URL.

WebRTC peers are browsers. Both sides call `createDataChannel` with `{ ordered: false, maxRetransmits: 0, negotiated: true, id: 0 }` before SDP. `iceServers` is empty. Signaling frames travel on the Fastify `ws` relay.

SDP rewrite keeps the real gathered port. It replaces an mDNS `.local` address with the LAN IPv4. It drops other addresses. A fake port is not inserted.

## Sim purity

`step` takes `dt` and the inputs already stored by `applyInput`. It does not read `Date.now()` or `Math.random()` (`sumo-dash.md` lines 113–114). Silence handling stays in the host loop: the host repeats the last real input for at most 100ms, then applies zeros. A rising edge uses real packets only. The sim stays a pure function of its input stream (`INV-7`, `sumo-dash.md` line 242).
