import { describe, expect, test } from 'vitest';
import { ALLOWED_GAME_PREFIXES, isGameControlMessageType, isGameControlPrefix } from './game-control.ts';

describe('game-control message helpers', () => {
  test('ALLOWED_GAME_PREFIXES contains message prefixes for games and pad', () => {
    expect(ALLOWED_GAME_PREFIXES).toEqual(['sumo', 'bomb', 'color', 'cyber', 'pad']);
    expect(isGameControlPrefix('sumo')).toBe(true);
    expect(isGameControlPrefix('bomb')).toBe(true);
    expect(isGameControlPrefix('color')).toBe(true);
    expect(isGameControlPrefix('cyber')).toBe(true);
    expect(isGameControlPrefix('pad')).toBe(true);
    expect(isGameControlPrefix('phone')).toBe(false);
    expect(isGameControlPrefix('room')).toBe(false);
  });

  test('isGameControlMessageType correctly matches allowed prefix with colon', () => {
    expect(isGameControlMessageType('sumo:round_start')).toBe(true);
    expect(isGameControlMessageType('bomb:holder')).toBe(true);
    expect(isGameControlMessageType('color:boost')).toBe(true);
    expect(isGameControlMessageType('cyber:wave_start')).toBe(true);
    expect(isGameControlMessageType('pad:state')).toBe(true);

    // Non-game control messages
    expect(isGameControlMessageType('phone:tier')).toBe(false);
    expect(isGameControlMessageType('phone:longtask')).toBe(false);
    expect(isGameControlMessageType('room:phase')).toBe(false);
    expect(isGameControlMessageType('viewport:hello')).toBe(false);
    expect(isGameControlMessageType('signal:offer')).toBe(false);
    expect(isGameControlMessageType('net:ping')).toBe(false);
    expect(isGameControlMessageType('unknown')).toBe(false);
  });
});
