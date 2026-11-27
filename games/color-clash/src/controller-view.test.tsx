import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import { boostMeterFor, ColorClashController, formatColorReadout } from './controller-view.tsx';

test('ColorClashController renders PlayerBadge, paint splash swatch, MOVE joystick, BOOST button, and live percentage readout', () => {
  expect(formatColorReadout(0, 'ready', false)).toBe('0.0% · READY');
  expect(formatColorReadout(24.5, 'boosting', false)).toBe('24.5% · BOOSTING');
  expect(formatColorReadout(24.5, 'recharge', false)).toBe('24.5% · RECHARGE');
  expect(formatColorReadout(31.2, 'ready', true)).toBe('31.2% · OVERTIME');
  expect(formatColorReadout(12.0, 'ready', true, true)).toBe('12.0% · WATCHING');

  const html = renderToString(() => (
    <ColorClashController
      color="#2979FF"
      name="Hudson"
      slot={2}
      control={{ type: 'color:scores', payload: { percents: [10.0, 15.0, 24.5, 0, 0, 0, 0, 0] } }}
      onAxes={() => {}}
      onButton={() => {}}
    />
  ));

  expect(html).toContain('--player-color:var(--player-3, #2979FF)');
  expect(html).toContain('class="color-splash"');
  expect(html).toContain('>P3<');
  expect(html).toContain('>HUDSON<');
  expect(html).toContain('MOVE');
  expect(html).toContain('BOOST');
  expect(html).toContain('class="button-cooldown-meter"');
  expect(html).toContain('data-phase="ready"');
  expect(html).toContain('transition-duration:0ms');
  expect(html).toContain('class="color-readout"');

  const watchingHtml = renderToString(() => (
    <ColorClashController
      color="#2979FF"
      name="Hudson"
      slot={2}
      control={{ type: 'color:round_start', payload: { scores: [4, 4, 2, 0, 0, 0, 0, 0], activeMask: 0b00000011 } }}
      onAxes={() => {}}
      onButton={() => {}}
    />
  ));
  expect(watchingHtml).toContain('WATCHING');
  expect(watchingHtml).toContain('data-phase="ready"');

  const overtimeHtml = renderToString(() => (
    <ColorClashController
      color="#2979FF"
      name="Hudson"
      slot={2}
      control={{ type: 'color:overtime', payload: { contenderMask: 0 } }}
      onAxes={() => {}}
      onButton={() => {}}
    />
  ));
  expect(overtimeHtml).toContain('WATCHING');
  expect(overtimeHtml).toContain('data-phase="ready"');
  expect(overtimeHtml).toContain('transition-duration:0ms');
});

test('boostMeterFor maps ready, drain, and recharge to the host 3s active and 5s fill', () => {
  expect(boostMeterFor('ready', 3000, 8000)).toEqual({ phase: 'ready', ms: 0 });
  expect(boostMeterFor('boosting', 3000, 8000)).toEqual({ phase: 'drain', ms: 3000 });
  expect(boostMeterFor('recharge', 3000, 8000)).toEqual({ phase: 'fill', ms: 5000 });
});
