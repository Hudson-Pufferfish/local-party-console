import { expect, test } from 'vitest';
import type { GameViewConfig } from '../types/game';
import { standbyCopy } from './policy';

const holistic: GameViewConfig = {
  mode: 'holistic',
  inputBufferMode: 'zero-buffer',
};

test('holistic games stand by on a team view', () => {
  expect(standbyCopy('team-1', holistic)).toBe('STANDBY // THIS GAME USES HOLISTIC VIEW');
  expect(standbyCopy('holistic', holistic)).toBeNull();
});
