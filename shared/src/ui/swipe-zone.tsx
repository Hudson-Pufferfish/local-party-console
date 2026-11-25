import { onCleanup, type VoidComponent } from 'solid-js';
import {
  transformAxesInto,
  type StageRotationDeg,
} from '../controller/orientation.ts';
import { useControllerOrientation } from './orientation-context.tsx';

export interface SwipeZoneElementLike extends EventTarget {
  draggable: boolean;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture?(pointerId: number): void;
  setAttribute(name: string, value: string): void;
}

export function bindSwipeZone(
  root: SwipeZoneElementLike,
  options: {
    onSwipe?: (x: number, y: number, timeStamp: number) => void;
    readRotation: () => StageRotationDeg;
  },
): () => void {
  let startX = 0;
  let startY = 0;
  let span = 1;
  const localDelta = { x: 0, y: 0 };

  function blockNativeDrag(event: Event): void {
    if (event.cancelable) event.preventDefault();
  }

  function onDown(event: Event): void {
    const pointer = event as PointerEvent;
    if (pointer.cancelable) pointer.preventDefault();
    try {
      root.setPointerCapture?.(pointer.pointerId);
    } catch {
      // A cancelled pointer does not block the swipe.
    }
    root.setAttribute('data-pressed', 'true');
    const rect = root.getBoundingClientRect();
    startX = pointer.clientX;
    startY = pointer.clientY;
    span = Math.max(1, Math.min(rect.width, rect.height));
  }

  function onUp(event: Event): void {
    const pointer = event as PointerEvent;
    transformAxesInto(
      pointer.clientX - startX,
      pointer.clientY - startY,
      options.readRotation(),
      localDelta,
    );
    let x = localDelta.x / span;
    let y = localDelta.y / span;
    if (x > 1) x = 1;
    else if (x < -1) x = -1;
    if (y > 1) y = 1;
    else if (y < -1) y = -1;
    options.onSwipe?.(x, y, pointer.timeStamp);
    root.setAttribute('data-pressed', 'false');
  }

  root.draggable = false;
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('touchstart', blockNativeDrag, { passive: false });
  root.addEventListener('touchmove', blockNativeDrag, { passive: false });
  root.addEventListener('selectstart', blockNativeDrag);
  root.addEventListener('dragstart', blockNativeDrag);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);

  return () => {
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('touchstart', blockNativeDrag);
    root.removeEventListener('touchmove', blockNativeDrag);
    root.removeEventListener('selectstart', blockNativeDrag);
    root.removeEventListener('dragstart', blockNativeDrag);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
  };
}

export const SwipeZone: VoidComponent<{
  label: string;
  onSwipe?: (x: number, y: number, timeStamp: number) => void;
  rotationDeg?: StageRotationDeg;
}> = (props) => {
  const orientationCtx = useControllerOrientation();
  let unbind: (() => void) | undefined;

  onCleanup(() => {
    unbind?.();
    unbind = undefined;
  });

  return (
    <div
      class="swipe-zone"
      ref={(el) => {
        unbind?.();
        unbind = bindSwipeZone(el, {
          onSwipe: (x, y, timeStamp) => props.onSwipe?.(x, y, timeStamp),
          readRotation: () => props.rotationDeg ?? orientationCtx.rotationDeg(),
        });
      }}
    >
      <span class="swipe-label">{props.label}</span>
    </div>
  );
};
