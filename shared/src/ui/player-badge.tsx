import type { VoidComponent } from 'solid-js';
import { parseCssColorToHex } from '../theme';

export const PlayerBadge: VoidComponent<{
  name: string;
  label: string;
  color?: string;
}> = (props) => {
  const swatchStyle = () => {
    const raw = props.color;
    if (raw === undefined || raw === '' || parseCssColorToHex(raw) === null) return undefined;
    return { '--player-color': raw };
  };

  return (
    <p class="player-badge">
      <span class="swatch" style={swatchStyle()} />
      <span class="badge-label">{props.label}</span>
      <span class="badge-name">{props.name}</span>
    </p>
  );
};
