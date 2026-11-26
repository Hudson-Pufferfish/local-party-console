import { expect, test } from 'vitest';
import {
  BOMB_CONSTANTS as C,
  BOMB_FLAG_ALIVE,
  BOMB_HEADER as H,
  BOMB_PHASE as P,
  BOMB_PLAYER_BASE as PLAYER,
  BOMB_PLAYER_STRIDE as STRIDE,
  BOMB_ROUND_FLAG as RF,
} from './constants.ts';
import { bannerCopy, matchWinnerTag } from './banner.ts';
import {
  scoreboardHeader,
  scoreboardRows,
  scoreRules,
  shortTag,
  targetScoreForCount,
} from './scoreboard.ts';

function makeState(): Float32Array {
  const s = new Float32Array(C.stateFloats);
  s[H.arenaRadius] = C.arenaRadius;
  s[H.bombHolder] = -1;
  return s;
}

function setPlayer(s: Float32Array, slot: number, x: number, y: number, score: number, alive = true): void {
  const base = PLAYER + slot * STRIDE;
  s[base] = x;
  s[base + 1] = y;
  s[base + 8] = alive ? BOMB_FLAG_ALIVE : 0;
  s[base + 9] = score;
}

test('scoreboard formats threshold, sudden death, 6-char shortTag rows, and score rules', () => {
  expect(targetScoreForCount(2)).toBe(3);
  expect(targetScoreForCount(4)).toBe(9);
  expect(shortTag('Hudson123', 0)).toBe('HUDSON');
  expect(shortTag('!!!', 2)).toBe('P3');

  const s = makeState();
  setPlayer(s, 0, 240, 0, 2);
  setPlayer(s, 1, -240, 0, 1);
  setPlayer(s, 2, 0, 240, 0);

  expect(scoreboardHeader(s)).toBe('THRESHOLD: 6');
  expect(scoreRules(s)).toEqual({
    guide: [
      'TOUCH A PLAYER TO PASS THE BOMB',
      'DASH, 1.5S RECHARGE',
      'THE HOLDER BLOWS UP WHEN THE FUSE ENDS',
      'LAST ONE ALIVE WINS THE ROUND',
    ],
    rows: [
      { label: '1ST', value: '+2 PTS' },
      { label: '2ND', value: '+1 PTS' },
      { label: '3RD', value: '+0 PTS' },
    ],
  });

  const rows = scoreboardRows(
    s,
    ['Alexander', 'Bea', 'Cid'],
    [
      { index: 0, connected: true },
      { index: 1, connected: false },
    ],
  );
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({ slot: 0, name: 'ALEXAN', score: 2, status: 'LIVE' });
  expect(rows[1]).toMatchObject({ slot: 1, name: 'BEA', score: 1, status: 'AWAY' });
  expect(rows[2]).toMatchObject({ slot: 2, name: 'CID', score: 0 });
  expect(rows[2]?.status).toBeUndefined();

  // Match sudden death switches header and scoreRules
  s[PLAYER + 0 * STRIDE + 9] = 6;
  s[PLAYER + 1 * STRIDE + 9] = 6;
  s[H.roundFlags] = RF.matchSuddenDeath;
  expect(scoreboardHeader(s)).toBe('SUDDEN DEATH');
  expect(scoreRules(s)).toEqual({
    guide: [
      'TOUCH A PLAYER TO PASS THE BOMB',
      'DASH, 1.5S RECHARGE',
      'THE HOLDER BLOWS UP WHEN THE FUSE ENDS',
      'LAST ONE ALIVE WINS THE ROUND',
    ],
    rows: [{ label: '1ST', value: '+1 PTS' }],
  });
});

test('banner formats BREAK, countdown, BOMB fuse, BOOM!, SUDDEN DEATH, and <TAG> WINS', () => {
  const s = makeState();
  setPlayer(s, 0, 240, 0, 0);
  setPlayer(s, 1, -240, 0, 0);
  const names = ['Hudson', 'Ada'];

  s[H.phase] = P.practice;
  s[H.phaseTimer] = 4.2;
  expect(bannerCopy(s, names)).toBe('BREAK 5');

  s[H.phase] = P.countdown;
  s[H.phaseTimer] = 2.1;
  expect(bannerCopy(s, names)).toBe('3');

  s[H.phase] = P.active;
  s[H.bombHolder] = 0;
  s[H.bombTimer] = 8.4;
  expect(bannerCopy(s, names)).toBe('BOMB 08.4');

  s[H.bombHolder] = -1;
  s[H.phaseTimer] = 0.5;
  expect(bannerCopy(s, names)).toBe('BOOM!');

  s[H.phase] = P.roundEnd;
  s[H.roundFlags] = RF.roundSuddenDeath;
  expect(bannerCopy(s, names)).toBe('SUDDEN DEATH');

  s[H.roundFlags] = 0;
  s[PLAYER + 0 * STRIDE + 9] = 3;
  s[H.phase] = P.matchOver;
  expect(matchWinnerTag(s, names)).toBe('HUDSON');
  expect(bannerCopy(s, names)).toBe('HUDSON WINS');
});
