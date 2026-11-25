import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { attemptAutoResume, submitJoinAttempt } from './app.tsx';
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

test('attemptAutoResume dispatches room:join with stored token and name on load, or skips when no token exists', () => {
  vi.useFakeTimers();
  const sent: Array<{ type: string; payload: unknown }> = [];
  const notices: string[] = [];
  const names: string[] = [];
  let pending = false;
  let joined = false;
  const link: PhoneLink = {
    sendText(message): SendResult {
      sent.push(message);
      return 'queued';
    },
    leave() {},
    reconnect() {},
    close() {},
  };

  // Without stored token, auto-resume is skipped
  expect(attemptAutoResume({
    token: null,
    storedName: 'ADA',
    link,
    setName: (next) => names.push(next),
    setNotice: (next) => notices.push(next),
    setPending: (next) => {
      pending = next;
    },
    scheduleTimeout: () => {},
    isJoined: () => joined,
  })).toBe('skipped');
  expect(sent).toEqual([]);
  expect(pending).toBe(false);

  // With stored token and stored name, auto-resume pre-fills name and queues room:join
  let timer = 0;
  expect(attemptAutoResume({
    token: 'tok-ada',
    storedName: 'ada',
    link,
    setName: (next) => names.push(next),
    setNotice: (next) => notices.push(next),
    setPending: (next) => {
      pending = next;
    },
    scheduleTimeout: (fn, ms) => {
      timer = Number(setTimeout(fn, ms));
    },
    isJoined: () => joined,
  })).toBe('queued');
  expect(names).toEqual(['ADA']);
  expect(sent).toEqual([
    { type: 'room:join', payload: { name: 'ADA', sessionToken: 'tok-ada' } },
  ]);
  expect(pending).toBe(true);
  expect(notices).toEqual(['JOINING ROOM...']);

  vi.advanceTimersByTime(2000);
  expect(notices.at(-1)).toBe(LINK_DOWN_NOTICE);
  clearTimeout(timer);

  // With stored token and no stored name, auto-resume still dispatches token rejoin with empty name
  sent.length = 0;
  expect(attemptAutoResume({
    token: 'tok-ada',
    storedName: null,
    link,
    setName: () => {},
    setNotice: () => {},
    setPending: () => {},
    scheduleTimeout: () => {},
    isJoined: () => false,
  })).toBe('queued');
  expect(sent).toEqual([
    { type: 'room:join', payload: { name: '', sessionToken: 'tok-ada' } },
  ]);
});
