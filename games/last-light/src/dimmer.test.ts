import { describe, expect, test } from 'vitest';
import { LAMP_FLAG, LAST_LIGHT_CONSTANTS as C, LIGHT_PHASE as P } from './constants.ts';
import { lampLuminance } from './dimmer.ts';

describe('Last Light fixed dimming curve', () => {
  test('dims monotonically from 1.0 to 0.2 over 12.0s scored and 3.5s practice, dips on flicker, and snaps to 0 on blowout', () => {
    // COUNTDOWN and steady PRACTICE stay at steady 100% brightness.
    expect(lampLuminance(P.countdown, 0, LAMP_FLAG.lit)).toBe(1.0);
    expect(lampLuminance(P.practice, 0, LAMP_FLAG.lit)).toBe(1.0);

    // Scored round curve: 1.0 at 0s -> strictly decreasing -> 0.2 at 12.0s.
    const start = lampLuminance(P.active, 0, LAMP_FLAG.lit);
    const mid = lampLuminance(P.active, 6.0, LAMP_FLAG.lit);
    const late = lampLuminance(P.active, 10.0, LAMP_FLAG.lit);
    const end = lampLuminance(P.active, C.scoredMaxSec, LAMP_FLAG.lit);
    const clamped = lampLuminance(P.active, 18.0, LAMP_FLAG.lit);

    expect(start).toBeCloseTo(1.0, 5);
    expect(mid).toBeLessThan(start);
    expect(late).toBeLessThan(mid);
    expect(end).toBeCloseTo(0.2, 5);
    expect(clamped).toBeCloseTo(0.2, 5);

    // Practice blowout curve scales to 3.5s window.
    expect(lampLuminance(P.practice, 0, LAMP_FLAG.lit | LAMP_FLAG.practiceBlowout)).toBeCloseTo(1.0, 5);
    expect(
      lampLuminance(P.practice, C.practiceMaxSec, LAMP_FLAG.lit | LAMP_FLAG.practiceBlowout),
    ).toBeCloseTo(0.2, 5);

    // Transient flicker dips luminance without dropping below flickerMinLuminance.
    const flickMid = lampLuminance(P.active, 6.0, LAMP_FLAG.lit | LAMP_FLAG.flicker);
    expect(flickMid).toBeCloseTo(mid - C.flickerDip, 5);
    const flickEnd = lampLuminance(P.active, C.scoredMaxSec, LAMP_FLAG.lit | LAMP_FLAG.flicker);
    expect(flickEnd).toBeCloseTo(C.flickerMinLuminance, 5);

    // Blowout, ROUND_END, and MATCH_OVER snap immediately to 0.0 blackout.
    expect(lampLuminance(P.active, 5.0, LAMP_FLAG.blown)).toBe(0);
    expect(lampLuminance(P.roundEnd, 5.0, LAMP_FLAG.blown)).toBe(0);
    expect(lampLuminance(P.matchOver, 5.0, LAMP_FLAG.blown)).toBe(0);
  });
});
