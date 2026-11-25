import { For, Show, type VoidComponent } from 'solid-js';
import type { ScoreRow, ScoreRules } from './register-games.ts';

export const ScoreRulesPanel: VoidComponent<{ rules: ScoreRules }> = (props) => {
  return (
    <aside class="score-rules" aria-label="Scoring rules">
      <ol class="score-rules-list">
        <For each={props.rules.rows} keyed={(row) => row.label}>
          {(row) => (
            <li class="score-rule-row">
              <span class="score-rule-rank">{row().label}:</span>
              <span class="score-rule-pts">{row().value}</span>
            </li>
          )}
        </For>
      </ol>
    </aside>
  );
};

export const MatchRejoinQr: VoidComponent<{
  onQr: (canvas: HTMLCanvasElement) => void;
}> = (props) => {
  return (
    <aside class="match-rejoin" aria-label="Scan to rejoin">
      <canvas
        class="match-rejoin-qr"
        ref={(canvas) => props.onQr(canvas)}
        width={80}
        height={80}
      />
      <p class="match-rejoin-label">SCAN TO REJOIN</p>
    </aside>
  );
};

export const ScoreboardPanel: VoidComponent<{
  header: string;
  rows: readonly ScoreRow[];
}> = (props) => {
  return (
    <div class="scoreboard-panel">
      <Show when={props.header !== ''}>
        <p class="scoreboard-threshold">{props.header}</p>
      </Show>
      <ol class="scoreboard">
        <For each={props.rows} keyed={(row) => row.slot}>
          {(row) => (
            <li class="score-row">
              <span
                class="score-dot"
                aria-hidden="true"
                style={{ 'background-color': row().color }}
              />
              <span class="score-name">{row().name}</span>
              <span class="score-value">{row().score}</span>
              <Show when={row().status !== undefined}>
                <span class="score-status" data-status={row().status?.toLowerCase()}>
                  {row().status}
                </span>
              </Show>
              <Show when={row().ratio !== undefined}>
                <span class="score-bar" aria-hidden="true">
                  <span
                    class="score-bar-fill"
                    style={{
                      width: `${clampRatio(row().ratio ?? 0) * 100}%`,
                      'background-color': row().color,
                    }}
                  />
                </span>
              </Show>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
};

function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
