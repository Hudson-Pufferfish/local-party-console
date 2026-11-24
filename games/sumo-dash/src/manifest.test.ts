import { expect, test } from 'vitest';
import { SUMO_DASH_MANIFEST } from './manifest';

test('sumo-dash manifest is the v1 holistic contract', () => {
  expect(SUMO_DASH_MANIFEST.id).toBe('sumo-dash');
  const view = SUMO_DASH_MANIFEST.viewConfig;
  expect(view.mode).toBe('holistic');
  if (view.mode !== 'holistic') return;
  expect(view.inputBufferMode).toBe('zero-buffer');
  expect(SUMO_DASH_MANIFEST.supportsBots).toBe(true);
  expect(SUMO_DASH_MANIFEST.minPlayers).toBe(2);
  expect(SUMO_DASH_MANIFEST.maxPlayers).toBe(8);
});
