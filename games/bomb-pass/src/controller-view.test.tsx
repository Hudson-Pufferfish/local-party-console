import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import {
  BombPassController,
  createInitialBombHudState,
  formatBombReadout,
  hapticForBombControl,
  reduceBombControl,
} from './controller-view.tsx';

test('BombPassController renders SAFE LED, red danger alert when holding bomb, and OUT on explosion', () => {
  const safeHtml = renderToString(() => (
    <BombPassController
      color="#FF4D00"
      name="Ada"
      slot={0}
      control={null}
      onAxes={() => {}}
      onButton={() => {}}
    />
  ));
  expect(safeHtml).toContain('data-bomb="false"');
  expect(safeHtml).toContain('SAFE · 0 PTS');
  expect(safeHtml).toContain('bomb-led');
  expect(safeHtml).toContain('MOVE');
  expect(safeHtml).toContain('DASH');
  expect(safeHtml).not.toContain('HOLDING BOMB — PASS IT!');

  const holdingHtml = renderToString(() => (
    <BombPassController
      color="#FF4D00"
      name="Ada"
      slot={0}
      control={{
        type: 'bomb:holder',
        payload: {
          holderIndex: 0,
          previousHolder: -1,
          remainingMs: 4200,
          transferCooldownMs: 500,
          reason: 'transfer',
        },
      }}
      onAxes={() => {}}
      onButton={() => {}}
    />
  ));
  expect(holdingHtml).toContain('data-bomb="true"');
  expect(holdingHtml).toContain('data-urgency="warn"');
  expect(holdingHtml).toMatch(/HOLDING BOMB (?:—|&#8212;) PASS IT!/);
  expect(holdingHtml).toContain('BOMB! 04.2s');

  const css = fs.readFileSync(path.resolve(import.meta.dirname, 'controller-view.css'), 'utf8');
  expect(css).not.toContain('backdrop-filter');
  expect(css).not.toContain('linear-gradient');
  expect(css).toContain('#E10600');
});

test('reduceBombControl and hapticForBombControl handle holder transitions, pass-away, explosion, and round reset', () => {
  let hud = createInitialBombHudState();
  expect(formatBombReadout(hud)).toBe('SAFE · 0 PTS');

  // Receive bomb at 1.8s remaining (critical)
  const receiveMsg = {
    type: 'bomb:holder',
    payload: {
      holderIndex: 2,
      previousHolder: 0,
      remainingMs: 1800,
      transferCooldownMs: 500,
      reason: 'transfer',
    },
  };
  hud = reduceBombControl(hud, receiveMsg, 2);
  expect(hud.holdingBomb).toBe(true);
  expect(hud.urgency).toBe('critical');
  expect(formatBombReadout(hud)).toBe('BOMB! 01.8s');
  expect(hapticForBombControl(receiveMsg, 2)).toBe(35);

  // Pass bomb to slot 3 -> clears holdingBomb and triggers 15ms relief haptic
  const passMsg = {
    type: 'bomb:holder',
    payload: {
      holderIndex: 3,
      previousHolder: 2,
      remainingMs: 1400,
      transferCooldownMs: 500,
      reason: 'transfer',
    },
  };
  hud = reduceBombControl(hud, passMsg, 2);
  expect(hud.holdingBomb).toBe(false);
  expect(hud.urgency).toBe('none');
  expect(formatBombReadout(hud)).toBe('SAFE · 0 PTS');
  expect(hapticForBombControl(passMsg, 2)).toBe(15);

  // Explosion containing slot 2 marks OUT with 80ms haptic
  const boomMsg = {
    type: 'bomb:explosion',
    payload: {
      eliminatedIndices: [2],
      blastX: 0,
      blastY: 0,
      aliveCount: 1,
      suddenDeathTriggered: false,
    },
  };
  hud = reduceBombControl(hud, boomMsg, 2);
  expect(hud.alive).toBe(false);
  expect(hud.holdingBomb).toBe(false);
  expect(formatBombReadout(hud)).toBe('OUT · 0 PTS');
  expect(hapticForBombControl(boomMsg, 2)).toBe(80);

  // New round resets alive & updates score
  hud = reduceBombControl(
    hud,
    {
      type: 'bomb:round_start',
      payload: { roundNumber: 2, countdownMs: 3000, scores: [0, 0, 2, 0, 0, 0, 0, 0], suddenDeath: false },
    },
    2,
  );
  expect(hud.alive).toBe(true);
  expect(hud.score).toBe(2);
  expect(formatBombReadout(hud)).toBe('SAFE · 2 PTS');
});
