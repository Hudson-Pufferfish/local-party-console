import { expect, test } from 'vitest';
import { scoreboardLine } from './scoreboard';

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
