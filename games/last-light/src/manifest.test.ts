import { describe, expect, test } from 'vitest';
import { APP_THEME } from '../../../shared/src/theme.ts';
import { LAMP_FLAG, LAST_LIGHT_CONSTANTS, LIGHT_FLAG, LIGHT_HEADER } from './constants.ts';
import { LAST_LIGHT_MANIFEST } from './manifest.ts';
import { createLastLightState, readLockedMask, readPlayerLockTick } from './state.ts';

describe('LAST_LIGHT_MANIFEST and state barrier', () => {
  test('declares holistic zero-buffer 2-8 player tap-only contract without yellow lamp collision', () => {
    expect(LAST_LIGHT_MANIFEST.id).toBe('last-light');
    expect(LAST_LIGHT_MANIFEST.title).toBe('LAST LIGHT');
    expect(LAST_LIGHT_MANIFEST.minPlayers).toBe(2);
    expect(LAST_LIGHT_MANIFEST.maxPlayers).toBe(8);
    expect(LAST_LIGHT_MANIFEST.supportsTeams).toBe(false);
    expect(LAST_LIGHT_MANIFEST.supportsBots).toBe(true);
    expect(LAST_LIGHT_MANIFEST.rendererType).toBe('phaser-2d');
    expect(LAST_LIGHT_MANIFEST.viewConfig).toEqual({
      mode: 'holistic',
      inputBufferMode: 'zero-buffer',
    });
    expect(LAST_LIGHT_MANIFEST.supportedOrientations).toEqual(['portrait', 'landscape']);
    expect(LAST_LIGHT_MANIFEST.controllerLayout).toEqual({
      preset: 'tap-only',
      buttons: [{ bit: 0, glyph: 'A', label: 'LOCK IN', kind: 'tap', hapticMs: 20 }],
    });

    const yellow = APP_THEME.yellow.toUpperCase();
    for (const [token, value] of Object.entries(LAST_LIGHT_MANIFEST.themeTokens)) {
      if (token.startsWith('--lamp-')) {
        expect(value.toUpperCase()).not.toBe(yellow);
      }
    }
  });

  test('keeps blowoutTick private and hides lockTick in Float32Array(88) until revealLocksOnBlowout', () => {
    const store = createLastLightState();
    expect(store.buffer).toBeInstanceOf(Float32Array);
    expect(store.buffer.length).toBe(LAST_LIGHT_CONSTANTS.stateFloats);

    store.setBlowoutTick(777);
    store.buffer[LIGHT_HEADER.lampFlags] = LAMP_FLAG.lit;
    store.buffer[8] = LIGHT_FLAG.active | LIGHT_FLAG.joined;

    expect(store.recordLock(0, 512)).toBe(true);
    // Second lock in same blowout is ignored (INV-2).
    expect(store.recordLock(0, 600)).toBe(false);
    expect(readLockedMask(store.buffer)).toBe(1);
    // INV-8: Public snapshot keeps lockTick === -1 while LIT and never contains blowoutTick.
    expect(readPlayerLockTick(store.buffer, 0)).toBe(-1);
    expect(Array.from(store.buffer)).not.toContain(777);

    store.revealLocksOnBlowout();
    expect(readPlayerLockTick(store.buffer, 0)).toBe(512);
    expect((store.buffer[LIGHT_HEADER.lampFlags]! & LAMP_FLAG.blown) !== 0).toBe(true);
    expect((store.buffer[LIGHT_HEADER.lampFlags]! & LAMP_FLAG.lit) !== 0).toBe(false);
  });
});
