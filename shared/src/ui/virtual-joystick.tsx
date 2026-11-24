import { onCleanup, type VoidComponent } from 'solid-js';
import { pickPointerSample, type PointerSample } from '../stretch1/samples';

const EMPTY_SAMPLES: PointerSample[] = [];

export const VirtualJoystick: VoidComponent<{
  label: string;
  onAxes: (x: number, y: number, timeStamp: number) => void;
}> = (props) => {
  let root: HTMLDivElement | undefined;
  let cap: HTMLDivElement | undefined;
  let originX = 0;
  let originY = 0;
  let radius = 1;
  let tracking = false;

  function blockNativeDrag(event: Event): void {
    if (event.cancelable) event.preventDefault();
  }

  function onDown(event: PointerEvent): void {
    const el = event.currentTarget;
    if (!(el instanceof HTMLDivElement)) return;
    if (event.cancelable) event.preventDefault();
    tracking = true;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // A cancelled pointer does not block the send.
    }
    const rect = el.getBoundingClientRect();
    originX = rect.left + rect.width * 0.5;
    originY = rect.top + rect.height * 0.5;
    radius = Math.max(1, rect.width * 0.5);
  }

  function onMove(event: PointerEvent): void {
    if (event.cancelable) event.preventDefault();
    if (!tracking) return;
    const pointer = event as PointerEvent & {
      getCoalescedEvents?: () => PointerSample[];
      getPredictedEvents?: () => PointerSample[];
    };
    const sample = pickPointerSample(
      event,
      pointer.getCoalescedEvents?.() ?? EMPTY_SAMPLES,
      pointer.getPredictedEvents?.() ?? EMPTY_SAMPLES,
    );
    let x = (sample.clientX - originX) / radius;
    let y = (sample.clientY - originY) / radius;
    if (x > 1) x = 1;
    else if (x < -1) x = -1;
    if (y > 1) y = 1;
    else if (y < -1) y = -1;
    props.onAxes(x, y, sample.timeStamp);
    if (cap === undefined) return;
    cap.style.transform = `translate3d(${Math.round(x * 28)}px, ${Math.round(y * 28)}px, 0)`;
  }

  function onUp(event: PointerEvent): void {
    if (!tracking) return;
    tracking = false;
    props.onAxes(0, 0, event.timeStamp);
    if (cap !== undefined) cap.style.transform = 'translate3d(0px, 0px, 0)';
  }

  onCleanup(() => {
    if (root === undefined) return;
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('touchstart', blockNativeDrag);
    root.removeEventListener('touchmove', blockNativeDrag);
    root.removeEventListener('selectstart', blockNativeDrag);
    root.removeEventListener('dragstart', blockNativeDrag);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
  });

  return (
    <div
      class="joystick"
      ref={(el) => {
        root = el;
        el.draggable = false;
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('touchstart', blockNativeDrag, { passive: false });
        el.addEventListener('touchmove', blockNativeDrag, { passive: false });
        el.addEventListener('selectstart', blockNativeDrag);
        el.addEventListener('dragstart', blockNativeDrag);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
      }}
    >
      <div
        class="joystick-cap"
        ref={(el) => {
          cap = el;
        }}
      />
      <span class="joystick-label">{props.label}</span>
    </div>
  );
};
