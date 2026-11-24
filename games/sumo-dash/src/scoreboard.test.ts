import { expect, test } from 'vitest';
import { PLAYER_COLORS } from '../../../shared/src/registry';
import { scoreboardLine, scoreboardRows } from './scoreboard';

test('scoreboard keeps slot order and reads the score fields', () => {
  const state = new Float32Array(88);
  state[8] = 240;
  state[16] = 1;
  state[17] = 1;
  state[18] = -240;
  state[26] = 1;
  state[27] = 2;
  expect(scoreboardLine(state, ['Hudson', 'Dash'], 3)).toBe('hu 1/3  da 2/3');
  state[17] = 3;
  expect(scoreboardLine(state, ['Hudson', 'Dash'], 3)).toBe('hu 3/3  da 2/3');
  expect(scoreboardLine(state, ['', 'Dash'], 3)).toBe('p1 3/3  da 2/3');
});

test('scoreboard rows carry each slot puck color from PLAYER_COLORS', () => {
  const state = new Float32Array(88);
  // slot 0 (human)
  state[8] = 240;
  state[16] = 1;
  state[17] = 2;
  // slot 2 (bot / unnamed)
  state[28] = -120;
  state[36] = 1;
  state[37] = 1;
  // slot 7 (P8 warm cream)
  state[78] = 50;
  state[86] = 1;
  state[87] = 0;

  expect(scoreboardRows(state, ['Hudson', '', '', '', '', '', '', 'Ada'], 3)).toEqual([
    { slot: 0, color: PLAYER_COLORS[0], text: 'hu 2/3' },
    { slot: 2, color: PLAYER_COLORS[2], text: 'p3 1/3' },
    { slot: 7, color: PLAYER_COLORS[7], text: 'ad 0/3' },
  ]);
});
