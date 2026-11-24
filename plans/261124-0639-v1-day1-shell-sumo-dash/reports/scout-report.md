# Scout report — local-party-console (2026-11-24)

Root: `/Users/hudson/Developer/local-party-console`

## What is on disk

| Path | Role |
|---|---|
| `AGENTS.md` | Tooling, test budget, Day-1 hard rules |
| `specifications/SPEC.md` | Platform authority |
| `specifications/games-spec/README.md` | `GameDefinition` contract. One game in the index. |
| `specifications/games-spec/sumo-dash.md` | v1 game |
| `.agents/skills/` | Stack skills. Specs win on conflict. |
| `.gitignore` | Ignores `plans/`, `.env`, `.cursor/mcp.json`, `dist/` |
| `skills-lock.json` | Skill lock |

## What is absent

- No `package.json`, lockfile, `src/`, or app packages.
- No `plans/` directory before this plan.
- No git repository (workspace is not a git repo).
- No GitHub issue for this work.

## Skill conflicts to ignore during v1

The installed `webrtc` skill shows STUN, Socket.IO signaling, ordered channels, and a LiveKit SFU (`/.agents/skills/webrtc/SKILL.md`). `SPEC.md` line 37 requires `iceServers: []`, raw `ws`, `ordered: false`, `maxRetransmits: 0`, `negotiated: true`, `id: 0`, and the host Chrome tab as the only peer.

The installed `fastify-best-practices` websocket rule shows `@fastify/websocket`. v1 attaches the `ws` server to Fastify's HTTP server so `setNoDelay(true)` and `perMessageDeflate: false` stay visible (`SPEC.md` lines 36 and 45).
