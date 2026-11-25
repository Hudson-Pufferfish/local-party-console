import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { submitJoinAttempt } from './app.tsx';
import { LINK_DOWN_NOTICE, type PhoneLink, type SendResult } from './peer.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('onJoin with open socket sends room:join without flashing a transient notice and avoids double-scroll on blur', () => {
  vi.useFakeTimers();
  const notices: string[] = [];
  const names: string[] = [];
  const sent: Array<{ type: string; payload: unknown }> = [];
  let blurCalls = 0;
  let scrollCalls = 0;
  let pending = false;
  let joined = false;

  const link: PhoneLink = {
    sendText(message): SendResult {
      sent.push(message);
      return 'open';
    },
    leave() {},
    reconnect() {},
    close() {},
  };

  let timer = 0;
  const resetScroll = (): void => {
    scrollCalls += 1;
  };
  const fakeInput = {
    blur() {
      blurCalls += 1;
      resetScroll();
    },
  };

  const result = submitJoinAttempt({
    rawName: '  hudson ',
    joined,
    link,
    token: null,
    activeIsInput: true,
    blurActive: () => fakeInput.blur(),
    resetScroll,
    setName: (next) => names.push(next),
    setNotice: (next) => notices.push(next),
    setPending: (next) => {
      pending = next;
    },
    scheduleTimeout: (fn, ms) => {
      timer = Number(setTimeout(fn, ms));
    },
    isJoined: () => joined,
  });

  expect(result).toBe('open');
  expect(pending).toBe(true);
  expect(names).toEqual(['HUDSON']);
  expect(sent).toEqual([{ type: 'room:join', payload: { name: 'HUDSON' } }]);
  expect(notices).toEqual(['']);
  expect(notices).not.toContain('JOINING ROOM...');
  expect(blurCalls).toBe(1);
  expect(scrollCalls).toBe(1);

  // If still not joined after timeout, link-down notice appears
  vi.advanceTimersByTime(2000);
  expect(notices.at(-1)).toBe(LINK_DOWN_NOTICE);
  clearTimeout(timer);

  // When disconnected, immediate link-down notice appears and non-input blur scrolls once
  notices.length = 0;
  scrollCalls = 0;
  joined = false;
  const closedLink: PhoneLink = {
    ...link,
    sendText: () => 'closed',
  };
  submitJoinAttempt({
    rawName: 'Ada',
    joined,
    link: closedLink,
    token: null,
    activeIsInput: false,
    blurActive: () => {},
    resetScroll,
    setName: () => {},
    setNotice: (next) => notices.push(next),
    setPending: () => {},
    scheduleTimeout: () => {},
    isJoined: () => joined,
  });
  expect(notices).toEqual([LINK_DOWN_NOTICE]);
  expect(scrollCalls).toBe(1);
});

test('controller notice banner overlays out of flex flow so it cannot push or shrink the lobby board', () => {
  const controllerCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles.css'), 'utf8');
  const noticeBlocks = controllerCss.match(/(?:^|\n)\.notice\s*\{[^}]*\}/g) ?? [];
  const combined = noticeBlocks.join('\n');
  expect(combined).toContain('position: absolute');
  expect(combined).toContain('pointer-events: none');
  expect(combined).not.toContain('backdrop-filter');
});
