import { expect, test } from 'vitest';
import { PLAYER_COLORS } from '../../../shared/src/registry';
import { scoreboardLine, scoreboardRows, scoreRules, targetScoreForCount } from './scoreboard';

test('scoreboard keeps slot order, scales target by active player count, and reads score fields', () => {
  const state = new Float32Array(88);
  state[8] = 240;
  state[16] = 1;
  state[17] = 1;
  state[18] = -240;
  state[26] = 1;
  state[27] = 2;
  expect(scoreboardLine(state, ['Hudson', 'Dash'])).toBe('hu 1/3  da 2/3');
  state[17] = 3;
  expect(scoreboardLine(state, ['Hudson', 'Dash'], 3)).toBe('hu 3/3  da 2/3');
  expect(scoreboardLine(state, ['', 'Dash'], 3)).toBe('p1 3/3  da 2/3');

  // 4 active players -> target = (4 - 1) * 3 = 9
  state[28] = 120;
  state[36] = 1;
  state[37] = 0;
  state[38] = -120;
  state[46] = 0; // eliminated, still active via non-zero position
  state[47] = 0;
  expect(scoreboardLine(state, ['Hudson', 'Dash', 'Ada', ''])).toBe('hu 3/9  da 2/9  ad 0/9  p4 0/9');
});

test('scoreboard rows carry puck colors and scoreRules formats target and rank payouts cleanly', () => {
  const state = new Float32Array(88);
  // 8 active players -> target = (8 - 1) * 3 = 21
  for (let slot = 0; slot < 8; slot += 1) {
    const base = 8 + slot * 10;
    state[base] = 240;
    state[base + 8] = 1;
    state[base + 9] = slot;
  }

  expect(targetScoreForCount(2)).toBe(3);
  expect(targetScoreForCount(4)).toBe(9);
  expect(targetScoreForCount(8)).toBe(21);

  const rows = scoreboardRows(state, ['Hudson', '', '', '', '', '', '', 'Ada']);
  expect(rows[0]).toEqual({ slot: 0, color: PLAYER_COLORS[0], text: 'hu 0/21' });
  expect(rows[2]).toEqual({ slot: 2, color: PLAYER_COLORS[2], text: 'p3 2/21' });
  expect(rows[7]).toEqual({ slot: 7, color: PLAYER_COLORS[7], text: 'ad 7/21' });

  const rules = scoreRules(state);
  expect(rules).toEqual({
    target: 'TARGET: >= 21 PTS',
    rows: [
      { label: '1ST', value: '+7' },
      { label: '2ND', value: '+6' },
      { label: '3RD', value: '+5' },
      { label: '4TH', value: '+4' },
      { label: '5TH', value: '+3' },
      { label: '6TH', value: '+2' },
      { label: '7TH', value: '+1' },
      { label: '8TH', value: '+0' },
    ],
  });
});
