import { expect, test, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    CANVAS: 1,
    Scale: { NONE: 0 },
    Game: class {},
    Scene: class {},
  },
}));

import { CYBER_PALETTE, worldToScreen } from './renderer.ts';

test('renderer palette excludes reserved console yellow #F5C518 and maps world coordinates cleanly', () => {
  for (const hex of Object.values(CYBER_PALETTE)) {
    expect(hex).not.toBe(0xf5c518);
  }
  expect(CYBER_PALETTE.paper).toBe(0xf4f1ea);
  expect(CYBER_PALETTE.ink).toBe(0x111111);

  const center = worldToScreen(0, 0, 400, 400, 1);
  expect(center).toEqual({ x: 400, y: 400 });
  const corner = worldToScreen(-400, 400, 400, 400, 0.5);
  expect(corner).toEqual({ x: 200, y: 600 });
});
