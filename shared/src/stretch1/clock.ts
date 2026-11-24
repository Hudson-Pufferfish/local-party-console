export function ntpOffset(t1: number, t2: number, t3: number, t4: number): number {
  return ((t2 - t1) + (t3 - t4)) / 2;
}

export function ntpDelay(t1: number, t2: number, t3: number, t4: number): number {
  return (t4 - t1) - (t3 - t2);
}
