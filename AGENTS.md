# AGENTS.md

## Read first

1. [`specifications/SPEC.md`](specifications/SPEC.md) — platform seams, transport, UI invariants, Day-1 vs Stretch
2. [`specifications/games-spec/README.md`](specifications/games-spec/README.md) — `GameDefinition` contract + game index
3. [`specifications/games-spec/sumo-dash.md`](specifications/games-spec/sumo-dash.md) — when touching that game

Specs are the authority. Do not invent architecture that contradicts them.

## Tooling preference

Prefer **pstack** and **AgentKit** (`ak:*`) skills for multi-step delivery, review, planning, and parallel work. Use the live skill catalog; do not invent absent skills.

Project skills under `.agents/skills/` (stack). **Specs beat skills** when they conflict (especially Socket.IO, Phaser physics, cloud SFU WebRTC).

| Area | Skills | Notes |
|---|---|---|
| UI | `solidjs-v2` (+ migration/reviewer) | Confirm Solid major before applying |
| 2D render | Phaser 4 set (setup, scenes, graphics, cameras, audio, …) | **Renderer only** — no Arcade/Matter for authority |
| 3D render | `threejs-*` + AgentKit `ak:threejs` | No React Three Fiber |
| Server | `fastify-best-practices`, `websocket-development` | Raw `ws`, not Socket.IO |
| Transport | `webrtc`, `game-networking`, `game-state-sync` | Prefer SPEC binary DataChannel + `ws` fallback over SFU/Socket.IO examples |
| Build/test | `vite`, `vitest` | |
| Style | `tailwind-design-system`, `tailwind-4-docs` | Plus SPEC Neo-Brutalism ban list |
| HTTPS / SAB | `caddy`, `cross-origin-isolation` | Local HTTPS + COOP/COEP for Stretch SAB |
| Stretch | `rust-wasm`, `tauri-v2` | WASM physics / optional desktop wrap |
| Verify | Chrome DevTools MCP skills + AgentKit `ak:web-testing` / `ak:agent-browser` / `ak:chrome-profile` | `.cursor/mcp.json` with `--memoryDebugging` |

Intentionally **not** installed: Phaser Arcade/Matter, Telnyx WebRTC, Socket.IO-centric `websocket-engineer` (Critical Risk + SPEC conflict), React Three Fiber.

Do not commit `.cursor/mcp.json` or secrets.

## Writing and tests

- Write prose in ASD-STE100 Simplified Technical English style: short sentences, active voice, simple words, one main idea per sentence. Keep technical names, code, commands, and quoted text exact.
- Write at most 1–2 tests per change, and make each one count. Test real behavior a caller can see. Each test must fail if that behavior breaks. Do not write tests that restate the implementation, mock the code under test, or check trivial details.
- NEVER write unit tests after you write the code under test.
- Prefer two layers of verification, matching the specs:
  - **Isolated sim / hot-path:** FIRST list the ways it can fail (see `sumo-dash` INV-\* and fuzz plan), THEN write the failing tests, THEN write the code. Use Vitest for deterministic physics and binary contracts.
  - **Platform / devices:** Prefer E2E or hardware checklists for lobby, WebRTC/`ws` failover, multi-monitor views, and phone controllers. End with a verifiable, repeatable artifact when practical (log, HUD dump, replay `.bin`).
- Do not treat E2E as the only tool. Do not skip sim unit tests for game physics.

## Implementation principles

- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Ship the smallest version that works end to end (v1 shell + `sumo-dash`), then add Stretch capabilities from `SPEC.md` on top of a product that already works. Never trade a working product for unfinished complexity.
- Day-1 seams in `SPEC.md` (`GameTransport`, `GameSimulation`, `GameDefinition`) are intentional upgrade paths, not throwaway shims. Implement the seam; do not hardcode a Stretch-2 design into Day-1 code.
- **Multi-game from day one in structure, not in scope.** `sumo-dash` is only the first registered game. More games (different genres, Phaser/Three renderers, controller layouts, player/bot caps, `holistic` vs `team-exclusive` views) will be added. Design the Console OS and `GameRegistry` so a new game is a new module + `games-spec/<id>.md` entry — never a fork of platform code. Do not hardcode `sumo-dash` rules, physics, controllers, or camera logic into `/server`, `/screen`, or `/controller`.
- Keep components modular and concerns clearly separated. Games are plugins under `/games/<id>`. Do not leak game logic into shells.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on dependencies already in the project before writing your own implementation or adding packages. Check docs and types before assuming a gap.
- Always follow existing codebase conventions for design style, file structure, patterns, and libraries.
- If you want to add a new dependency, or do something that goes against codebase convention or the specs, discuss with me first. Do not proceed until I agree.
- If you see bad practice in the codebase, tell me. Keep the note short and concrete. Do not silently copy the bad practice into new work.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be rewritten later. Phased Stretch work is allowed only when it sits behind the Day-1 seams.

## Hard rules (from specs)

- Preserve `GameTransport`: reliable control plane (`ws`) vs unordered data plane (WebRTC UDP / binary `ws` fallback).
- v1: one sim in the host Chrome `/screen` tab. That tab is the WebRTC peer. Other monitor tabs are read-only (`BroadcastChannel`). Fastify relays signaling and the binary `ws` fallback. It does not simulate.
- v1 players are human only. Heuristic bots are v1.1. ONNX bots are Stretch 4. Both must call `applyInput`.
- Enforce strict binary view modes (`holistic` vs `team-exclusive`); no hybrid fallbacks inside one game module.
- Respect the Industrial Neo-Brutalism ban list and the six `/shared/ui` primitives in `SPEC.md` Part 4.
- Zero heap allocations on the gameplay hot path (`pointermove` send + `simulation.step`).

## Project context (local-party-console)

- Local party game console: M4 Mac host in Chrome drives the TVs. Up to 8 phones join via QR in Safari or Chrome (no native app).
- Stack (see `SPEC.md`): TypeScript + Vite, SolidJS 2, Tailwind, Phaser 4 / Three.js, Fastify + raw `ws`, WebRTC DataChannel whose peer is the host Chrome tab.
- v1: shell + `sumo-dash` (holistic, zero-buffer, humans only). v1.1 heuristic bots. Stretch 1 HUD and RF timing. Stretch 2 SharedWorker / SAB / WASM. Stretch 3 flight recorder. Stretch 4 ONNX. Do not pull a later phase into v1.
- More games ship later through `GameDefinition` (`games-spec/` index).
- When adding a game: follow `games-spec/README.md` (manifest, sim, renderer, controller), register in the index + `GameRegistry`, keep platform shells game-agnostic.
- Source of truth: `specifications/`. Evergreen setup/ops docs will live under `docs/` when added. Do not treat chat history as authority over specs.
- Do not commit secrets, `.env`, private keys, or local MCP config.
