import { expect, test } from 'vitest';
import {
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_HEADER,
  CYBER_PHASE,
  CYBER_STATE_FLOATS,
} from './constants.ts';
import { bannerCopy } from './banner.ts';

test('bannerCopy formats countdown, wave active, wave break, and win/loss banners', () => {
  const s = new Float32Array(CYBER_STATE_FLOATS);
  s[CYBER_HEADER.phaseEnum] = CYBER_PHASE.COUNTDOWN;
  s[CYBER_HEADER.phaseTimer] = 2.4;
  s[CYBER_HEADER.wave] = 1;
  s[CYBER_HEADER.coreHp] = C.coreMaxHp;
  expect(bannerCopy(s)).toBe('3');

  s[CYBER_HEADER.phaseEnum] = CYBER_PHASE.WAVE_ACTIVE;
  s[CYBER_HEADER.wave] = 4;
  expect(bannerCopy(s)).toBe('WAVE 4');

  s[CYBER_HEADER.phaseEnum] = CYBER_PHASE.WAVE_BREAK;
  s[CYBER_HEADER.phaseTimer] = 11.2;
  expect(bannerCopy(s)).toBe('BREAK 12');

  s[CYBER_HEADER.phaseEnum] = CYBER_PHASE.MATCH_OVER;
  s[CYBER_HEADER.wave] = 8;
  s[CYBER_HEADER.coreHp] = 200;
  expect(bannerCopy(s)).toBe('CITADEL HOLDS');

  s[CYBER_HEADER.coreHp] = 0;
  expect(bannerCopy(s)).toBe('CORE LOST');
});
