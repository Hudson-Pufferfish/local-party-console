import { expect, test } from 'vitest';
import { CYBER_CITADEL_MANIFEST } from './manifest.ts';

test('CYBER_CITADEL_MANIFEST satisfies holistic zero-buffer stick-diamond co-op contract', () => {
  expect(CYBER_CITADEL_MANIFEST.id).toBe('cyber-citadel');
  expect(CYBER_CITADEL_MANIFEST.minPlayers).toBe(1);
  expect(CYBER_CITADEL_MANIFEST.maxPlayers).toBe(8);
  expect(CYBER_CITADEL_MANIFEST.supportsTeams).toBe(false);
  expect(CYBER_CITADEL_MANIFEST.maxTeams).toBe(0);
  expect(CYBER_CITADEL_MANIFEST.supportsBots).toBe(true);
  expect(CYBER_CITADEL_MANIFEST.rendererType).toBe('phaser-2d');
  expect(CYBER_CITADEL_MANIFEST.viewConfig).toEqual({
    mode: 'holistic',
    inputBufferMode: 'zero-buffer',
  });
  expect(CYBER_CITADEL_MANIFEST.controllerLayout.preset).toBe('stick-diamond');
  expect(CYBER_CITADEL_MANIFEST.controllerLayout.buttons).toHaveLength(4);
  expect(CYBER_CITADEL_MANIFEST.controllerLayout.buttons[0]).toMatchObject({
    bit: 0,
    glyph: 'A',
    label: 'RAIL',
    kind: 'tap',
    cooldownMs: 2500,
  });
  expect(CYBER_CITADEL_MANIFEST.controllerLayout.buttons[1]).toMatchObject({
    bit: 1,
    glyph: 'B',
    label: 'DASH',
    kind: 'tap',
  });
  expect(CYBER_CITADEL_MANIFEST.controllerLayout.buttons[2]).toMatchObject({
    bit: 2,
    glyph: 'X',
    label: 'SHIELD',
    kind: 'tap',
  });
  expect(CYBER_CITADEL_MANIFEST.controllerLayout.buttons[3]).toMatchObject({
    bit: 3,
    glyph: 'Y',
    label: 'REVIVE',
    kind: 'tap',
  });
  // Yellow #F5C518 is reserved for console UI chrome, never a game-entity accent
  for (const val of Object.values(CYBER_CITADEL_MANIFEST.themeTokens)) {
    expect(val.toUpperCase()).not.toBe('#F5C518');
  }
});
