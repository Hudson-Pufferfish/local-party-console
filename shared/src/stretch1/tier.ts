import { WINDOW_MS } from './tdma';

export const CAP_MS = 1000 / 30;

export function tierFor(input: { power: 'ok' | 'low-power'; cores: number }): '60' | '30' {
  if (input.power === 'low-power') return '30';
  const cores = input.cores;
  if (cores === (cores | 0) && cores >= 1 && cores <= 4) return '30';
  return '60';
}

export function sendIntervalMs(tier: '60' | '30'): number {
  if (tier === '30') return CAP_MS;
  return WINDOW_MS;
}
