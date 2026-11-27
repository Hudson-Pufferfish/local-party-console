import { expect, it } from 'vitest';
import { writeHeuristic } from '../../games/sumo-dash/src/heuristic.ts';
import { createSumoSimulation } from '../../games/sumo-dash/src/simulation.ts';
import type { PlayerSlot } from '../../shared/src/types/game.ts';
import {
  botMaskAfterHumanLeave,
  clampBotCount,
  createBotFill,
  createBotLobby,
  lockBotCount,
  nextBotCount,
  nextBotDifficulty,
  rosterForStart,
  startBlockReason,
  startNotice,
  unlockBotCount,
} from './bot-fill.ts';

const SUMO = { minPlayers: 2, maxPlayers: 8, supportsBots: true };
const OVER_CAP = 'exceed max — modify bot count';
const NO_HUMAN = 'need minimum one real player';

function player(index: number, connected: boolean): PlayerSlot {
  return { index, name: '', color: '#111111', teamId: null, connected };
}

function humans(count: number): PlayerSlot[] {
  const list: PlayerSlot[] = [];
  for (let index = 0; index < count; index += 1) list.push(player(index, true));
  return list;
}

function reason(humanCount: number, bots: number, supportsBots = true, occupied = humanCount) {
  return startBlockReason({
    humans: humanCount,
    occupied,
    bots,
    minPlayers: 2,
    maxPlayers: 8,
    supportsBots,
  });
}

it('default bot count is 0 and difficulty is medium', () => {
  expect(createBotLobby()).toEqual({ botCount: 0, difficulty: 'medium', locked: false });
});

it('bot toggle is a no-op when no human is connected', () => {
  const state = createBotLobby();
  const next = nextBotCount(state, { requested: 2, humans: 0, occupied: 0, maxPlayers: 8, supportsBots: true });
  expect(next).toBe(state);
  expect(next.botCount).toBe(0);
});

it('one human and one bot enables start', () => {
  const state = nextBotCount(createBotLobby(), { requested: 1, humans: 1, occupied: 1, maxPlayers: 8, supportsBots: true });
  expect(reason(1, state.botCount)).toBeNull();
  const roster = rosterForStart([player(0, true)], SUMO, state.botCount);
  expect(roster).not.toBeNull();
  expect(roster?.slots).toHaveLength(2);
  let bits = 0;
  for (const bit of roster?.botMask ?? []) bits += bit;
  expect(bits).toBe(1);
});

it('one human and zero bots disables start', () => {
  const block = reason(1, 0);
  expect(block).toBe('below-min');
  expect(startNotice(block)).toBe('');
  expect(rosterForStart([player(0, true)], SUMO, 0)).toBeNull();
});

it('four humans and four bots enable start', () => {
  const state = nextBotCount(createBotLobby(), { requested: 4, humans: 4, occupied: 4, maxPlayers: 8, supportsBots: true });
  expect(reason(4, state.botCount)).toBeNull();
  expect(rosterForStart(humans(4), SUMO, state.botCount)?.slots).toHaveLength(8);
});

it('fifth human over cap disables start', () => {
  const state = nextBotCount(createBotLobby(), { requested: 4, humans: 4, occupied: 4, maxPlayers: 8, supportsBots: true });
  const block = reason(5, state.botCount);
  expect(block).toBe('over-cap');
  expect(startNotice(block)).toBe(OVER_CAP);
  expect(state.botCount).toBe(4);
  expect(rosterForStart(humans(5), SUMO, state.botCount)).toBeNull();
});

it('fifth human quitting enables start again', () => {
  const state = nextBotCount(createBotLobby(), { requested: 4, humans: 4, occupied: 4, maxPlayers: 8, supportsBots: true });
  expect(reason(5, state.botCount)).toBe('over-cap');
  expect(state.botCount).toBe(4);
  expect(reason(4, state.botCount)).toBeNull();
  expect(rosterForStart(humans(4), SUMO, state.botCount)?.slots).toHaveLength(8);
});

it('locked bot count ignores a change', () => {
  const state = lockBotCount(nextBotCount(createBotLobby(), { requested: 1, humans: 1, occupied: 1, maxPlayers: 8, supportsBots: true }));
  const next = nextBotCount(state, { requested: 4, humans: 1, occupied: 1, maxPlayers: 8, supportsBots: true });
  expect(next).toBe(state);
  expect(next).toEqual({ botCount: 1, difficulty: 'medium', locked: true });
});

it('last human leaving disables start', () => {
  const state = nextBotCount(createBotLobby(), { requested: 2, humans: 1, occupied: 1, maxPlayers: 8, supportsBots: true });
  const block = reason(0, state.botCount);
  expect(block).toBe('no-human');
  expect(startNotice(block)).toBe(NO_HUMAN);
  expect(state.botCount).toBe(2);
  expect(rosterForStart([], SUMO, state.botCount)).toBeNull();
});

it('bots alone do not enable start', () => {
  const block = reason(0, 2);
  expect(block).toBe('no-human');
  expect(startNotice(block)).toBe(NO_HUMAN);
  expect(rosterForStart([], SUMO, 2)).toBeNull();
});

it('lowering bots after over cap enables start', () => {
  const stored = nextBotCount(createBotLobby(), { requested: 4, humans: 4, occupied: 4, maxPlayers: 8, supportsBots: true });
  expect(reason(5, stored.botCount)).toBe('over-cap');
  const state = nextBotCount(stored, { requested: 3, humans: 5, occupied: 5, maxPlayers: 8, supportsBots: true });
  expect(state.botCount).toBe(3);
  expect(reason(5, state.botCount)).toBeNull();
  expect(rosterForStart(humans(5), SUMO, state.botCount)).not.toBeNull();
});

it('minus walks a count down when it is more than one over the cap', () => {
  const stored = nextBotCount(createBotLobby(), { requested: 4, humans: 4, occupied: 4, maxPlayers: 8, supportsBots: true });
  const once = nextBotCount(stored, { requested: 3, humans: 6, occupied: 6, maxPlayers: 8, supportsBots: true });
  expect(once.botCount).toBe(3);
  expect(reason(6, once.botCount)).toBe('over-cap');
  const twice = nextBotCount(once, { requested: 2, humans: 6, occupied: 6, maxPlayers: 8, supportsBots: true });
  expect(twice.botCount).toBe(2);
  expect(reason(6, twice.botCount)).toBeNull();
  expect(nextBotCount(stored, { requested: 5, humans: 6, occupied: 6, maxPlayers: 8, supportsBots: true }).botCount).toBe(4);
});

it('a raise above remaining seats is rejected', () => {
  expect(clampBotCount(5, 4, 8)).toBe(4);
  const state = nextBotCount(createBotLobby(), { requested: 4, humans: 4, occupied: 4, maxPlayers: 8, supportsBots: true });
  const next = nextBotCount(state, { requested: 5, humans: 4, occupied: 4, maxPlayers: 8, supportsBots: true });
  expect(next).toBe(state);
  expect(next.botCount).toBe(4);
  expect(reason(4, next.botCount)).toBeNull();
});

it('play again keeps the frozen count and the lobby unlocks at that count', () => {
  const locked = lockBotCount(nextBotCount(createBotLobby(), { requested: 2, humans: 2, occupied: 2, maxPlayers: 8, supportsBots: true }));
  const roster = rosterForStart(humans(2), SUMO, locked.botCount);
  expect(locked.locked).toBe(true);
  expect(roster?.slots).toHaveLength(4);
  let bits = 0;
  for (const bit of roster?.botMask ?? []) bits += bit;
  expect(bits).toBe(2);
  const unlocked = unlockBotCount(locked);
  expect(unlocked.botCount).toBe(2);
  expect(unlocked.locked).toBe(false);
  expect(createBotLobby()).toEqual({ botCount: 0, difficulty: 'medium', locked: false });
});

it('a human leave during a match does not add a bot', () => {
  const state = lockBotCount(nextBotCount(createBotLobby(), { requested: 1, humans: 2, occupied: 2, maxPlayers: 8, supportsBots: true }));
  const roster = rosterForStart(humans(2), SUMO, state.botCount);
  const mask = roster?.botMask ?? new Uint8Array(8);
  const next = botMaskAfterHumanLeave(mask, 0);
  expect(next).not.toBe(mask);
  expect(Array.from(next)).toEqual(Array.from(mask));
  expect(next[0]).toBe(0);
  expect(state.botCount).toBe(1);
  let bits = 0;
  for (const bit of next) bits += bit;
  expect(bits).toBe(1);
});

it('a second human does not change the bot count', () => {
  const state = nextBotCount(createBotLobby(), { requested: 1, humans: 1, occupied: 1, maxPlayers: 8, supportsBots: true });
  expect(state).toEqual({ botCount: 1, difficulty: 'medium', locked: false });
  expect(reason(2, state.botCount)).toBeNull();
  const roster = rosterForStart(humans(2), SUMO, state.botCount);
  expect(roster?.slots).toHaveLength(3);
  let bits = 0;
  for (const bit of roster?.botMask ?? []) bits += bit;
  expect(bits).toBe(1);
});

it('an away slot stays occupied', () => {
  const roster = rosterForStart([player(0, true), player(1, false)], SUMO, 1);
  expect(roster?.slots).toEqual([0, 2]);
  expect(roster?.botMask[1]).toBe(0);
  expect(roster?.botMask[2]).toBe(1);
  expect(roster?.botMask.length).toBe(8);
});

it('bot fill calls applyInput', () => {
  const sim = createSumoSimulation();
  sim.startMatch([0, 1]);
  let guard = 0;
  while (sim.state[1] !== 0 && guard < 4000) {
    sim.step(1 / 120);
    guard += 1;
  }
  sim.state[0] = 0;
  sim.state[18] = 340;
  sim.state[19] = 0;
  const fill = createBotFill(writeHeuristic);
  const roster = rosterForStart([player(0, true)], SUMO, 1);
  expect(roster).not.toBeNull();
  fill.arm(roster?.botMask ?? new Uint8Array(8));
  expect(fill.fill(0, sim)).toBe(false);
  expect(fill.fill(1, sim)).toBe(true);
  expect(sim.state[22]).toBeCloseTo(Math.PI);
});

it('supportsBots false adds no bots', () => {
  const off = { minPlayers: 2, maxPlayers: 8, supportsBots: false };
  expect(reason(1, 4, false)).toBe('below-min');
  expect(nextBotCount(createBotLobby(), { requested: 3, humans: 2, occupied: 2, maxPlayers: 8, supportsBots: false }).botCount).toBe(0);
  const roster = rosterForStart([player(0, true), player(1, true)], off, 3);
  expect(roster?.slots).toEqual([0, 1]);
  expect(Array.from(roster?.botMask ?? [])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

it('nextBotDifficulty updates while unlocked and arm forwards difficulty to levelsFor', () => {
  const start = createBotLobby();
  const hard = nextBotDifficulty(start, 'hard', true);
  expect(hard).toEqual({ botCount: 0, difficulty: 'hard', locked: false });
  expect(nextBotDifficulty(hard, 'easy', false)).toBe(hard);
  const locked = lockBotCount(hard);
  expect(nextBotDifficulty(locked, 'easy', true)).toBe(locked);
  expect(unlockBotCount(locked).difficulty).toBe('hard');

  const seen: string[] = [];
  const fill = createBotFill(writeHeuristic, (_mask, difficulty) => {
    seen.push(difficulty ?? 'none');
    return Uint8Array.from([0, 62, 0, 0, 0, 0, 0, 0]);
  });
  fill.arm(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0]), 'hard');
  expect(seen).toEqual(['hard']);
});

it('rosterForStart assigns lowest-available unique P{X} bot names avoiding human names', () => {
  const named = (index: number, name: string): PlayerSlot => ({
    index,
    name,
    color: '#111111',
    teamId: null,
    connected: true,
  });

  const rosterA = rosterForStart([named(0, 'P1'), named(1, 'P2'), named(2, 'P3')], SUMO, 1);
  expect(rosterA?.botNames).toEqual(['', '', '', 'P4', '', '', '', '']);

  const rosterB = rosterForStart([named(0, 'P1'), named(1, 'P3')], SUMO, 2);
  expect(rosterB?.botNames).toEqual(['', '', 'P2', 'P4', '', '', '', '']);

  const rosterC = rosterForStart([named(0, 'p2')], SUMO, 2);
  expect(rosterC?.botNames).toEqual(['', 'P1', 'P3', '', '', '', '', '']);

  const rosterD = rosterForStart([named(0, 'ALICE'), named(1, 'P1')], SUMO, 2);
  expect(rosterD?.botNames).toEqual(['', '', 'P2', 'P3', '', '', '', '']);
});

it('createBotFill forwards sim.auxState to writeBotInput', () => {
  const auxState = new Uint8Array(16);
  auxState[5] = 7;
  let seenAux: Uint8Array | undefined;
  const fill = createBotFill((_state, slot, axisX, _axisY, _buttons, _level, aux) => {
    seenAux = aux;
    axisX[slot] = 64;
  });
  fill.arm(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0]));
  let appliedX = 0;
  const sim = {
    state: new Float32Array(88),
    auxState,
    applyInput(_slot: number, _buttons: number, x: number) {
      appliedX = x;
    },
  };
  expect(fill.fill(1, sim)).toBe(true);
  expect(seenAux).toBe(auxState);
  expect(appliedX).toBe(64);
});

it('createBotFill supports opt-in standbyLevelFor takeover and stops immediately when returning 0', () => {
  let seenLevel: number | undefined;
  let appliedX = 0;
  let standbyLevel = 0;

  const fill = createBotFill(
    (_state, slot, axisX, _axisY, _buttons, level) => {
      seenLevel = level;
      axisX[slot] = 90;
    },
    undefined,
    (_state, slot) => (slot === 0 ? standbyLevel : 0),
  );
  // Slot 0 is a human slot (botMask[0] === 0)
  fill.arm(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]));
  const sim = {
    state: new Float32Array(88),
    applyInput(_slot: number, _buttons: number, x: number) {
      appliedX = x;
    },
  };

  expect(fill.fill(0, sim)).toBe(false);
  expect(appliedX).toBe(0);

  // AWAY takeover engages at Medium level 40
  standbyLevel = 40;
  expect(fill.fill(0, sim)).toBe(true);
  expect(seenLevel).toBe(40);
  expect(appliedX).toBe(90);

  // Human reconnects -> standbyLevel returns 0 -> handback immediate
  standbyLevel = 0;
  appliedX = 0;
  expect(fill.fill(0, sim)).toBe(false);
  expect(appliedX).toBe(0);
});

it('AWAY players count as seats: 4 LIVE + 2 AWAY caps bots at 2', () => {
  // occupied=6 leaves 2 seats (maxPlayers 8 - occupied 6).
  // nextBotCount does not auto-apply a raise that is above the cap; it only
  // stores the clamped value when requested is within the remaining seats.
  // That is the same rule as "a raise above remaining seats is rejected".
  expect(clampBotCount(4, 6, 8)).toBe(2);
  const withinCap = nextBotCount(createBotLobby(), {
    requested: 2,
    humans: 4,
    occupied: 6,
    maxPlayers: 8,
    supportsBots: true,
  });
  expect(withinCap.botCount).toBe(2);
  const raiseAboveCap = nextBotCount(createBotLobby(), {
    requested: 4,
    humans: 4,
    occupied: 6,
    maxPlayers: 8,
    supportsBots: true,
  });
  expect(raiseAboveCap.botCount).toBe(0);
});

it('AWAY players plus a stored over-cap bot count disable start and show the over-cap notice', () => {
  // 4 LIVE + 2 AWAY, with botCount already 4 (for example: 4 LIVE + 4 bots, then 2 more phones join and lock).
  // startEnabled in app.tsx is rosterForStart(...) !== null, so null means START is disabled.
  // botNotice in app.tsx is startNotice(startBlockReason(...)), so the OVER_CAP notice must be shown too.
  const players = [
    player(0, true),
    player(1, true),
    player(2, true),
    player(3, true),
    player(4, false),
    player(5, false),
  ];
  const state = { botCount: 4, difficulty: 'medium' as const, locked: false };
  const block = startBlockReason({
    humans: 4,
    occupied: 6,
    bots: state.botCount,
    minPlayers: SUMO.minPlayers,
    maxPlayers: SUMO.maxPlayers,
    supportsBots: SUMO.supportsBots,
  });
  expect(block).toBe('over-cap');
  expect(startNotice(block)).toBe(OVER_CAP);
  expect(rosterForStart(players, SUMO, state.botCount)).toBeNull();
});

it('kicking AWAY players makes a previously over-cap lobby startable again', () => {
  const withAway = [
    player(0, true),
    player(1, true),
    player(2, true),
    player(3, true),
    player(4, false),
    player(5, false),
  ];
  const state = { botCount: 4, difficulty: 'medium' as const, locked: false };
  expect(rosterForStart(withAway, SUMO, state.botCount)).toBeNull();
  const afterKick = humans(4);
  const roster = rosterForStart(afterKick, SUMO, state.botCount);
  expect(roster).not.toBeNull();
  expect(roster?.slots).toHaveLength(8);
  const block = startBlockReason({
    humans: 4,
    occupied: 4,
    bots: state.botCount,
    minPlayers: SUMO.minPlayers,
    maxPlayers: SUMO.maxPlayers,
    supportsBots: SUMO.supportsBots,
  });
  expect(block).toBeNull();
  expect(startNotice(block)).toBe('');
});

it('all joined players AWAY keeps nextBotCount a no-op and blocks start with no-human', () => {
  const awayPlayers = [player(0, false), player(1, false)];
  const empty = createBotLobby();
  const raised = nextBotCount(empty, {
    requested: 2,
    humans: 0,
    occupied: awayPlayers.length,
    maxPlayers: SUMO.maxPlayers,
    supportsBots: SUMO.supportsBots,
  });
  expect(raised).toBe(empty);
  expect(raised.botCount).toBe(0);

  const stored = { botCount: 4, difficulty: 'medium' as const, locked: false };
  const lowered = nextBotCount(stored, {
    requested: 1,
    humans: 0,
    occupied: awayPlayers.length,
    maxPlayers: SUMO.maxPlayers,
    supportsBots: SUMO.supportsBots,
  });
  expect(lowered).toBe(stored);

  const block = startBlockReason({
    humans: 0,
    occupied: awayPlayers.length,
    bots: 2,
    minPlayers: SUMO.minPlayers,
    maxPlayers: SUMO.maxPlayers,
    supportsBots: SUMO.supportsBots,
  });
  expect(block).toBe('no-human');
  expect(startNotice(block)).toBe(NO_HUMAN);
  expect(rosterForStart(awayPlayers, SUMO, 2)).toBeNull();

  const overCapBlock = startBlockReason({
    humans: 0,
    occupied: 6,
    bots: 4,
    minPlayers: SUMO.minPlayers,
    maxPlayers: SUMO.maxPlayers,
    supportsBots: SUMO.supportsBots,
  });
  expect(overCapBlock).toBe('no-human');
});
