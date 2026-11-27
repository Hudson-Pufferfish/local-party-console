import {
  LAMP_FLAG,
  LAST_LIGHT_CONSTANTS as C,
  LIGHT_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
  LIGHT_PLAYER_OFFSET as OFF,
} from './constants.ts';
import { createLastLightState, playerBase } from './state.ts';
import type { LastLightSimulation, StartMatchRoster } from './types.ts';

interface Channel {
  buttons: number;
  edge: number;
}

const SCORED_MIN_TICKS = Math.round(C.scoredMinSec * C.stepHz);
const SCORED_MAX_TICKS = Math.round(C.scoredMaxSec * C.stepHz);
const PRACTICE_MIN_TICKS = Math.round(C.practiceMinSec * C.stepHz);
const PRACTICE_MAX_TICKS = Math.round(C.practiceMaxSec * C.stepHz);
const INV_HAZARD_K = 1 / C.hazardShapeK;

function createChannel(): Channel {
  return { buttons: 0, edge: 0 };
}

function targetScoreForJoined(count: number): number {
  const scaled = (count - 1) * C.targetMultiplier;
  return scaled > C.minTargetScore ? scaled : C.minTargetScore;
}

function stepMulberry32(seed: number): number {
  let z = seed >>> 0;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
}

export { type StartMatchRoster };

export function createLastLightSimulation(): LastLightSimulation {
  const store = createLastLightState();
  const state = store.buffer;
  const privateLockTick = store.privateLockTick;
  const joined = new Uint8Array(C.maxPlayers);
  const inputs: Channel[] = [
    createChannel(),
    createChannel(),
    createChannel(),
    createChannel(),
    createChannel(),
    createChannel(),
    createChannel(),
    createChannel(),
  ];

  let joinedCount = 0;
  let matchTarget: number = C.minTargetScore;
  let connectedMask = 0xff;
  let blowoutRngState = C.defaultSeed >>> 0;
  let flickerRngState = (C.defaultSeed ^ 0x9e3779b9) >>> 0;
  let blowoutElapsedTicks = 0;
  let practiceRevealTimer = 0;
  let nextFlickerTick = 0;
  let flickerTicksLeft = 0;
  let suddenDeathActive = false;

  function nextBlowoutRandom(): number {
    blowoutRngState = (blowoutRngState + 0x6d2b79f5) >>> 0;
    return stepMulberry32(blowoutRngState);
  }

  function nextFlickerRandom(): number {
    flickerRngState = (flickerRngState + 0x6d2b79f5) >>> 0;
    return stepMulberry32(flickerRngState);
  }

  function rollBlowoutTicks(practice: boolean): number {
    const u = nextBlowoutRandom();
    const minSec = practice ? C.practiceMinSec : C.scoredMinSec;
    const maxSec = practice ? C.practiceMaxSec : C.scoredMaxSec;
    const minTicks = practice ? PRACTICE_MIN_TICKS : SCORED_MIN_TICKS;
    const maxTicks = practice ? PRACTICE_MAX_TICKS : SCORED_MAX_TICKS;
    const seconds = minSec + (maxSec - minSec) * Math.pow(u, INV_HAZARD_K);
    let ticks = Math.round(seconds * C.stepHz);
    if (ticks < minTicks) ticks = minTicks;
    if (ticks > maxTicks) ticks = maxTicks;
    return ticks;
  }

  function scheduleNextFlicker(fromTick: number, practice: boolean): void {
    const baseGap = practice ? 120 : 240;
    const span = practice ? 180 : 420;
    nextFlickerTick = fromTick + baseGap + Math.floor(nextFlickerRandom() * span);
    flickerTicksLeft = 0;
  }

  function updateFlickerFlag(practice: boolean): void {
    let flags = (state[H.lampFlags] ?? 0) | 0;
    if (flickerTicksLeft > 0) {
      flickerTicksLeft -= 1;
      if (flickerTicksLeft > 0) {
        flags |= LAMP_FLAG.flicker;
      } else {
        flags &= ~LAMP_FLAG.flicker;
        scheduleNextFlicker(blowoutElapsedTicks, practice);
      }
      state[H.lampFlags] = flags;
      return;
    }

    if (blowoutElapsedTicks >= nextFlickerTick) {
      flickerTicksLeft = 3 + Math.floor(nextFlickerRandom() * 4);
      state[H.lampFlags] = flags | LAMP_FLAG.flicker;
    } else if ((flags & LAMP_FLAG.flicker) !== 0) {
      state[H.lampFlags] = flags & ~LAMP_FLAG.flicker;
    }
  }

  function writeActiveMask(): void {
    let mask = 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const flags = (state[playerBase(i) + OFF.flags] ?? 0) | 0;
      if ((flags & LIGHT_FLAG.active) !== 0) {
        mask |= 1 << i;
      }
    }
    state[H.activeMask] = mask;
  }

  function syncDisconnectedFlags(): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const base = playerBase(i);
      const flags = (state[base + OFF.flags] ?? 0) | 0;
      const isConnected = (connectedMask & (1 << i)) !== 0;
      if (isConnected) {
        state[base + OFF.flags] = flags & ~LIGHT_FLAG.disconnected;
      } else {
        state[base + OFF.flags] = flags | LIGHT_FLAG.disconnected;
        inputs[i]!.buttons = 0;
        inputs[i]!.edge = 0;
      }
    }
  }

  function clearAllEdges(): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      inputs[i]!.edge = 0;
    }
  }

  function startBlowout(practice: boolean): void {
    store.clearBlowoutLocks();
    store.setBlowoutTick(rollBlowoutTicks(practice));
    blowoutElapsedTicks = 0;
    practiceRevealTimer = 0;
    state[H.lampElapsed] = 0;
    let flags = LAMP_FLAG.lit;
    if (practice) flags |= LAMP_FLAG.practiceBlowout;
    if (suddenDeathActive && !practice) flags |= LAMP_FLAG.suddenDeath;
    state[H.lampFlags] = flags;
    scheduleNextFlicker(0, practice);
    clearAllEdges();
    writeActiveMask();
  }

  function enterPracticeSteadyWait(): void {
    store.clearBlowoutLocks();
    blowoutElapsedTicks = 0;
    practiceRevealTimer = 0;
    state[H.lampElapsed] = 0;
    state[H.lampFlags] = LAMP_FLAG.lit;
    flickerTicksLeft = 0;
    clearAllEdges();
  }

  function beginPractice(initial: boolean): void {
    state[H.phase] = P.practice;
    state[H.phaseTimer] = initial ? C.practiceInitial : C.practiceBreak;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const base = playerBase(i);
      const prev = (state[base + OFF.flags] ?? 0) | 0;
      const preserved = prev & (LIGHT_FLAG.joined | LIGHT_FLAG.disconnected | LIGHT_FLAG.isBot);
      state[base + OFF.flags] = preserved | LIGHT_FLAG.active | LIGHT_FLAG.contender;
    }
    if ((state[H.phaseTimer] ?? 0) >= C.practiceGuardSec) {
      startBlowout(true);
    } else {
      enterPracticeSteadyWait();
    }
    writeActiveMask();
  }

  function beginCountdown(): void {
    state[H.phase] = P.countdown;
    state[H.phaseTimer] = C.countdown;
    state[H.lampElapsed] = 0;
    store.clearBlowoutLocks();
    blowoutElapsedTicks = 0;
    practiceRevealTimer = 0;
    flickerTicksLeft = 0;
    state[H.lampFlags] = LAMP_FLAG.lit | (suddenDeathActive ? LAMP_FLAG.suddenDeath : 0);
    clearAllEdges();
    writeActiveMask();
  }

  function processLocksAtCurrentTick(): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const ch = inputs[i]!;
      if (ch.edge === 0) continue;
      ch.edge = 0;
      if ((connectedMask & (1 << i)) === 0) continue;
      const base = playerBase(i);
      const flags = (state[base + OFF.flags] ?? 0) | 0;
      if ((flags & LIGHT_FLAG.active) === 0) continue;
      if ((flags & LIGHT_FLAG.locked) !== 0) continue;
      store.recordLock(i, blowoutElapsedTicks);
    }
  }

  function markUnlockedActiveOut(): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const base = playerBase(i);
      const flags = (state[base + OFF.flags] ?? 0) | 0;
      if ((flags & LIGHT_FLAG.active) === 0) continue;
      if ((flags & LIGHT_FLAG.locked) === 0) {
        state[base + OFF.flags] = flags | LIGHT_FLAG.out;
      }
    }
  }

  function resolveScoredBlowout(): void {
    clearAllEdges();
    store.revealLocksOnBlowout();
    markUnlockedActiveOut();
    state[H.blowoutCount] = (state[H.blowoutCount] ?? 0) + 1;

    let lockedCount = 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      const base = playerBase(i);
      state[base + OFF.lastRoundPoints] = 0;
      if (joined[i] === 0) continue;
      const flags = (state[base + OFF.flags] ?? 0) | 0;
      if ((flags & LIGHT_FLAG.active) !== 0 && (flags & LIGHT_FLAG.locked) !== 0) {
        lockedCount += 1;
      }
    }

    if (lockedCount === 0) {
      state[H.lampFlags] = ((state[H.lampFlags] ?? 0) | 0) | LAMP_FLAG.voidRound;
    } else if (suddenDeathActive) {
      let maxLock = -1;
      let maxSlot = -1;
      let tieCount = 0;
      for (let i = 0; i < C.maxPlayers; i += 1) {
        if (joined[i] === 0) continue;
        const base = playerBase(i);
        const flags = (state[base + OFF.flags] ?? 0) | 0;
        if ((flags & LIGHT_FLAG.active) === 0 || (flags & LIGHT_FLAG.locked) === 0) continue;
        const lt = privateLockTick[i] ?? -1;
        if (lt > maxLock) {
          maxLock = lt;
          maxSlot = i;
          tieCount = 1;
        } else if (lt === maxLock) {
          tieCount += 1;
        }
      }
      if (tieCount === 1 && maxSlot >= 0) {
        const winBase = playerBase(maxSlot);
        state[winBase + OFF.score] = (state[winBase + OFF.score] ?? 0) + 1;
        state[winBase + OFF.lastRoundPoints] = 1;
      }
    } else {
      for (let i = 0; i < C.maxPlayers; i += 1) {
        if (joined[i] === 0) continue;
        const baseI = playerBase(i);
        const flagsI = (state[baseI + OFF.flags] ?? 0) | 0;
        if ((flagsI & LIGHT_FLAG.active) === 0 || (flagsI & LIGHT_FLAG.locked) === 0) continue;
        const lockI = privateLockTick[i] ?? -1;
        let strictlyLater = 0;
        for (let j = 0; j < C.maxPlayers; j += 1) {
          if (j === i || joined[j] === 0) continue;
          const baseJ = playerBase(j);
          const flagsJ = (state[baseJ + OFF.flags] ?? 0) | 0;
          if ((flagsJ & LIGHT_FLAG.active) === 0 || (flagsJ & LIGHT_FLAG.locked) === 0) continue;
          if ((privateLockTick[j] ?? -1) > lockI) {
            strictlyLater += 1;
          }
        }
        const pts = joinedCount - 1 - strictlyLater;
        const awarded = pts > 0 ? pts : 0;
        state[baseI + OFF.score] = (state[baseI + OFF.score] ?? 0) + awarded;
        state[baseI + OFF.lastRoundPoints] = awarded;
      }
    }

    // Evaluate match completion or sudden death state.
    let topScore = 0;
    let leaders = 0;
    let leaderSlot = -1;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const sc = state[playerBase(i) + OFF.score] ?? 0;
      if (sc > topScore) {
        topScore = sc;
        leaders = 1;
        leaderSlot = i;
      } else if (sc === topScore && sc > 0) {
        leaders += 1;
      }
    }

    let lampFlags = (state[H.lampFlags] ?? 0) | 0;
    if (topScore >= matchTarget && leaders === 1 && leaderSlot >= 0) {
      state[H.winnerSlot] = leaderSlot;
      lampFlags &= ~LAMP_FLAG.suddenDeath;
    } else if (suddenDeathActive || (topScore >= matchTarget && leaders > 1)) {
      lampFlags |= LAMP_FLAG.suddenDeath;
    }
    state[H.lampFlags] = lampFlags;

    state[H.phase] = P.roundEnd;
    state[H.phaseTimer] = C.roundEnd;
  }

  function parkNonLeaders(topScore: number): void {
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const base = playerBase(i);
      const flags = (state[base + OFF.flags] ?? 0) | 0;
      const preserved = flags & (LIGHT_FLAG.joined | LIGHT_FLAG.disconnected | LIGHT_FLAG.isBot);
      const sc = state[base + OFF.score] ?? 0;
      if (sc === topScore) {
        state[base + OFF.flags] = preserved | LIGHT_FLAG.active | LIGHT_FLAG.contender;
      } else {
        state[base + OFF.flags] = preserved;
        inputs[i]!.buttons = 0;
        inputs[i]!.edge = 0;
      }
    }
    writeActiveMask();
  }

  function stepPractice(dt: number): void {
    const nextTimer = (state[H.phaseTimer] ?? 0) - dt;
    state[H.phaseTimer] = nextTimer > 0 ? nextTimer : 0;
    if (state[H.phaseTimer]! <= 0) {
      beginCountdown();
      return;
    }

    const lampFlags = (state[H.lampFlags] ?? 0) | 0;
    if ((lampFlags & LAMP_FLAG.blown) !== 0) {
      clearAllEdges();
      practiceRevealTimer -= dt;
      if (practiceRevealTimer <= 0) {
        if ((state[H.phaseTimer] ?? 0) >= C.practiceGuardSec) {
          startBlowout(true);
        } else {
          enterPracticeSteadyWait();
        }
      }
      return;
    }

    if ((lampFlags & LAMP_FLAG.practiceBlowout) !== 0 && (lampFlags & LAMP_FLAG.lit) !== 0) {
      blowoutElapsedTicks += 1;
      state[H.lampElapsed] = blowoutElapsedTicks / C.stepHz;
      if (blowoutElapsedTicks >= store.getBlowoutTick()) {
        clearAllEdges();
        store.revealLocksOnBlowout();
        markUnlockedActiveOut();
        state[H.blowoutCount] = (state[H.blowoutCount] ?? 0) + 1;
        practiceRevealTimer = C.practiceRevealSec;
        return;
      }
      processLocksAtCurrentTick();
      updateFlickerFlag(true);
      return;
    }

    clearAllEdges();
  }

  function stepCountdown(dt: number): void {
    clearAllEdges();
    const nextTimer = (state[H.phaseTimer] ?? 0) - dt;
    state[H.phaseTimer] = nextTimer > 0 ? nextTimer : 0;
    if (state[H.phaseTimer]! <= 0) {
      state[H.phase] = P.active;
      state[H.phaseTimer] = 0;
      startBlowout(false);
    }
  }

  function stepActive(): void {
    blowoutElapsedTicks += 1;
    state[H.lampElapsed] = blowoutElapsedTicks / C.stepHz;
    if (blowoutElapsedTicks >= store.getBlowoutTick()) {
      resolveScoredBlowout();
      return;
    }
    processLocksAtCurrentTick();
    updateFlickerFlag(false);
  }

  function stepRoundEnd(dt: number): void {
    clearAllEdges();
    const nextTimer = (state[H.phaseTimer] ?? 0) - dt;
    state[H.phaseTimer] = nextTimer > 0 ? nextTimer : 0;
    if (state[H.phaseTimer]! > 0) return;

    if ((state[H.winnerSlot] ?? -1) >= 0) {
      state[H.phase] = P.matchOver;
      state[H.phaseTimer] = 0;
      return;
    }

    let topScore = 0;
    let leaders = 0;
    for (let i = 0; i < C.maxPlayers; i += 1) {
      if (joined[i] === 0) continue;
      const sc = state[playerBase(i) + OFF.score] ?? 0;
      if (sc > topScore) {
        topScore = sc;
        leaders = 1;
      } else if (sc === topScore && sc > 0) {
        leaders += 1;
      }
    }

    if (suddenDeathActive || (topScore >= matchTarget && leaders > 1)) {
      suddenDeathActive = true;
      parkNonLeaders(topScore);
      beginCountdown();
      return;
    }

    beginPractice(false);
  }

  function startMatch(slots: number[], seed?: number | StartMatchRoster, roster?: StartMatchRoster): void {
    joinedCount = 0;
    joined.fill(0);
    suddenDeathActive = false;
    blowoutElapsedTicks = 0;
    practiceRevealTimer = 0;
    flickerTicksLeft = 0;
    nextFlickerTick = 0;

    const actualSeed = typeof seed === 'number' ? seed : undefined;
    const actualRoster = typeof seed === 'object' && seed !== null ? seed : roster;

    const baseSeed =
      (actualSeed !== undefined
        ? actualSeed
        : typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
          ? crypto.getRandomValues(new Uint32Array(1))[0]!
          : C.defaultSeed) >>> 0;
    blowoutRngState = baseSeed;
    flickerRngState = (baseSeed ^ 0x9e3779b9) >>> 0;

    state.fill(0);
    state[H.winnerSlot] = -1;
    privateLockTick.fill(-1);

    let initialConnected = 0;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      if (slot === undefined || slot !== (slot | 0) || slot < 0 || slot >= C.maxPlayers || joined[slot] === 1) {
        continue;
      }
      joined[slot] = 1;
      joinedCount += 1;
      initialConnected |= 1 << slot;
      const base = playerBase(slot);
      const isBot = actualRoster?.botMask?.[slot] === 1;
      state[base + OFF.flags] =
        LIGHT_FLAG.joined |
        LIGHT_FLAG.active |
        LIGHT_FLAG.contender |
        (isBot ? LIGHT_FLAG.isBot : 0);
      state[base + OFF.lockTick] = -1;
    }

    for (let i = 0; i < C.maxPlayers; i += 1) {
      inputs[i]!.buttons = 0;
      inputs[i]!.edge = 0;
      if (joined[i] === 0) {
        state[playerBase(i) + OFF.lockTick] = -1;
      }
    }

    connectedMask = initialConnected;
    matchTarget = targetScoreForJoined(joinedCount);
    beginPractice(true);
  }

  function setConnectedMask(mask: number): void {
    connectedMask = mask & 0xff;
    syncDisconnectedFlags();
  }

  function applyInput(playerIndex: number, buttons: number, _axisX: number, _axisY: number): void {
    if (playerIndex !== (playerIndex | 0) || playerIndex < 0 || playerIndex >= C.maxPlayers) {
      return;
    }
    if (joined[playerIndex] === 0) return;
    if ((connectedMask & (1 << playerIndex)) === 0) return;

    const base = playerBase(playerIndex);
    const flags = (state[base + OFF.flags] ?? 0) | 0;
    if ((flags & LIGHT_FLAG.active) === 0) return;

    const channel = inputs[playerIndex]!;
    const pressed = buttons & 1;
    const phase = state[H.phase] ?? P.countdown;
    const lampFlags = (state[H.lampFlags] ?? 0) | 0;
    const canLockNow =
      (lampFlags & LAMP_FLAG.lit) !== 0
      && (phase === P.active || (phase === P.practice && (lampFlags & LAMP_FLAG.practiceBlowout) !== 0));

    if (!canLockNow) {
      channel.buttons = pressed;
      channel.edge = 0;
      return;
    }

    if (pressed !== 0 && channel.buttons === 0) {
      channel.edge = 1;
    }
    channel.buttons = pressed;
  }

  function step(dt: number): void {
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / C.stepHz;
    state[H.tick] = (state[H.tick] ?? 0) + 1;
    const phase = state[H.phase] ?? P.countdown;
    if (phase === P.practice) {
      stepPractice(safeDt);
    } else if (phase === P.countdown) {
      stepCountdown(safeDt);
    } else if (phase === P.active) {
      stepActive();
    } else if (phase === P.roundEnd) {
      stepRoundEnd(safeDt);
    } else {
      clearAllEdges();
    }
  }

  function getMatchTarget(): number {
    return matchTarget;
  }

  return {
    state,
    applyInput,
    step,
    startMatch,
    setConnectedMask,
    getMatchTarget,
  };
}
