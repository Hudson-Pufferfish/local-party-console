import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import { formatSumoReadout, SumoController } from '../../games/sumo-dash/src/controller-view.tsx';
import { HudModal } from '../../shared/src/ui/hud-modal.tsx';
import { PlayerBadge } from '../../shared/src/ui/player-badge.tsx';
import { PreflightStrip } from './preflight-strip.tsx';

test('joined controller binds player CSS vars on gameplay controls while keeping preflight warnings on --warn', () => {
  const sumoHtml = renderToString(() => (
    <SumoController
      color="#651FFF"
      name="Cid"
      slot={6}
      control={null}
      onAxes={() => {}}
      onButton={() => {}}
    />
  ));
  expect(sumoHtml).toContain('--player-color:var(--player-7, #651FFF)');
  expect(sumoHtml).toContain('--player-ink:var(--player-7-ink, #F4F1EA)');
  expect(sumoHtml).toContain('>CID<');
  expect(sumoHtml).toContain('<p class="sumo-readout">ALIVE · 0 PTS</p>');
  expect(sumoHtml).toContain('controller-hands');
  expect(formatSumoReadout(true, 0)).toBe('ALIVE · 0 PTS');
  expect(formatSumoReadout(false, 2)).toBe('OUT · 2 PTS');
  expect(sumoHtml).not.toContain('var(--theme-yellow)');
  expect(sumoHtml).not.toContain('var(--accent');

  const modalHtml = renderToString(() => (
    <HudModal open={true} title="PRE-FLIGHT" body="OK" onClose={() => {}} />
  ));
  expect(modalHtml).not.toContain('var(--theme-yellow)');

  const explicitBadgeHtml = renderToString(() => (
    <PlayerBadge name="hs" label="p1" color="#FF4D00" />
  ));
  expect(explicitBadgeHtml).toContain('<p class="player-badge">');
  expect(explicitBadgeHtml).toContain('<span class="swatch" style="--player-color:#FF4D00">');
  expect(explicitBadgeHtml).toContain('>P1<');
  expect(explicitBadgeHtml).toContain('>HS<');

  const warnStripHtml = renderToString(() => (
    <PreflightStrip
      power="low-power"
      powerReady={true}
      cores={4}
      rttMs={8}
      jitterMs={1}
      orientationOk={false}
    />
  ));
  expect(warnStripHtml.match(/data-warn="true"/g)).toHaveLength(2);
  expect(warnStripHtml).toContain('TURN');

  const okStripHtml = renderToString(() => (
    <PreflightStrip
      power="ok"
      powerReady={true}
      cores={8}
      rttMs={4}
      jitterMs={1}
      orientationOk={true}
    />
  ));
  expect(okStripHtml.match(/data-warn="true"/g)).toBeNull();
  expect(okStripHtml).toContain('<span>ORIENTATION</span><span>OK</span>');

  const primitivesCss = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../shared/src/ui/primitives.css'),
    'utf8',
  );
  const joystickCapBlock = primitivesCss.match(/\.joystick-cap\s*\{[^}]*\}/)?.[0] ?? '';
  const arcadeBtnBlock = primitivesCss.match(/\.arcade-button\s*\{[^}]*\}/)?.[0] ?? '';
  const badgeBlock = primitivesCss.match(/\.player-badge\s*\{[^}]*\}/)?.[0] ?? '';
  const swatchBlock = primitivesCss.match(/\.swatch\s*\{[^}]*\}/)?.[0] ?? '';
  expect(joystickCapBlock).toContain('var(--player-color');
  expect(arcadeBtnBlock).toContain('var(--player-color');
  expect(arcadeBtnBlock).toContain('var(--player-ink');
  expect(badgeBlock).toContain('background: #ffffff');
  expect(badgeBlock).not.toContain('var(--player-color');
  expect(swatchBlock).toContain('var(--player-color');
  expect(swatchBlock).toContain('border: 2.5px solid var(--ink, #111111)');

  const controllerCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles.css'), 'utf8');
  const warnPillBlock = controllerCss.match(/\.pill\[data-warn='true'\]\s*\{[^}]*\}/)?.[0] ?? '';
  expect(warnPillBlock).toContain('var(--warn');
});
