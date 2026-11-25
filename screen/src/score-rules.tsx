import { For, type VoidComponent } from 'solid-js';
import type { ScoreRules } from './register-games.ts';

export const ScoreRulesPanel: VoidComponent<{ rules: ScoreRules }> = (props) => {
  return (
    <aside class="score-rules" aria-label="Scoring rules">
      <p class="score-rules-target">{props.rules.target}</p>
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
