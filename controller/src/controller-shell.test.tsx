import { renderToString } from '@solidjs/web';
import { describe, expect, test } from 'vitest';
import type { ControllerLayout } from '../../shared/src/controller/layout.ts';
import { ControllerShell } from '../../shared/src/ui/index.tsx';

describe('ControllerShell', () => {
  const singleLayout: ControllerLayout = {
    preset: 'stick-single',
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

  test('renders stick-single preset with joystick, dock button, and custom HUD', () => {
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

  test('renders alert slot only when non-empty, and avoids rendering empty container', () => {
    // When alert is undefined
    const htmlNoAlert = renderToString(() => (
      <ControllerShell
        color="#FF4D00"
        name="Ada"
        slot={0}
        layout={singleLayout}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));
    expect(htmlNoAlert).not.toContain('controller-shell-alert');

    // When alert is a Show with false condition
    const htmlFalseAlert = renderToString(() => (
      <ControllerShell
        color="#FF4D00"
        name="Ada"
        slot={0}
        layout={singleLayout}
        onAxes={() => {}}
        onButton={() => {}}
        alert={null}
      />
    ));
    expect(htmlFalseAlert).not.toContain('controller-shell-alert');

    // When alert is provided with content
    const htmlWithAlert = renderToString(() => (
      <ControllerShell
        color="#FF4D00"
        name="Ada"
        slot={0}
        layout={singleLayout}
        onAxes={() => {}}
        onButton={() => {}}
        alert={<div class="bomb-alert">HOLDING BOMB</div>}
      />
    ));
    expect(htmlWithAlert).toContain('controller-shell-alert');
    expect(htmlWithAlert).toContain('HOLDING BOMB');
  });

  test('button cooldown meter applies 0ms transition duration when inactive', () => {
    const html = renderToString(() => (
      <ControllerShell
        color="#FF4D00"
        name="Ada"
        slot={0}
        layout={singleLayout}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));
    // When initially rendered (inactive), data-active is false and transition-duration is 0ms
    expect(html).toContain('button-cooldown-meter');
    expect(html).toContain('data-active="false"');
    expect(html).toContain('transition-duration:0ms');
  });

  test('ControllerShell applies pad:state dynamic Button Y label and disabled mask only for matching slot', () => {
    const empHtml = renderToString(() => (
      <ControllerShell
        color="#00C853"
        name="Hudson"
        slot={1}
        layout={diamondLayout}
        control={{
          type: 'pad:state',
          payload: {
            slot: 1,
            labels: ['', '', '', 'EMP'],
            disabled: 0,
          },
        }}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));
    expect(empHtml).toContain('A RAIL');
    expect(empHtml).toContain('B DASH');
    expect(empHtml).toContain('X SHIELD');
    expect(empHtml).toContain('Y EMP');
    expect(empHtml).not.toContain('Y REVIVE');

    // Dimmed/disabled Button Y via disabled bitmask (bit 3 = 8)
    const dimmedHtml = renderToString(() => (
      <ControllerShell
        color="#00C853"
        name="Hudson"
        slot={1}
        layout={diamondLayout}
        padState={{
          slot: 1,
          labels: ['RAIL', 'DASH', 'SHIELD', 'JOINED'],
          disabled: 1 << 3,
        }}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));
    expect(dimmedHtml).toContain('Y JOINED');
    expect(dimmedHtml).toMatch(/disabled[^>]*>Y JOINED</);

    // Mismatched slot ignores pad:state override and keeps manifest default label.
    const otherSlotHtml = renderToString(() => (
      <ControllerShell
        color="#00C853"
        name="Hudson"
        slot={1}
        layout={diamondLayout}
        control={{
          type: 'pad:state',
          payload: {
            slot: 3,
            labels: ['', '', '', 'EMP'],
            disabled: 1 << 3,
          },
        }}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));
    expect(otherSlotHtml).toContain('Y REVIVE');
    expect(otherSlotHtml).not.toContain('Y EMP');
  });
});
