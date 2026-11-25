export const WINDOW_MS = 16.6;
export const PHASE_STEP_MS = 2;

export function phaseWaitMs(hostNow: number, slot: number): number {
  const phase = slot * PHASE_STEP_MS;
  let mod = hostNow % WINDOW_MS;
  if (mod < 0) mod += WINDOW_MS;
  let wait = phase - mod;
  if (wait < 0) wait += WINDOW_MS;
  if (wait === WINDOW_MS) return 0;
  return wait;
}

export function nextDelayMs(
  hostNow: number,
  slot: number,
  sinceLastMs: number,
  minIntervalMs: number,
): number {
  const phase = phaseWaitMs(hostNow, slot);
  const remain = sinceLastMs >= minIntervalMs ? 0 : minIntervalMs - sinceLastMs;
  return phase > remain ? phase : remain;
}
