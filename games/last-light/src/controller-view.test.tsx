import { renderToString } from '@solidjs/web';
import { describe, expect, test } from 'vitest';
import { LIGHT_PHASE as P } from './constants.ts';
import {
  createInitialLightHudState,
  hapticForLightControl,
  LastLightController,
  reduceLightControl,
} from './controller-view.tsx';

describe('Last Light tap-only controller view', () => {
  test('reduceLightControl enforces host-confirmed LOCKED, blowout OUT + flashSeq, haptics, and light:state rehydration', () => {
    let hud = createInitialLightHudState();
    expect(hud.status).toBe('IN');
    expect(hud.score).toBe(0);
    expect(hud.flashSeq).toBe(0);

    // Round start sets contender to IN and non-contender to WATCHING.
    hud = reduceLightControl(
      hud,
      {
        type: 'light:round_start',
        payload: {
          roundNumber: 1,
          countdownMs: 3000,
          scores: [2, 1, 0, 0, 0, 0, 0, 0],
          suddenDeath: false,
          contenderMask: 0b011,
        },
      },
      0,
    );
    expect(hud.status).toBe('IN');
    expect(hud.score).toBe(2);

    const parked = reduceLightControl(
      hud,
      {
        type: 'light:round_start',
        payload: {
          roundNumber: 4,
          countdownMs: 3000,
          scores: [6, 6, 3, 0, 0, 0, 0, 0],
          suddenDeath: true,
          contenderMask: 0b011,
        },
      },
      2,
    );
    expect(parked.status).toBe('WATCHING');
    expect(parked.score).toBe(3);

    // Host lock confirmation for another slot keeps slot 0 IN (no false lock).
    hud = reduceLightControl(hud, { type: 'light:lock', payload: { lockedMask: 0b010 } }, 0);
    expect(hud.status).toBe('IN');

    // Host lock confirmation for slot 0 transitions status to LOCKED.
    hud = reduceLightControl(hud, { type: 'light:lock', payload: { lockedMask: 0b011 } }, 0);
    expect(hud.status).toBe('LOCKED');

    // Blowout increments flashSeq, triggers vibration haptic, preserves LOCKED for slot 0, marks OUT for unlocked slot 1.
    const blowoutMsg = {
      type: 'light:blowout',
      payload: { lockedMask: 0b001, outMask: 0b010, practice: false },
    };
    expect(hapticForLightControl(blowoutMsg, 0)).toBe(65);
    expect(hapticForLightControl(blowoutMsg, 1)).toBe(65);

    const slot0AfterBlowout = reduceLightControl(hud, blowoutMsg, 0);
    expect(slot0AfterBlowout.status).toBe('LOCKED');
    expect(slot0AfterBlowout.flashSeq).toBe(1);

    const slot1AfterBlowout = reduceLightControl(createInitialLightHudState(), blowoutMsg, 1);
    expect(slot1AfterBlowout.status).toBe('OUT');
    expect(slot1AfterBlowout.flashSeq).toBe(1);

    // Round end and match end update score.
    const afterEnd = reduceLightControl(
      slot0AfterBlowout,
      {
        type: 'light:round_end',
        payload: {
          winnerIndex: 0,
          scores: [3, 1, 0, 0, 0, 0, 0, 0],
          matchOver: true,
          suddenDeath: false,
          void: false,
        },
      },
      0,
    );
    expect(afterEnd.score).toBe(3);

    // Mid-match reconnect rehydration via light:state restores exact status & score.
    const rehydratedLocked = reduceLightControl(
      createInitialLightHudState(),
      {
        type: 'light:state',
        payload: {
          phase: P.active,
          lockedMask: 0b001,
          contenderMask: 0b011,
          scores: [5, 4, 2, 0, 0, 0, 0, 0],
        },
      },
      0,
    );
    expect(rehydratedLocked.phase).toBe(P.active);
    expect(rehydratedLocked.status).toBe('LOCKED');
    expect(rehydratedLocked.score).toBe(5);

    const rehydratedWatching = reduceLightControl(
      createInitialLightHudState(),
      {
        type: 'light:state',
        payload: {
          phase: P.active,
          lockedMask: 0b001,
          contenderMask: 0b011,
          scores: [6, 6, 3, 0, 0, 0, 0, 0],
        },
      },
      2,
    );
    expect(rehydratedWatching.status).toBe('WATCHING');
    expect(rehydratedWatching.score).toBe(3);
  });

  test('renders tap-only layout with zero joystick, LOCK IN button, status pill, and disables button on LOCKED/WATCHING', () => {
    const activeHtml = renderToString(() => (
      <LastLightController
        color="#FF4D00"
        name="Ada"
        slot={0}
        control={null}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));

    expect(activeHtml).toContain('data-preset="tap-only"');
    expect(activeHtml).toContain('LOCK IN');
    expect(activeHtml).toContain('IN');
    expect(activeHtml).toContain('0 PTS');
    expect(activeHtml).not.toContain('joystick');
    expect(activeHtml).not.toContain('<canvas');

    const lockedHtml = renderToString(() => (
      <LastLightController
        color="#FF4D00"
        name="Ada"
        slot={0}
        control={{ type: 'light:lock', payload: { lockedMask: 0b001 } }}
        onAxes={() => {}}
        onButton={() => {}}
      />
    ));

    expect(lockedHtml).toContain('LOCKED');
    expect(lockedHtml).toMatch(/disabled[^>]*>LOCKED</);
  });
});
