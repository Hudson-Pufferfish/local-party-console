const PHONE_TS_SPAN = 65536;

export function oneWayMs(hostNow: number, phoneTsMod: number, offsetMs: number): number {
  const target = hostNow - offsetMs;
  let mod = phoneTsMod % PHONE_TS_SPAN;
  if (mod < 0) mod += PHONE_TS_SPAN;
  const turns = Math.round((target - mod) / PHONE_TS_SPAN);
  const unwrapped = mod + PHONE_TS_SPAN * turns;
  return hostNow - (unwrapped + offsetMs);
}

export function nextJitter(previous: number, transitDelta: number): number {
  const magnitude = transitDelta < 0 ? -transitDelta : transitDelta;
  return previous + (magnitude - previous) / 16;
}

export function percentile(sortedAsc: ArrayLike<number>, count: number, p: number): number {
  if (count <= 0) return 0;
  let index = Math.ceil((p / 100) * count) - 1;
  if (index < 0) index = 0;
  const last = count - 1;
  if (index > last) index = last;
  return sortedAsc[index] ?? 0;
}
