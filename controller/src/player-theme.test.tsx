import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import { SumoController } from '../../games/sumo-dash/src/controller-view.tsx';
import { HudModal } from '../../shared/src/ui/hud-modal.tsx';
import { PreflightStrip } from './preflight-strip.tsx';

test('joined controller binds player CSS vars on gameplay controls while keeping preflight warnings on --warn', () => {
  const sumoHtml = renderToString(() => (
    <SumoController
      color="#111111"
      name="Cid"
      slot={6}
      control={null}
      onAxes={() => {}}
      onButton={() => {}}
    />
  ));
  expect(sumoHtml).toContain('--player-color:var(--player-7, #111111)');
  expect(sumoHtml).toContain('--player-ink:var(--player-7-ink, #F4F1EA)');
  expect(sumoHtml).not.toContain('var(--theme-yellow)');
  expect(sumoHtml).not.toContain('var(--accent');

  const modalHtml = renderToString(() => (
    <HudModal open={true} title="PRE-FLIGHT" body="OK" onClose={() => {}} />
  ));
  expect(modalHtml).not.toContain('var(--theme-yellow)');

  const stripHtml = renderToString(() => (
    <PreflightStrip
      power="low-power"
      powerReady={true}
      cores={4}
      rttMs={8}
      jitterMs={1}
      portrait={true}
    />
  ));
  expect(stripHtml.match(/data-warn="true"/g)).toHaveLength(2);

  const primitivesCss = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../shared/src/ui/primitives.css'),
    'utf8',
  );
  const joystickCapBlock = primitivesCss.match(/\.joystick-cap\s*\{[^}]*\}/)?.[0] ?? '';
  const arcadeBtnBlock = primitivesCss.match(/\.arcade-button\s*\{[^}]*\}/)?.[0] ?? '';
  const badgeBlock = primitivesCss.match(/\.player-badge\s*\{[^}]*\}/)?.[0] ?? '';
  expect(joystickCapBlock).toContain('var(--player-color');
  expect(arcadeBtnBlock).toContain('var(--player-color');
  expect(arcadeBtnBlock).toContain('var(--player-ink');
  expect(badgeBlock).toContain('var(--player-color');
  expect(badgeBlock).toContain('var(--player-ink');

  const controllerCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles.css'), 'utf8');
  const warnPillBlock = controllerCss.match(/\.pill\[data-warn='true'\]\s*\{[^}]*\}/)?.[0] ?? '';
  expect(warnPillBlock).toContain('var(--warn');
});
