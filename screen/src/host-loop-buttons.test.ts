import { expect, test } from 'vitest';
import { createHostLoop, type ScreenSim } from './host-loop.ts';

test('HostLoop detects 4-button taps via toggle bit flips even when packets drop and holds continuous inputs', () => {
  const inputsApplied: Array<{ player: number; buttons: number }> = [];
  const sim: ScreenSim = {
    state: new Float32Array(88),
    applyInput(playerIndex, buttons) {
      inputsApplied.push({ player: playerIndex, buttons });
    },
    step() {},
    startMatch() {},
  };

  const loop = createHostLoop(sim, undefined, () => {});
  loop.startMatch([0]);

  // Initial state: Toggle=0, Held=0
  // Packet 1 (lost): Phone sent Button 1 tap: Toggle = 0b0010 (upper=2), Held = 0b0010 (lower=2) -> 0x22
  // Packet 2 (arrives): Phone released Button 1: Toggle = 0b0010 (upper=2), Held = 0 (lower=0) -> 0x20
  // Host receives 0x20:
  expect(loop.accept(0, 1, 0x20, 0, 0, 1000)).toBe(true);

  // During tick at 120Hz, host should latch Button 1 edge (bit 1 = 1) even though held=0!
  inputsApplied.length = 0;
  loop.tick(16, 1010);

  // Check that Bit 1 was latched into applyInput:
  expect(inputsApplied.some((i) => (i.buttons & (1 << 1)) !== 0)).toBe(true);

  // Next tick without new packets: latch is consumed, so Button 1 should no longer be pressed:
  inputsApplied.length = 0;
  loop.tick(16, 1026);
  expect(inputsApplied.every((i) => (i.buttons & (1 << 1)) === 0)).toBe(true);
});

test('HostLoop latches all 4 buttons independently on simultaneous toggle flips', () => {
  const inputsApplied: Array<{ player: number; buttons: number }> = [];
  const sim: ScreenSim = {
    state: new Float32Array(88),
    applyInput(playerIndex, buttons) {
      inputsApplied.push({ player: playerIndex, buttons });
    },
    step() {},
    startMatch() {},
  };

  const loop = createHostLoop(sim, undefined, () => {});
  loop.startMatch([0]);

  // Incoming packet: Toggles for buttons 0, 2, 3 changed (0b1101 = 13 = 0xD)
  // Byte 5 = 0xD0
  expect(loop.accept(0, 1, 0xd0, 0, 0, 1000)).toBe(true);

  inputsApplied.length = 0;
  loop.tick(16, 1010);

  // Latch should contain bits 0, 2, 3 = 0b1101 (13)
  expect(inputsApplied.some((i) => (i.buttons & 0b1101) === 0b1101)).toBe(true);
});
