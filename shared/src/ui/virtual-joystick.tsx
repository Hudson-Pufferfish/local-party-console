import { onCleanup, type VoidComponent } from 'solid-js';
import {
  transformAxesInto,
  type StageRotationDeg,
} from '../controller/orientation.ts';
import { pickPointerSample, type PointerSample } from '../stretch1/samples';
import { useControllerOrientation } from './orientation-context.tsx';

const EMPTY_SAMPLES: PointerSample[] = [];

export interface JoystickElementLike extends EventTarget {
  draggable: boolean;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture?(pointerId: number): void;
}

export interface JoystickCapLike {
  style: { transform: string };
}

export function bindVirtualJoystick(
  root: JoystickElementLike,
  getCap: JoystickCapLike | (() => JoystickCapLike | undefined),
  options: {
    onAxes: (x: number, y: number, timeStamp: number) => void;
    readRotation: () => StageRotationDeg;
  },
): () => void {
  let originX = 0;
  let originY = 0;
  let radius = 1;
  let tracking = false;
  const localDelta = { x: 0, y: 0 };

  function resolveCap(): JoystickCapLike | undefined {
    return typeof getCap === 'function' ? getCap() : getCap;
  }

  function blockNativeDrag(event: Event): void {
    if (event.cancelable) event.preventDefault();
  }

  function onDown(event: Event): void {
    const pointer = event as PointerEvent;
    if (pointer.cancelable) pointer.preventDefault();
    tracking = true;
    try {
      root.setPointerCapture?.(pointer.pointerId);
    } catch {
      // A cancelled pointer does not block the send.
    }
    const rect = root.getBoundingClientRect();
    originX = rect.left + rect.width * 0.5;
    originY = rect.top + rect.height * 0.5;
    radius = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
  }

  function onMove(event: Event): void {
    const pointer = event as PointerEvent & {
      getCoalescedEvents?: () => PointerSample[];
      getPredictedEvents?: () => PointerSample[];
    };
    if (pointer.cancelable) pointer.preventDefault();
    if (!tracking) return;
    const sample = pickPointerSample(
      pointer,
      pointer.getCoalescedEvents?.() ?? EMPTY_SAMPLES,
      pointer.getPredictedEvents?.() ?? EMPTY_SAMPLES,
    );
    transformAxesInto(
      sample.clientX - originX,
      sample.clientY - originY,
      options.readRotation(),
      localDelta,
    );
    let x = localDelta.x / radius;
    let y = localDelta.y / radius;
    if (x > 1) x = 1;
    else if (x < -1) x = -1;
    if (y > 1) y = 1;
    else if (y < -1) y = -1;
    options.onAxes(x, y, sample.timeStamp);
    const cap = resolveCap();
    if (cap === undefined) return;
    cap.style.transform = `translate3d(${Math.round(x * 28)}px, ${Math.round(y * 28)}px, 0)`;
  }

  function onUp(event: Event): void {
    const pointer = event as PointerEvent;
    if (!tracking) return;
    tracking = false;
    options.onAxes(0, 0, pointer.timeStamp);
    const cap = resolveCap();
    if (cap !== undefined) cap.style.transform = 'translate3d(0px, 0px, 0)';
  }

  root.draggable = false;
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('touchstart', blockNativeDrag, { passive: false });
  root.addEventListener('touchmove', blockNativeDrag, { passive: false });
  root.addEventListener('selectstart', blockNativeDrag);
  root.addEventListener('dragstart', blockNativeDrag);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);

  return () => {
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('touchstart', blockNativeDrag);
    root.removeEventListener('touchmove', blockNativeDrag);
    root.removeEventListener('selectstart', blockNativeDrag);
    root.removeEventListener('dragstart', blockNativeDrag);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
  };
}

export const VirtualJoystick: VoidComponent<{
  label: string;
  onAxes: (x: number, y: number, timeStamp: number) => void;
  rotationDeg?: StageRotationDeg;
}> = (props) => {
  const orientationCtx = useControllerOrientation();
  let cap: HTMLDivElement | undefined;
  let unbind: (() => void) | undefined;

  onCleanup(() => {
    unbind?.();
    unbind = undefined;
  });

  return (
    <div
      class="joystick"
      ref={(el) => {
        unbind?.();
        unbind = bindVirtualJoystick(el, () => cap, {
          onAxes: (x, y, timeStamp) => props.onAxes(x, y, timeStamp),
          readRotation: () => props.rotationDeg ?? orientationCtx.rotationDeg(),
        });
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
