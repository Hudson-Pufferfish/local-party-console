import { onCleanup, type VoidComponent } from 'solid-js';

export const SwipeZone: VoidComponent<{
  label: string;
  onSwipe?: (x: number, y: number, timeStamp: number) => void;
}> = (props) => {
  let root: HTMLDivElement | undefined;
  let startX = 0;
  let startY = 0;
  let width = 1;

  function blockNativeDrag(event: Event): void {
    if (event.cancelable) event.preventDefault();
  }

  function onDown(event: PointerEvent): void {
    const el = event.currentTarget;
    if (!(el instanceof HTMLDivElement)) return;
    if (event.cancelable) event.preventDefault();
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // A cancelled pointer does not block the swipe.
    }
    el.setAttribute('data-pressed', 'true');
    const rect = el.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    width = Math.max(1, rect.width);
  }

  function onUp(event: PointerEvent): void {
    let x = (event.clientX - startX) / width;
    let y = (event.clientY - startY) / width;
    if (x > 1) x = 1;
    else if (x < -1) x = -1;
    if (y > 1) y = 1;
    else if (y < -1) y = -1;
    props.onSwipe?.(x, y, event.timeStamp);
    const el = event.currentTarget;
    if (el instanceof HTMLDivElement) el.setAttribute('data-pressed', 'false');
  }

  onCleanup(() => {
    if (root === undefined) return;
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('touchstart', blockNativeDrag);
    root.removeEventListener('touchmove', blockNativeDrag);
    root.removeEventListener('selectstart', blockNativeDrag);
    root.removeEventListener('dragstart', blockNativeDrag);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
  });

  return (
    <div
      class="swipe-zone"
      ref={(el) => {
        root = el;
        el.draggable = false;
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('touchstart', blockNativeDrag, { passive: false });
        el.addEventListener('touchmove', blockNativeDrag, { passive: false });
        el.addEventListener('selectstart', blockNativeDrag);
        el.addEventListener('dragstart', blockNativeDrag);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
      }}
    >
      <span class="swipe-label">{props.label}</span>
    </div>
  );
};
