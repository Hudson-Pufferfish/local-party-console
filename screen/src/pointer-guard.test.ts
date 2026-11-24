import { expect, test } from 'vitest';
import {
  installPointerGuard,
  type GuardEvent,
  type PointerGuardDocument,
} from './pointer-guard.ts';

interface FakeNode {
  closest: (selector: string) => FakeNode | null;
}

function makeTarget(matches: string[]): FakeNode {
  return {
    closest(selector: string) {
      const parts = selector.split(',').map((item) => item.trim());
      return parts.some((part) => matches.includes(part)) ? this : null;
    },
  };
}

function makeDocument() {
  const listeners = new Map<string, Set<(event: GuardEvent) => void>>();
  let blurred = 0;
  let cleared = 0;
  const activeElement = {
    blur() {
      blurred += 1;
    },
  };
  const body = {};
  const doc: PointerGuardDocument = {
    body,
    activeElement,
    defaultView: {
      getSelection() {
        return {
          isCollapsed: false,
          removeAllRanges() {
            cleared += 1;
          },
        };
      },
    },
    addEventListener(type, listener) {
      let set = listeners.get(type);
      if (set === undefined) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };

  function dispatch(type: string, event: { target: unknown; detail?: number }): boolean {
    let prevented = false;
    const payload = {
      ...event,
      preventDefault() {
        prevented = true;
      },
    };
    for (const listener of listeners.get(type) ?? []) {
      listener(payload);
    }
    return prevented;
  }

  return {
    doc,
    dispatch,
    blurred: () => blurred,
    cleared: () => cleared,
  };
}

test('pointer guard blocks button mouse focus/selection and multi-click selection, while preserving inputs', () => {
  const env = makeDocument();
  const uninstall = installPointerGuard(env.doc);

  expect(env.dispatch('mousedown', { target: makeTarget(['button']), detail: 1 })).toBe(true);
  expect(env.blurred()).toBe(1);
  expect(env.cleared()).toBe(1);

  expect(env.dispatch('mousedown', { target: makeTarget([]), detail: 2 })).toBe(true);
  expect(env.dispatch('mousedown', { target: makeTarget([]), detail: 1 })).toBe(false);
  expect(env.dispatch('mousedown', { target: makeTarget(['input']), detail: 2 })).toBe(false);

  expect(env.dispatch('selectstart', { target: makeTarget(['button']) })).toBe(true);
  expect(env.dispatch('selectstart', { target: makeTarget(['textarea']) })).toBe(false);

  uninstall();
  expect(env.dispatch('mousedown', { target: makeTarget(['button']), detail: 1 })).toBe(false);
});
