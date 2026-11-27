import { CYBER_CITADEL_CONSTANTS as C } from './constants.ts';

export function computeSquadWeight(humanCount: number, botLevels: readonly number[] | Uint8Array): number {
  let weight = Math.max(0, humanCount);
  for (let i = 0; i < botLevels.length; i += 1) {
    const rawLevel = botLevels[i] ?? 0;
    const level = rawLevel > 0 ? rawLevel : C.standbyBotLevel;
    // Lightened bot contribution: 0.15 base + level/500 (~0.17 for Easy, ~0.23 for Med, ~0.28 for Hard)
    // Prevents bot allies from heavily inflating enemy spawn count and enemy HP against the human player
    weight += 0.15 + level / 500;
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
  return 1.0 + 0.35 * (weight - 1);
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
