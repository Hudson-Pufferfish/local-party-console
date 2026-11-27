import { CYBER_CITADEL_CONSTANTS as C } from './constants.ts';

export function computeSquadWeight(humanCount: number, botLevels: readonly number[] | Uint8Array): number {
  let weight = Math.max(0, humanCount);
  for (let i = 0; i < botLevels.length; i += 1) {
    const rawLevel = botLevels[i] ?? 0;
    const level = rawLevel > 0 ? rawLevel : C.standbyBotLevel;
    // Bot weight: 0.4 base + level/100 (0.51..0.60 Easy, 0.70..0.90 Med, 0.90..1.10 Hard)
    weight += 0.4 + level / 100;
  }
  return weight > 0 ? weight : 1.0;
}

export function waveCountMultiplier(weight: number): number {
  return 0.6 + 0.2 * weight;
}

export function waveHpMultiplier(weight: number): number {
  return 1.0 + 0.1 * weight;
}

export function bossHpMultiplier(weight: number): number {
  return 1.0 + 0.28 * (weight - 1);
}

export function isSoloWeight(weight: number): boolean {
  return weight < C.soloWeightThreshold;
}

export function bleedOutDurationForWeight(weight: number): number {
  return isSoloWeight(weight) ? C.soloBleedOutSec : C.bleedOutSec;
}

export function respawnDurationForWeight(weight: number): number {
  return isSoloWeight(weight) ? C.soloRespawnSec : C.respawnSec;
}
