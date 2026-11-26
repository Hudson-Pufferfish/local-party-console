import { For, Show, type VoidComponent } from 'solid-js';
import type { RoundPanelMode, RoundPanelRankRow } from './round-panel-model.ts';
import type { ScoreRow, ScoreRules } from './register-games.ts';

export const ScoreRulesPanel: VoidComponent<{ rules: ScoreRules }> = (props) => {
  return (
    <aside class="score-rules" aria-label="Scoring rules">
      <Show when={props.rules.guide}>
        {(guide) => (
          <>
            <p class="score-rules-heading">HOW TO PLAY</p>
            <ol class="score-guide-list">
              <For each={guide()}>
                {(line) => <li class="score-guide-item">{line}</li>}
              </For>
            </ol>
          </>
        )}
      </Show>
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
        width={128}
        height={128}
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

export const RoundRanking: VoidComponent<{
  mode: RoundPanelMode;
  rows: readonly RoundPanelRankRow[];
}> = (props) => {
  const heading = () => {
    const mode = props.mode;
    if (mode === 'live' || mode === 'empty') return 'THIS ROUND';
    if (mode === 'frozen') return 'THIS ROUND - FINAL';
    return 'LAST ROUND';
  };

  return (
    <aside class="round-ranking" aria-label="Round ranking" data-mode={props.mode}>
      <p class="round-ranking-heading">{heading()}</p>
      <ol class="round-ranking-list">
        <For each={props.rows} keyed={(row) => row.slot}>
          {(row) => (
            <li class="round-rank-row" data-finalized={row().finalized}>
              <Show when={row().place !== null} fallback={<span class="round-rank-place" />}>
                <span class="round-rank-place">{ordinalLabel(row().place ?? 0)}</span>
              </Show>
              <span
                class="round-rank-dot"
                aria-hidden="true"
                style={{ 'background-color': row().color }}
              />
              <span class="round-rank-name">{row().name}</span>
              <span
                class="round-rank-value"
                data-bomb={row().marker === 'BOMB' ? 'true' : undefined}
              >
                {row().value}
              </span>
              <Show when={row().earned !== undefined && props.mode !== 'live'}>
                <span class="round-rank-earned">+{row().earned}</span>
              </Show>
              <Show when={row().preview !== null && props.mode === 'live'}>
                <span class="round-rank-preview">+{row().preview}</span>
              </Show>
              <Show when={row().status !== undefined}>
                <span class="round-rank-status" data-status={row().status?.toLowerCase()}>
                  {row().status}
                </span>
              </Show>
              <Show when={row().marker !== undefined && row().marker !== 'BOMB'}>
                <span class="round-rank-marker">{row().marker}</span>
              </Show>
            </li>
          )}
        </For>
      </ol>
    </aside>
  );
};

const ORDINALS = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'] as const;

function ordinalLabel(place: number): string {
  if (place >= 1 && place <= 8) {
    return ORDINALS[place - 1] ?? `${place}TH`;
  }
  return `${place}TH`;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
