import type { VoidComponent } from 'solid-js';
import { parseCssColorToHex, pickContrastInk } from '../theme';

export const PlayerBadge: VoidComponent<{
  name: string;
  label: string;
  color?: string;
}> = (props) => {
  const badgeStyle = () => {
    const raw = props.color;
    if (raw === undefined || raw === '' || parseCssColorToHex(raw) === null) return undefined;
    return {
      '--player-color': raw,
      '--player-ink': pickContrastInk(raw),
    };
  };

  return (
    <p class="player-badge" style={badgeStyle()}>
      <span class="swatch" />
      <span class="badge-label">{props.label}</span>
      <span class="badge-name">{props.name}</span>
    </p>
  );
};
