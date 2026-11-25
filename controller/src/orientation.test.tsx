import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import type { StageRotationDeg } from '../../shared/src/controller/orientation.ts';
import { OrientationProvider, useControllerOrientation } from '../../shared/src/ui/orientation-context.tsx';
import { bindSwipeZone } from '../../shared/src/ui/swipe-zone.tsx';
import { bindVirtualJoystick } from '../../shared/src/ui/virtual-joystick.tsx';
import { ControllerStage } from './controller-stage.tsx';
import {
  OrientationToggle,
  readStoredOrientationPref,
  writeStoredOrientationPref,
} from './orientation-toggle.tsx';

class FakeElement extends EventTarget {
  draggable = true;
  style = { transform: '' };
  attrs = new Map<string, string>();
  rect: { left: number; top: number; width: number; height: number };

  constructor(rect: { left: number; top: number; width: number; height: number }) {
    super();
    this.rect = rect;
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.rect;
  }

  setPointerCapture(_id: number): void {}

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
}

function pointerEvent(type: string, clientX: number, clientY: number, timeStamp = 10): Event {
  const event = new Event(type, { cancelable: true }) as Event & {
    pointerId: number;
    clientX: number;
    clientY: number;
  };
  event.pointerId = 1;
  event.clientX = clientX;
  event.clientY = clientY;
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  return event;
}

test('VirtualJoystick and SwipeZone rotate emitted axes and cap translate3d at 0, +90, and -90 degrees', () => {
  // Non-square rect: min(width, height) = 100 -> radius = 50, center = (200, 150)
  const root = new FakeElement({ left: 100, top: 100, width: 200, height: 100 });
  const cap = new FakeElement({ left: 0, top: 0, width: 44, height: 44 });
  let rotation: StageRotationDeg = 0;
  const axes: Array<[number, number]> = [];

  const stopStick = bindVirtualJoystick(root, cap, {
    onAxes: (x, y) => axes.push([x, y]),
    readRotation: () => rotation,
  });

  // 0deg: drag visually right (+50px X) and up (-50px Y)
  root.dispatchEvent(pointerEvent('pointerdown', 200, 150));
  root.dispatchEvent(pointerEvent('pointermove', 250, 150));
  expect(axes.at(-1)).toEqual([1, 0]);
  expect(cap.style.transform).toBe('translate3d(28px, 0px, 0)');
  root.dispatchEvent(pointerEvent('pointermove', 200, 100));
  expect(axes.at(-1)).toEqual([0, -1]);
  expect(cap.style.transform).toBe('translate3d(0px, -28px, 0)');
  root.dispatchEvent(pointerEvent('pointerup', 200, 100));
  expect(axes.at(-1)).toEqual([0, 0]);
  expect(cap.style.transform).toBe('translate3d(0px, 0px, 0)');

  // +90deg CW: visual right = viewport down (+50px Y); visual up = viewport right (+50px X)
  rotation = 90;
  root.dispatchEvent(pointerEvent('pointerdown', 200, 150));
  root.dispatchEvent(pointerEvent('pointermove', 200, 200));
  expect(axes.at(-1)).toEqual([1, 0]);
  expect(cap.style.transform).toBe('translate3d(28px, 0px, 0)');
  root.dispatchEvent(pointerEvent('pointermove', 250, 150));
  expect(axes.at(-1)).toEqual([0, -1]);
  expect(cap.style.transform).toBe('translate3d(0px, -28px, 0)');
  root.dispatchEvent(pointerEvent('pointerup', 250, 150));

  // -90deg CCW: visual right = viewport up (-50px Y); visual up = viewport left (-50px X)
  rotation = -90;
  root.dispatchEvent(pointerEvent('pointerdown', 200, 150));
  root.dispatchEvent(pointerEvent('pointermove', 200, 100));
  expect(axes.at(-1)).toEqual([1, 0]);
  expect(cap.style.transform).toBe('translate3d(28px, 0px, 0)');
  root.dispatchEvent(pointerEvent('pointermove', 150, 150));
  expect(axes.at(-1)).toEqual([0, -1]);
  expect(cap.style.transform).toBe('translate3d(0px, -28px, 0)');
  root.dispatchEvent(pointerEvent('pointerup', 150, 150));
  stopStick();

  // SwipeZone shares the exact same rotation transform
  const swipeRoot = new FakeElement({ left: 0, top: 0, width: 200, height: 100 });
  const swipes: Array<[number, number]> = [];
  const stopSwipe = bindSwipeZone(swipeRoot, {
    onSwipe: (x, y) => swipes.push([x, y]),
    readRotation: () => rotation,
  });
  rotation = 90;
  swipeRoot.dispatchEvent(pointerEvent('pointerdown', 50, 50));
  swipeRoot.dispatchEvent(pointerEvent('pointerup', 50, 150));
  expect(swipes.at(-1)).toEqual([1, 0]);

  rotation = -90;
  swipeRoot.dispatchEvent(pointerEvent('pointerdown', 50, 150));
  swipeRoot.dispatchEvent(pointerEvent('pointerup', 50, 50));
  expect(swipes.at(-1)).toEqual([1, 0]);
  stopSwipe();
});

test('OrientationProvider, ControllerStage, and OrientationToggle persist prefs and lock when game mounts', () => {
  // Storage persistence + safe fallback on throwing storage
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  expect(readStoredOrientationPref(storage)).toBe('portrait');
  writeStoredOrientationPref('landscape-left', storage);
  expect(readStoredOrientationPref(storage)).toBe('landscape-left');
  writeStoredOrientationPref('landscape-right', storage);
  expect(readStoredOrientationPref(storage)).toBe('landscape-right');
  expect(readStoredOrientationPref({
    getItem() {
      throw new Error('blocked');
    },
  })).toBe('portrait');

  // OrientationProvider propagates orientation and rotationDeg to descendants
  const Probe = () => {
    const ctx = useControllerOrientation();
    return <span>{ctx.orientation()}:{ctx.rotationDeg()}</span>;
  };
  expect(renderToString(() => <Probe />)).toContain('portrait:0');
  expect(
    renderToString(() => (
      <OrientationProvider orientation="landscape" rotationDeg={90}>
        <Probe />
      </OrientationProvider>
    )),
  ).toContain('landscape:90');
  expect(
    renderToString(() => (
      <OrientationProvider orientation="landscape" rotationDeg={-90}>
        <Probe />
      </OrientationProvider>
    )),
  ).toContain('landscape:-90');

  // ControllerStage renders data-orientation and data-rotation attributes cleanly
  const stageHtml = renderToString(() => (
    <ControllerStage pref="landscape-left" nativePortraitOverride={true}>
      <OrientationToggle value="landscape-left" disabled={false} onChange={() => {}} />
    </ControllerStage>
  ));
  expect(stageHtml).toContain('data-orientation="landscape"');
  expect(stageHtml).toContain('data-rotation="90"');
  expect(stageHtml).toContain('data-pref="landscape-left"');
  expect(stageHtml).toContain('data-active="true"');
  expect(stageHtml).not.toContain('disabled');

  // When game mounts (view() !== null -> disabled={true}), all 3 toggle buttons are disabled
  const lockedHtml = renderToString(() => (
    <OrientationToggle value="landscape-right" disabled={true} onChange={() => {}} />
  ));
  expect(lockedHtml.match(/\bdisabled\b/g)).toHaveLength(3);
  expect(lockedHtml).toContain('data-pref="landscape-right"');
});
