# Telemetry HUD

The host screen includes an on-screen Telemetry HUD overlay for frame rate and phone transport diagnostics.

## Open and Close

1. Click the host screen window.
2. Press `Tab` to open the overlay.
3. Press `Tab` again, or `Escape`, to close it.

## Overlay Layout

The overlay prints:

```text
VIEWPORTS: THIS <fps>fps | OTHERS —
VIEWPORT SYNC: TICK DELTA — | CLOCK SKEW — | DISPLAYLINK COMP +0ms | FLIGHT REC —
P<n> [T<team>] <name> | <transport> | Hz: <hz> <tier> | Touch: <ms>ms | Net p50/p99/J: <p50>/<p99>/<jitter>ms | Loss: <percent>% | LongTasks: <count>
```

## Viewport Fields

- `VIEWPORTS`: Shows this tab's FPS. `OTHERS` stays `—`.
- `VIEWPORT SYNC`: `TICK DELTA`, `CLOCK SKEW`, and `FLIGHT REC` stay `—`. `DISPLAYLINK COMP` reads `+0ms`.

Phone rows appear on the primary tab. A normal `/screen/` window is that tab. Another screen tab shows `PHONE TELEMETRY AVAILABLE ON PRIMARY TAB ONLY`.

## Player Rows

Each row represents one connected player:

- `P1`–`P8`: Player slot. `[T<team>]` is the team. A missing team is `[T-]`.
- Transport: `UDP-DIRECT`, `WS-FALLBACK`, or `IDLE`.
- `Hz`: Input rate for that phone. The tier is `[TIER 60]` or `[ULP/LOW-POWER]`.
- `Touch`: Touch latency in milliseconds.
- `Net p50/p99/J`: Median latency, p99 latency, and jitter in milliseconds. The field stays `—` until that phone has a clock offset.
- `Loss`: Dropped-packet percentage.
- `LongTasks`: Long-task count.

A red value marks high `Touch`, high `Net p99`, or `Loss` above `0`.
