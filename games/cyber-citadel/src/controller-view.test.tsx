import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import { CyberCitadelController, formatCyberReadout } from './controller-view.tsx';

test('CyberCitadelController renders stick-diamond controls, dynamic pad:state Y label, readout, and iOS EMP flash hook', () => {
  expect(formatCyberReadout(3, false, false)).toBe('WAVE 3/8');
  expect(formatCyberReadout(5, true, false)).toBe('WAVE 5/8 · DOWNED');
  expect(formatCyberReadout(8, false, true)).toBe('WAVE 8/8 · SUPER BOMB');

  const html = renderToString(() => (
    <CyberCitadelController
      color="#2979FF"
      name="Hudson"
      slot={2}
      control={{ type: 'cyber:wave_start', payload: { wave: 4 } }}
      padState={{ slot: 2, labels: ['LASER', 'DASH', 'WALL', 'BOMB'], disabled: 0 }}
      onAxes={() => {}}
      onButton={() => {}}
    />
  ));

  expect(html).toContain('--player-color:var(--player-3, #2979FF)');
  expect(html).toContain('>P3<');
  expect(html).toContain('>HUDSON<');
  expect(html).toContain('A LASER');
  expect(html).toContain('B DASH');
  expect(html).toContain('X WALL');
  expect(html).toContain('Y BOMB');
  expect(html).toContain('WAVE 4/8');
  expect(html).toContain('cyber-taptic-switch');
});
