import {
  LAMP_FLAG,
  LAST_LIGHT_CONSTANTS as C,
  LIGHT_PHASE as P,
} from './constants.ts';

/**
 * Pure fixed luminescence curve strictly independent of secret blowoutTick (INV-8).
 * Declines non-linearly from 1.0 to 0.2 across the full window (12.0s scored / 3.5s practice),
 * dips transiently on atmospheric micro-flickers, and snaps to 0.0 on blowout.
 */
export function lampLuminance(phase: number, lampElapsed: number, lampFlags: number): number {
  const flags = lampFlags | 0;
  if ((flags & LAMP_FLAG.blown) !== 0 || phase === P.roundEnd || phase === P.matchOver) {
    return 0;
  }
  if ((flags & LAMP_FLAG.lit) === 0) {
    return 0;
  }

  const isPracticeBlowout = phase === P.practice && (flags & LAMP_FLAG.practiceBlowout) !== 0;
  if (phase === P.countdown || (phase === P.practice && !isPracticeBlowout)) {
    return C.dimStartLuminance;
  }

  const windowSec = isPracticeBlowout ? C.practiceMaxSec : C.scoredMaxSec;
  const elapsed = Number.isFinite(lampElapsed) && lampElapsed > 0 ? lampElapsed : 0;
  let progress = elapsed / windowSec;
  if (progress < 0) progress = 0;
  if (progress > 1) progress = 1;

  // Smooth non-linear dimming curve from 1.0 down to 0.2.
  const eased = Math.pow(progress, 1.25);
  let lum = C.dimStartLuminance - (C.dimStartLuminance - C.dimEndLuminance) * eased;

  if ((flags & LAMP_FLAG.flicker) !== 0) {
    lum -= C.flickerDip;
    if (lum < C.flickerMinLuminance) lum = C.flickerMinLuminance;
  }

  return lum;
}
