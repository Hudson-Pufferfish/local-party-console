import { expect, test } from 'vitest';
import {
  BUTTON_BIT,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PLAYER_OFFSET,
  ENEMY_TYPE,
} from './constants.ts';
import { levelsForMask, standbyBotLevel, writeHeuristic } from './heuristic.ts';
import { createCyberCitadelSimulation } from './simulation.ts';
import { playerBase } from './state.ts';

test('levelsForMask maps difficulty tiers into documented skill ranges', () => {
  const mask = new Uint8Array([0, 1, 1, 0, 0, 0, 0, 0]);
  const easy = levelsForMask(mask, 'easy', () => 0.5);
  expect(easy[1]).toBeGreaterThanOrEqual(11);
  expect(easy[1]).toBeLessThanOrEqual(20);
  const hard = levelsForMask(mask, 'hard', () => 0.5);
  expect(hard[1]).toBeGreaterThanOrEqual(50);
  expect(hard[1]).toBeLessThanOrEqual(70);
  expect(hard[0]).toBe(0);
});

test('heuristic prioritizes urgent <5.0s human revive over downed bot and joins EMP only when a human started it', () => {
  const sim = createCyberCitadelSimulation();
  const botMask = new Uint8Array([0, 1, 1, 0, 0, 0, 0, 0]);
  const botLevels = new Uint8Array([0, 45, 45, 0, 0, 0, 0, 0]);
  sim.startMatch([0, 1, 2], 606, { botMask, botLevels });
  sim.jumpToWave(3);
  sim.clearSpawnQueueForTest();
  sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, -360, -360, 0, 9999);

  const axisX = new Int8Array(8);
  const axisY = new Int8Array(8);
  const buttons = new Uint8Array(8);

  // Bot 1 inside Core ring with NO human EMP_JOINED -> must NOT press Y to initiate EMP solo (FR-9.12)
  const b0 = playerBase(0);
  const b1 = playerBase(1);
  const b2 = playerBase(2);
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 260;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = 70;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = 0;
  writeHeuristic(sim.state, 1, axisX, axisY, buttons, 45, sim.auxState);
  expect(buttons[1]! & BUTTON_BIT.REVIVE_EMP).toBe(0);

  // Human P0 enters Core ring and joins EMP -> Bot 1 moves in / presses Y to join EMP
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 75;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[b0 + CYBER_PLAYER_OFFSET.flags] =
    sim.state[b0 + CYBER_PLAYER_OFFSET.flags]! | CYBER_FLAG.EMP_JOINED;
  sim.state[CYBER_HEADER.tickId] = 200; // trigger role re-eval
  writeHeuristic(sim.state, 1, axisX, axisY, buttons, 45, sim.auxState);
  expect(buttons[1]! & BUTTON_BIT.REVIVE_EMP).not.toBe(0);

  // Urgent human revive (<5.0s bleed-out) beats closer downed bot
  sim.state[b0 + CYBER_PLAYER_OFFSET.flags] =
    sim.state[b0 + CYBER_PLAYER_OFFSET.flags]! & ~CYBER_FLAG.EMP_JOINED;
  sim.state[b0 + CYBER_PLAYER_OFFSET.x] = 200;
  sim.state[b0 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.downPlayerForTest(0);
  sim.state[b0 + CYBER_PLAYER_OFFSET.downTimer] = 3.2;

  sim.state[b2 + CYBER_PLAYER_OFFSET.x] = -20;
  sim.state[b2 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.downPlayerForTest(2);
  sim.state[b2 + CYBER_PLAYER_OFFSET.downTimer] = 12.0;

  sim.state[b1 + CYBER_PLAYER_OFFSET.x] = 80;
  sim.state[b1 + CYBER_PLAYER_OFFSET.y] = 0;
  sim.state[CYBER_HEADER.tickId] = 210; // urgent interrupt even before 1.0s
  writeHeuristic(sim.state, 1, axisX, axisY, buttons, 50, sim.auxState);
  // Bot 1 steers +X toward urgent downed human P0 at x=200 (not -X toward bot P2 at x=-20)
  expect(axisX[1]).toBeGreaterThan(50);
});

test('AWAY disconnect pauses bleed-out, activates STANDBY_BOT at 3.0s, and hands control back on reconnect', () => {
  const sim = createCyberCitadelSimulation();
  sim.startMatch([0, 1], 707);
  sim.jumpToWave(1);
  sim.clearSpawnQueueForTest();
  sim.spawnEnemyForTest(ENEMY_TYPE.BRUTE, -360, -360, 0, 9999);

  const b0 = playerBase(0);
  expect(standbyBotLevel(sim.state, 0)).toBe(0);

  // Disconnect P0 while ACTIVE: after 2.0s still no standby bot; after 3.1s standby bot engages at level 40
  sim.setConnectedMask(0b10);
  for (let i = 0; i < 240; i += 1) sim.step(C.dt);
  expect(standbyBotLevel(sim.state, 0)).toBe(0);
  for (let i = 0; i < 140; i += 1) sim.step(C.dt);
  expect(standbyBotLevel(sim.state, 0)).toBe(C.standbyBotLevel);

  // Reconnect P0: immediate handback to human (standbyBotLevel -> 0)
  sim.setConnectedMask(0b11);
  expect(standbyBotLevel(sim.state, 0)).toBe(0);

  // Disconnect while DOWNED pauses bleed-out timer
  sim.downPlayerForTest(0);
  const timerStart = sim.state[b0 + CYBER_PLAYER_OFFSET.downTimer]!;
  sim.setConnectedMask(0b10);
  for (let i = 0; i < 120; i += 1) sim.step(C.dt);
  expect(sim.state[b0 + CYBER_PLAYER_OFFSET.downTimer]).toBeCloseTo(timerStart, 4);
});
