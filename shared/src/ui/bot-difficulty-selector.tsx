import { For, type VoidComponent } from 'solid-js';
import type { BotDifficulty } from '../bot-difficulty.ts';

const OPTIONS: readonly {
  value: BotDifficulty;
  label: string;
  ariaLabel: string;
}[] = [
  { value: 'easy', label: 'EASY', ariaLabel: 'Easy bot difficulty' },
  { value: 'medium', label: 'MED', ariaLabel: 'Medium bot difficulty' },
  { value: 'hard', label: 'HARD', ariaLabel: 'Hard bot difficulty' },
];

export const BotDifficultySelector: VoidComponent<{
  value: BotDifficulty;
  disabled?: boolean;
  onChange: (next: BotDifficulty) => void;
}> = (props) => {
  return (
    <div
      class="bot-difficulty"
      role="group"
      aria-label="Bot difficulty"
      data-disabled={props.disabled === true ? 'true' : 'false'}
    >
      <For each={OPTIONS}>
        {(option) => (
          <button
            type="button"
            class="bot-difficulty-btn"
            data-difficulty={option.value}
            data-active={props.value === option.value ? 'true' : 'false'}
            aria-pressed={props.value === option.value ? 'true' : 'false'}
            aria-label={option.ariaLabel}
            disabled={props.disabled === true}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              if (props.disabled === true) return;
              props.onChange(option.value);
            }}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
};
