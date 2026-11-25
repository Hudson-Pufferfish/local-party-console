import { createEffect, Show, type VoidComponent } from 'solid-js';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: string;
  cancelLabel?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmModal: VoidComponent<ConfirmModalProps> = (props) => {
  createEffect(
    () => props.open,
    (isOpen) => {
      if (!isOpen || typeof window === 'undefined') return;
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        props.onCancel();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
      };
    },
  );

  return (
    <Show when={props.open}>
      <div
        class="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-body"
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onCancel();
        }}
      >
        <div class="confirm-panel">
          <h2 id="confirm-modal-title" class="confirm-title">{props.title}</h2>
          <p id="confirm-modal-body" class="confirm-body">{props.body}</p>
          <div class="confirm-actions">
            <button
              type="button"
              class="key confirm-cancel"
              onClick={() => props.onCancel()}
            >
              {props.cancelLabel ?? 'CANCEL'}
            </button>
            <button
              type="button"
              class="key confirm-accept"
              onClick={() => props.onConfirm()}
            >
              {props.confirmLabel ?? 'QUIT TO LOBBY'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
