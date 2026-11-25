import { createMemo, createSignal, Show, type VoidComponent } from 'solid-js';
import type { GameManifest } from '../../shared/src/types/game.ts';
import { ConfirmModal } from './confirm-modal.tsx';

// NOTE: Single-screen games ('holistic', e.g. Sumo Dash) use this in-match exit button. Multi-screen games ('team-exclusive') will handle coordinated exit orchestration separately.
// TODO(@agents): implement exit mode for multiscreen type ('team-exclusive') when multi-display viewport coordination is added.
export function isSingleScreenGame(manifest: GameManifest | undefined): boolean {
  return manifest?.viewConfig.mode === 'holistic';
}

export function canShowMatchExit(
  primary: boolean,
  match: boolean,
  manifest: GameManifest | undefined,
): boolean {
  return primary && match && isSingleScreenGame(manifest);
}

export interface MatchExitState {
  readonly primary: boolean;
  readonly match: boolean;
  readonly manifest: GameManifest | undefined;
  readonly confirmOpen: boolean;
}

export type MatchExitAction =
  | { type: 'open' }
  | { type: 'cancel' }
  | { type: 'confirm' }
  | {
      type: 'sync';
      primary: boolean;
      match: boolean;
      manifest: GameManifest | undefined;
    };

export function reduceMatchExit(
  state: MatchExitState,
  action: MatchExitAction,
  onConfirm?: () => void,
): MatchExitState {
  if (action.type === 'sync') {
    const visible = canShowMatchExit(action.primary, action.match, action.manifest);
    return {
      primary: action.primary,
      match: action.match,
      manifest: action.manifest,
      confirmOpen: visible ? state.confirmOpen : false,
    };
  }
  const visible = canShowMatchExit(state.primary, state.match, state.manifest);
  if (action.type === 'open') {
    return { ...state, confirmOpen: visible };
  }
  if (action.type === 'cancel') {
    return { ...state, confirmOpen: false };
  }
  if (!visible) {
    return { ...state, confirmOpen: false };
  }
  onConfirm?.();
  return { ...state, confirmOpen: false };
}

export interface MatchExitControlProps {
  primary: boolean;
  match: boolean;
  manifest: GameManifest | undefined;
  onConfirm: () => void;
  confirmOpen?: boolean;
}

export const MatchExitControl: VoidComponent<MatchExitControlProps> = (props) => {
  const visible = createMemo(() =>
    canShowMatchExit(props.primary, props.match, props.manifest),
  );
  const [localOpen, setLocalOpen] = createSignal(() => {
    visible();
    return false;
  });
  const isOpen = createMemo(() => visible() && (props.confirmOpen ?? localOpen()));

  function snapshot(): MatchExitState {
    return {
      primary: props.primary,
      match: props.match,
      manifest: props.manifest,
      confirmOpen: isOpen(),
    };
  }

  function openModal(): void {
    const next = reduceMatchExit(snapshot(), { type: 'open' });
    setLocalOpen(next.confirmOpen);
  }

  function cancelModal(): void {
    const next = reduceMatchExit(snapshot(), { type: 'cancel' });
    setLocalOpen(next.confirmOpen);
  }

  function confirmExit(): void {
    let confirmed = false;
    const next = reduceMatchExit(snapshot(), { type: 'confirm' }, () => {
      confirmed = true;
    });
    setLocalOpen(next.confirmOpen);
    if (confirmed) props.onConfirm();
  }

  return (
    <Show when={visible()}>
      <button
        type="button"
        class="match-exit"
        aria-label="Quit match"
        title="Quit match"
        onClick={openModal}
      >
        ×
      </button>
      <ConfirmModal
        open={isOpen()}
        title="QUIT MATCH?"
        body="Are you sure to end the current game and quit to the lobby?"
        cancelLabel="CANCEL"
        confirmLabel="QUIT TO LOBBY"
        onCancel={cancelModal}
        onConfirm={confirmExit}
      />
    </Show>
  );
};
