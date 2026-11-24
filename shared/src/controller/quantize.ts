export function quantizeAxis(unit: number): number {
  if (unit >= 1) return 127;
  if (unit <= -1) return -127;
  const scaled = Math.round(unit * 127);
  if (scaled > 127) return 127;
  if (scaled < -127) return -127;
  return scaled;
}
