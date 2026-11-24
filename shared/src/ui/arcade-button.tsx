import { onCleanup, type VoidComponent } from 'solid-js';
import { parseCssColorToHex, pickContrastInk } from '../theme';

export const ArcadeButton: VoidComponent<{
  label: string;
  color?: string;
  ink?: string;
  disabled?: boolean;
  onPressedChange: (pressed: boolean, timeStamp: number) => void;
}> = (props) => {
  let button: HTMLButtonElement | undefined;
  let fromPointer = false;

  function onDown(event: PointerEvent): void {
    if (props.disabled) return;
    const el = event.currentTarget;
    if (!(el instanceof HTMLButtonElement)) return;
    event.preventDefault();
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // A cancelled pointer does not block the send.
    }
    fromPointer = true;
    props.onPressedChange(true, event.timeStamp);
    el.setAttribute('data-pressed', 'true');
  }

  function onClick(event: MouseEvent): void {
    if (props.disabled) return;
    if (fromPointer) {
      fromPointer = false;
      return;
    }
    const el = event.currentTarget;
    if (!(el instanceof HTMLButtonElement)) return;
    props.onPressedChange(true, event.timeStamp);
    props.onPressedChange(false, event.timeStamp);
  }

  function onUp(event: PointerEvent): void {
    const el = event.currentTarget;
    if (!(el instanceof HTMLButtonElement)) return;
    props.onPressedChange(false, event.timeStamp);
    el.setAttribute('data-pressed', 'false');
  }

  onCleanup(() => {
    if (button === undefined) return;
    button.removeEventListener('pointerdown', onDown);
    button.removeEventListener('pointerup', onUp);
    button.removeEventListener('pointercancel', onUp);
    button.removeEventListener('click', onClick);
  });

  const buttonStyle = () => {
    const raw = props.color;
    if (raw === undefined || raw === '') {
      return props.ink !== undefined ? { color: props.ink } : undefined;
    }
    const resolvedInk = props.ink ?? (parseCssColorToHex(raw) !== null ? pickContrastInk(raw) : undefined);
    return resolvedInk !== undefined ? { background: raw, color: resolvedInk } : { background: raw };
  };

  return (
    <button
      ref={(el) => {
        button = el;
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
        el.addEventListener('click', onClick);
      }}
      type="button"
      class="arcade-button"
      disabled={props.disabled}
      style={buttonStyle()}
    >
      {props.label}
    </button>
  );
};
