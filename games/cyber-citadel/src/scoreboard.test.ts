import { expect, test } from 'vitest';
import {
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PHASE,
  CYBER_PLAYER_OFFSET,
  CYBER_STATE_FLOATS,
} from './constants.ts';
import { scoreboardHeader, scoreboardRows, scoreRules } from './scoreboard.ts';
import { playerBase } from './state.ts';

function makeState(): Float32Array {
  const s = new Float32Array(CYBER_STATE_FLOATS);
  s[CYBER_HEADER.phaseEnum] = CYBER_PHASE.WAVE_ACTIVE;
  s[CYBER_HEADER.wave] = 3;
  s[CYBER_HEADER.coreHp] = 800;

  const b0 = playerBase(0);
  s[b0 + CYBER_PLAYER_OFFSET.hp] = 75;
  s[b0 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.JOINED | CYBER_FLAG.ACTIVE;

  const b1 = playerBase(1);
  s[b1 + CYBER_PLAYER_OFFSET.hp] = 0;
  s[b1 + CYBER_PLAYER_OFFSET.flags] = CYBER_FLAG.JOINED | CYBER_FLAG.DOWNED;
  return s;
}

test('scoreboardHeader, scoreboardRows, and scoreRules format co-op wave HUD accurately', () => {
  const s = makeState();
  expect(scoreboardHeader(s)).toBe('WAVE 3/8 • CORE: 80%');

  const rows = scoreboardRows(
    s,
    ['Hudson', 'Aria', '', '', '', '', '', ''],
    [
      { index: 0, connected: true },
      { index: 1, connected: false },
    ],
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    slot: 0,
    name: 'HUDSON',
    status: 'LIVE',
    ratio: 0.75,
  });
  expect(rows[1]).toMatchObject({
    slot: 1,
    name: 'ARIA',
    status: 'AWAY',
    score: 'DOWN',
    ratio: 0,
  });

  const rules = scoreRules(s);
  expect(rules?.guide).toBeDefined();
  expect(rules?.rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
    'A: PIERCE LASER — CUTS ENTIRE ROW & STUNS (90 DMG, 2.5s CD)',
    'B: DASH ESCAPE — SPEED BURST; DODGES & STAGGERS BRUTES (1.8s CD)',
    'X: ENERGY BARRIER — PLACES WALL THAT BLOCKS FOES FOR 8s (1.5s CD)',
    'Y: REVIVE / BOMB — HOLD 2.5s NEAR ALLY OR PRESS IN BLUE RING FOR BOMB',
  ]);

  // Match over victory vs defeat headers
  s[CYBER_HEADER.phaseEnum] = CYBER_PHASE.MATCH_OVER;
  s[CYBER_HEADER.wave] = C.totalWaves;
  s[CYBER_HEADER.coreHp] = 450;
  expect(scoreboardHeader(s)).toBe('CITADEL HOLDS');

  s[CYBER_HEADER.coreHp] = 0;
  expect(scoreboardHeader(s)).toBe('CORE LOST');
});
