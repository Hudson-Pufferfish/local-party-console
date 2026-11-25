import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import { ColorClashController, formatColorReadout } from './controller-view.tsx';

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
  expect(html).toContain('class="color-readout"');
});
