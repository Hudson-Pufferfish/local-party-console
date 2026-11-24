export function classifyPower(deltasMs: number[]): 'ok' | 'low-power' {
  for (let index = 0; index < deltasMs.length; index += 1) {
    const delta = deltasMs[index];
    if (delta !== undefined && delta >= 31) return 'low-power';
  }
  return 'ok';
}

export function rfc3550Jitter(
  firstSent: number,
  firstRecv: number,
  secondSent: number,
  secondRecv: number,
): number {
  const delta = (secondRecv - firstRecv) - (secondSent - firstSent);
  const abs = delta < 0 ? -delta : delta;
  return abs / 16;
}
