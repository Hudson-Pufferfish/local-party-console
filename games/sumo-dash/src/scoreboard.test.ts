import { expect, test } from 'vitest';
import { PLAYER_COLORS } from '../../../shared/src/registry';
import {
  hasUniqueWinner,
  isSuddenDeath,
  scoreboardHeader,
  scoreboardLine,
  scoreboardRows,
  scoreRules,
  targetScoreForCount,
} from './scoreboard';

test('scoreboard keeps slot order, shows clean scores without slash, and formats threshold header', () => {
  const state = new Float32Array(88);
  state[8] = 240;
  state[16] = 1;
  state[17] = 1;
  state[18] = -240;
  state[26] = 1;
  state[27] = 2;
  expect(scoreboardHeader(state)).toBe('THRESHOLD: 3');
  expect(scoreboardLine(state, ['Hudson', 'Dash'])).toBe('HUDSON 1  DASH 2');
  state[17] = 3;
  expect(scoreboardLine(state, ['Hudson', 'Dash'])).toBe('HUDSON 3  DASH 2');
  expect(scoreboardLine(state, ['', 'Dash'])).toBe('P1 3  DASH 2');
  expect(scoreboardLine(state, ['x', 'p2'])).toBe('X 3  P2 2');
  expect(scoreboardLine(state, ['Alexander', 'A-B_C 1234'])).toBe('ALEXAN 3  ABC123 2');

  // 4 active players -> threshold = (4 - 1) * 3 = 9
  state[28] = 120;
  state[36] = 1;
  state[37] = 4;
  state[38] = -120;
  state[46] = 0; // eliminated, still active via non-zero position
  state[47] = 0;
  expect(scoreboardHeader(state)).toBe('THRESHOLD: 9');
  expect(scoreboardLine(state, ['Hudson', 'Dash', 'Ada', ''])).toBe('HUDSON 3  DASH 2  ADA 4  P4 0');

  // Tied leaders >= threshold switch header to SUDDEN DEATH while keeping all rows visible
  state[17] = 9;
  state[37] = 9;
  expect(isSuddenDeath(state)).toBe(true);
  expect(hasUniqueWinner(state)).toBe(false);
  expect(scoreboardHeader(state)).toBe('SUDDEN DEATH');
  expect(scoreRules(state)).toEqual({ rows: [{ label: '1ST', value: '+1 PTS' }] });
  expect(scoreboardLine(state, ['Hudson', 'Dash', 'Ada', ''])).toBe('HUDSON 9  DASH 2  ADA 9  P4 0');

  state[17] = 10;
  expect(isSuddenDeath(state)).toBe(false);
  expect(hasUniqueWinner(state)).toBe(true);
  expect(scoreboardHeader(state)).toBe('THRESHOLD: 9');
  expect(scoreRules(state)).toEqual({
    rows: [
      { label: '1ST', value: '+3 PTS' },
      { label: '2ND', value: '+2 PTS' },
      { label: '3RD', value: '+1 PTS' },
      { label: '4TH', value: '+0 PTS' },
    ],
  });
});

test('scoreboard rows carry puck colors and scoreRules formats rank payouts for the left HUD', () => {
  const state = new Float32Array(88);
  // 8 active players -> threshold = (8 - 1) * 3 = 21
  for (let slot = 0; slot < 8; slot += 1) {
    const base = 8 + slot * 10;
    state[base] = 240;
    state[base + 8] = 1;
    state[base + 9] = slot;
  }

  expect(targetScoreForCount(2)).toBe(3);
  expect(targetScoreForCount(4)).toBe(9);
  expect(targetScoreForCount(8)).toBe(21);
  expect(scoreboardHeader(state)).toBe('THRESHOLD: 21');

  const rows = scoreboardRows(state, ['Hudson', '', '', '', '', '', '', 'Ada']);
  expect(rows[0]).toEqual({ slot: 0, color: PLAYER_COLORS[0], text: 'HUDSON 0' });
  expect(rows[2]).toEqual({ slot: 2, color: PLAYER_COLORS[2], text: 'P3 2' });
  expect(rows[7]).toEqual({ slot: 7, color: PLAYER_COLORS[7], text: 'ADA 7' });

  const statusRows = scoreboardRows(
    state,
    ['Hudson', 'P2', '', '', '', '', '', 'Ada'],
    [
      { index: 0, connected: true },
      { index: 7, connected: false },
    ],
  );
  expect(statusRows[0]).toEqual({ slot: 0, color: PLAYER_COLORS[0], text: 'HUDSON 0', status: 'LIVE' });
  expect(statusRows[1]).toEqual({ slot: 1, color: PLAYER_COLORS[1], text: 'P2 1' });
  expect(statusRows[7]).toEqual({ slot: 7, color: PLAYER_COLORS[7], text: 'ADA 7', status: 'AWAY' });

  const rules = scoreRules(state);
  expect(rules).toEqual({
    rows: [
      { label: '1ST', value: '+7 PTS' },
      { label: '2ND', value: '+6 PTS' },
      { label: '3RD', value: '+5 PTS' },
      { label: '4TH', value: '+4 PTS' },
      { label: '5TH', value: '+3 PTS' },
      { label: '6TH', value: '+2 PTS' },
      { label: '7TH', value: '+1 PTS' },
      { label: '8TH', value: '+0 PTS' },
    ],
  });
});
