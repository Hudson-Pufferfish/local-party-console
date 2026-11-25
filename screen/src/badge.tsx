import type { VoidComponent } from 'solid-js';
import type { ScreenViewTarget } from '../../shared/src/types/game.ts';

export function badgeLabel(view: ScreenViewTarget): string {
  if (view === 'holistic') return 'HOLISTIC VIEW';
  return `TEAM ${view.slice(5)} VIEW`;
}

export const Badge: VoidComponent<{ view: ScreenViewTarget }> = (props) => {
  return <p class="badge">{badgeLabel(props.view)}</p>;
};
