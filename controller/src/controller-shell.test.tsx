import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ControllerLayout } from '../../shared/src/controller/layout.ts';
import { ControllerShell } from '../../shared/src/ui/index.tsx';
import { pressControllerButton } from '../../shared/src/ui/controller-shell.tsx';

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

  test('controlled meter renders the drain phase while other buttons keep the local cooldown meter', () => {
    const html = renderToString(() => (
      <ControllerShell
        color="#00C853"
        name="Hudson"
        slot={1}
        layout={diamondLayout}
        meters={{ 0: { phase: 'drain', ms: 3000 } }}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));

    expect(html).toContain('data-phase="drain"');
    expect(html).toContain('transition-duration:3000ms');
    expect(html).toContain('data-active="false"');
    expect(html).toContain('transition-duration:0ms');
  });

  test('phased cooldown meter draws an ink top border so the ready bar stays distinct on P2 green', () => {
    const shellCss = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../shared/src/ui/controller-shell.css'),
      'utf8',
    );
    const phasedBlock =
      shellCss.match(/\.button-cooldown-meter\[data-phase\]\s*\{[^}]*\}/)?.[0] ?? '';

    expect(phasedBlock).toContain('border-top: 2px solid var(--ink, #111111)');
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

  test('renders tap-only preset without joystick and applies dynamic label and disabled mask', () => {
    const tapOnlyLayout: ControllerLayout = {
      preset: 'tap-only',
      buttons: [{ bit: 0, glyph: 'A', label: 'BUZZ', kind: 'tap' }],
    };

    const activeHtml = renderToString(() => (
      <ControllerShell
        color="#FF4D00"
        name="Ada"
        slot={0}
        layout={tapOnlyLayout}
        onAxes={() => {}}
        onButton={() => {}}
        hud={<span class="tap-hud">IN · 0 PTS</span>}
      />
    ));

    expect(activeHtml).toContain('data-preset="tap-only"');
    expect(activeHtml).toContain('tap-only-preset');
    expect(activeHtml).toContain('BUZZ');
    expect(activeHtml).not.toContain('joystick');
    expect(activeHtml).not.toContain('MOVE');

    const lockedHtml = renderToString(() => (
      <ControllerShell
        color="#FF4D00"
        name="Ada"
        slot={0}
        layout={tapOnlyLayout}
        padState={{
          slot: 0,
          labels: ['BUZZED'],
          disabled: 1,
        }}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));

    expect(lockedHtml).toContain('BUZZED');
    expect(lockedHtml).toMatch(/disabled[^>]*>BUZZED</);
  });

  test('pressing a button with hapticMs vibrates or clicks the iOS switch label, and skips when disabled', () => {
    const hapticLayout: ControllerLayout = {
      preset: 'stick-single',
      buttons: [{ bit: 0, glyph: 'A', label: 'DASH', kind: 'tap', hapticMs: 20 }],
    };
    const html = renderToString(() => (
      <ControllerShell
        color="#FF4D00"
        name="Ada"
        slot={0}
        layout={hapticLayout}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));
    const labelMatch = html.match(
      /<label\b([^>]*class="controller-taptic-switch"[^>]*)>(.*?)<\/label>/s,
    );
    expect(labelMatch).not.toBeNull();
    const labelAttrs = labelMatch?.[1] ?? '';
    const labelBody = labelMatch?.[2] ?? '';
    expect(labelAttrs).toContain('aria-hidden="true"');
    expect(labelBody).toMatch(/<input\b[^>]*type="checkbox"/);
    expect(labelBody).toContain('tabindex="-1"');
    expect(labelBody).toMatch(/\sswitch(?:\s|>|\/)/);

    const shellCss = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../shared/src/ui/controller-shell.css'),
      'utf8',
    );
    const tapticBlock = shellCss.match(/\.controller-taptic-switch\s*\{[^}]*\}/)?.[0] ?? '';
    expect(tapticBlock).toContain('overflow: hidden');
    expect(tapticBlock).toContain('opacity: 0');
    expect(tapticBlock).toContain('pointer-events: none');

    const order: string[] = [];
    const onButton = () => {
      order.push('send');
    };
    const arm = () => {
      order.push('ui');
    };
    const taptic = {
      click: () => {
        order.push('taptic');
      },
    };

    vi.stubGlobal('navigator', {
      vibrate: (ms: number) => {
        order.push(`vibrate:${ms}`);
        return true;
      },
    });
    pressControllerButton(true, 10, 0, false, 20, onButton, true, 1500, arm, taptic);
    expect(order).toEqual(['send', 'ui', 'vibrate:20']);

    order.length = 0;
    vi.stubGlobal('navigator', {});
    pressControllerButton(true, 11, 0, false, 20, onButton, true, 1500, arm, taptic);
    expect(order).toEqual(['send', 'ui', 'taptic']);

    order.length = 0;
    pressControllerButton(true, 12, 0, true, 20, onButton, true, 1500, arm, taptic);
    expect(order).toEqual([]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
