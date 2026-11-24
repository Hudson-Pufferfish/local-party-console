import { Show, type VoidComponent } from 'solid-js';
import { ArcadeButton } from './arcade-button.tsx';
import { releaseClosesModal } from './modal-press.ts';

export const HudModal: VoidComponent<{
  open: boolean;
  title: string;
  body: string;
  onClose: () => void;
}> = (props) => {
  let sawDown = false;
  return (
    <Show when={props.open}>
      <div class="hud-modal" role="dialog" aria-modal="true">
        <div class="hud-panel">
          <h2>{props.title}</h2>
          <p>{props.body}</p>
          <ArcadeButton
            label="CLOSE"
            onPressedChange={(pressed) => {
              if (releaseClosesModal(pressed, sawDown)) props.onClose();
              sawDown = pressed;
            }}
          />
        </div>
      </div>
    </Show>
  );
};
