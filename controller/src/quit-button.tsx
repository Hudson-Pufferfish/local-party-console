import { Show, type VoidComponent } from 'solid-js';
import type { RoomPhase } from '../../shared/src/types/envelope.ts';

export function canQuitController(joined: boolean, phase: RoomPhase): boolean {
  return joined && phase === 'lobby';
}

export function isOrientationLocked(joined: boolean, gameMounted: boolean): boolean {
  return joined || gameMounted;
}

export const QuitButton: VoidComponent<{
  visible: boolean;
  disabled?: boolean;
  onQuit: () => void;
}> = (props) => {
  return (
    <Show when={props.visible}>
      <button
        type="button"
        class="quit-btn"
        aria-label="Quit room"
        disabled={props.disabled === true}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          if (props.disabled === true) return;
          props.onQuit();
        }}
      >
        QUIT
      </button>
    </Show>
  );
};
