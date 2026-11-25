import { renderToString } from '@solidjs/web';
import { describe, expect, test } from 'vitest';
import type { ControllerLayout } from '../../shared/src/controller/layout.ts';
import { ControllerShell } from '../../shared/src/ui/index.tsx';

describe('ControllerShell', () => {
  const singleLayout: ControllerLayout = {
    preset: 'stick-1',
    buttons: [
      {
        bit: 0,
        glyph: 'A',
        label: 'DASH',
        kind: 'tap',
        cooldownMs: 1500,
      },
    ],
  };

  const diamondLayout: ControllerLayout = {
    preset: 'stick-diamond',
    buttons: [
      { bit: 0, glyph: 'A', label: 'RAIL', kind: 'tap', cooldownMs: 2500 },
      { bit: 1, glyph: 'B', label: 'DASH', kind: 'tap', cooldownMs: 1200 },
      { bit: 2, glyph: 'X', label: 'SHIELD', kind: 'hold' },
      { bit: 3, glyph: 'Y', label: 'REVIVE', kind: 'hold' },
    ],
  };

  test('renders stick-1 preset with joystick, dock button, and custom HUD', () => {
    const html = renderToString(() => (
      <ControllerShell
        color="#FF4D00"
        name="Ada"
        slot={0}
        layout={singleLayout}
        onAxes={() => {}}
        onButton={() => {}}
        hud={<span class="custom-hud-test">ALIVE · 5 PTS</span>}
      />
    ));

    expect(html).toContain('controller-shell');
    expect(html).toContain('P1');
    expect(html).toContain('ADA');
    expect(html).toContain('MOVE');
    expect(html).toContain('DASH');
    expect(html).toContain('dock-preset-single');
    expect(html).toContain('button-cooldown-meter');
    expect(html).toContain('custom-hud-test');
    expect(html).toContain('ALIVE · 5 PTS');
  });

  test('renders stick-diamond preset with all 4 diamond buttons and glyphs', () => {
    const html = renderToString(() => (
      <ControllerShell
        color="#00C853"
        name="Hudson"
        slot={1}
        layout={diamondLayout}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));

    expect(html).toContain('controller-shell');
    expect(html).toContain('P2');
    expect(html).toContain('HUDSON');
    expect(html).toContain('diamond-preset-grid');
    expect(html).toContain('diamond-slot diamond-bottom');
    expect(html).toContain('diamond-slot diamond-right');
    expect(html).toContain('diamond-slot diamond-left');
    expect(html).toContain('diamond-slot diamond-top');
    expect(html).toContain('A RAIL');
    expect(html).toContain('B DASH');
    expect(html).toContain('X SHIELD');
    expect(html).toContain('Y REVIVE');
  });
});
