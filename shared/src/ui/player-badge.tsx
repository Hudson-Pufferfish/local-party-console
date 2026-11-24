import type { VoidComponent } from 'solid-js';

export const PlayerBadge: VoidComponent<{
  name: string;
  label: string;
  color: string;
}> = (props) => {
  return (
    <p class="player-badge">
      <span class="swatch" style={{ background: props.color }} />
      <span class="badge-label">{props.label}</span>
      <span class="badge-name">{props.name}</span>
    </p>
  );
};
