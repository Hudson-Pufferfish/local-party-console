import type { VoidComponent } from 'solid-js';

export const GameCard: VoidComponent<{
  title: string;
  detail: string;
  selected?: boolean;
  onSelect?: () => void;
}> = (props) => {
  return (
    <button
      type="button"
      class="game-card"
      data-selected={props.selected === true ? 'true' : 'false'}
      onPointerDown={() => {
        props.onSelect?.();
      }}
    >
      <span class="game-card-title">{props.title}</span>
      <span class="game-card-detail">{props.detail}</span>
    </button>
  );
};
