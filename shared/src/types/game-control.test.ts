import { describe, expect, test } from 'vitest';
import {
  ALLOWED_GAME_PREFIXES,
  PAD_STATE_TYPE,
  isGameControlMessageType,
  isGameControlPrefix,
  parsePadStatePayload,
  readPadStateMessage,
} from './game-control.ts';

describe('game-control message helpers', () => {
  test('ALLOWED_GAME_PREFIXES contains message prefixes for games and pad', () => {
    expect(ALLOWED_GAME_PREFIXES).toEqual(['sumo', 'bomb', 'color', 'cyber', 'pad', 'light']);
    expect(isGameControlPrefix('sumo')).toBe(true);
    expect(isGameControlPrefix('bomb')).toBe(true);
    expect(isGameControlPrefix('color')).toBe(true);
    expect(isGameControlPrefix('cyber')).toBe(true);
    expect(isGameControlPrefix('pad')).toBe(true);
    expect(isGameControlPrefix('light')).toBe(true);
    expect(isGameControlPrefix('phone')).toBe(false);
    expect(isGameControlPrefix('room')).toBe(false);
  });

  test('isGameControlMessageType correctly matches allowed prefix with colon', () => {
    expect(isGameControlMessageType('sumo:round_start')).toBe(true);
    expect(isGameControlMessageType('bomb:holder')).toBe(true);
    expect(isGameControlMessageType('color:boost')).toBe(true);
    expect(isGameControlMessageType('cyber:wave_start')).toBe(true);
    expect(isGameControlMessageType('pad:state')).toBe(true);
    expect(isGameControlMessageType('light:lock')).toBe(true);

    // Non-game control messages
    expect(isGameControlMessageType('phone:tier')).toBe(false);
    expect(isGameControlMessageType('phone:longtask')).toBe(false);
    expect(isGameControlMessageType('room:phase')).toBe(false);
    expect(isGameControlMessageType('viewport:hello')).toBe(false);
    expect(isGameControlMessageType('signal:offer')).toBe(false);
    expect(isGameControlMessageType('net:ping')).toBe(false);
    expect(isGameControlMessageType('unknown')).toBe(false);
  });

  test('parsePadStatePayload and readPadStateMessage validate slot, labels, disabled mask, and cooldownEndsAt', () => {
    const valid = parsePadStatePayload({
      slot: 2,
      labels: ['RAIL', 'DASH', 'SHIELD', 'EMP'],
      disabled: 0b1000,
      cooldownEndsAt: [12000, 0, 0, 0],
    });
    expect(valid).toEqual({
      slot: 2,
      labels: ['RAIL', 'DASH', 'SHIELD', 'EMP'],
      disabled: 8,
      cooldownEndsAt: [12000, 0, 0, 0],
    });

    expect(
      readPadStateMessage({ type: PAD_STATE_TYPE, payload: { slot: 2, labels: ['', '', '', 'JOINED'] } }, 2),
    ).toEqual({
      slot: 2,
      labels: ['', '', '', 'JOINED'],
    });
    // Slot mismatch or wrong message type returns null.
    expect(
      readPadStateMessage({ type: PAD_STATE_TYPE, payload: { slot: 1, labels: ['', '', '', 'EMP'] } }, 2),
    ).toBeNull();
    expect(
      readPadStateMessage({ type: 'cyber:wave_start', payload: { slot: 2 } }, 2),
    ).toBeNull();

    // Invalid slot bounds or non-object payloads return null.
    expect(parsePadStatePayload(null)).toBeNull();
    expect(parsePadStatePayload({ slot: -1 })).toBeNull();
    expect(parsePadStatePayload({ slot: 8 })).toBeNull();
    expect(parsePadStatePayload({ slot: 1.5 })).toBeNull();
  });
});
