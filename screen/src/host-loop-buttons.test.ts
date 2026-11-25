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

  // Baseline packet arrives establishing baseline (toggle = 0b0000)
  expect(loop.accept(0, 1, 0x00, 0, 0, 1000)).toBe(true);

  // Packet 2 (lost in air): Phone sent Button 1 tap: Toggle = 0b0010 (upper=2), Held = 0b0010 (lower=2) -> 0x22
  // Packet 3 (arrives): Phone released Button 1: Toggle = 0b0010 (upper=2), Held = 0 (lower=0) -> 0x20
  expect(loop.accept(0, 3, 0x20, 0, 0, 1032)).toBe(true);

  // During tick at 120Hz, host should latch Button 1 edge (bit 1 = 1) even though held=0!
  inputsApplied.length = 0;
  loop.tick(16, 1040);

  // Check that Bit 1 was latched into applyInput:
  expect(inputsApplied.some((i) => (i.buttons & (1 << 1)) !== 0)).toBe(true);

  // Next tick without new packets: latch is consumed, so Button 1 should no longer be pressed:
  inputsApplied.length = 0;
  loop.tick(16, 1056);
  expect(inputsApplied.every((i) => (i.buttons & (1 << 1)) === 0)).toBe(true);
});

test('First-packet baseline rule prevents phantom presses on match restart and phone rejoin', () => {
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

  // Match 2 starts fresh: Host's lastToggles is 0.
  // Phone's toggle was left at 0b0001 (Button 0 tapped odd times in Match 1).
  // First packet of Match 2 arrives with Toggle=1, Held=0:
  expect(loop.accept(0, 100, 0x10, 0, 0, 2000)).toBe(true);

  inputsApplied.length = 0;
  loop.tick(16, 2016);

  // Assert NO phantom press occurred for Button 0!
  expect(inputsApplied.every((i) => (i.buttons & 1) === 0)).toBe(true);

  // Now, phone physically taps Button 0 in Match 2 -> Toggle flips from 1 to 0, Held = 1 -> Byte 5 = 0x01
  expect(loop.accept(0, 101, 0x01, 0, 0, 2032)).toBe(true);
  inputsApplied.length = 0;
  loop.tick(16, 2048);

  // Now Button 0 edge SHOULD fire!
  expect(inputsApplied.some((i) => (i.buttons & 1) === 1)).toBe(true);

  // Case 2: Phone refreshes / rejoins. clearSeq(0) is called:
  loop.clearSeq(0);

  // Phone reloads, resets its toggles to 0b0000, Held=0.
  // Arriving packet after clearSeq:
  expect(loop.accept(0, 1, 0x00, 0, 0, 3000)).toBe(true);
  inputsApplied.length = 0;
  loop.tick(16, 3016);

  // Assert NO phantom press occurred on phone rejoin:
  expect(inputsApplied.every((i) => (i.buttons & 1) === 0)).toBe(true);
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

  // Baseline packet (toggles = 0)
  loop.accept(0, 1, 0x00, 0, 0, 1000);

  // Incoming packet: Toggles for buttons 0, 2, 3 changed (0b1101 = 13 = 0xD)
  // Byte 5 = 0xD0
  expect(loop.accept(0, 2, 0xd0, 0, 0, 1016)).toBe(true);

  inputsApplied.length = 0;
  loop.tick(16, 1020);

  // Latch should contain bits 0, 2, 3 = 0b1101 (13)
  expect(inputsApplied.some((i) => (i.buttons & 0b1101) === 0b1101)).toBe(true);
});
