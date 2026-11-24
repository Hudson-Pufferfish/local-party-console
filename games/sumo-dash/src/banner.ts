export function bannerCopy(phase: number, timer: number): string {
  if (phase === 4 && timer > 0) return `BREAK ${Math.ceil(timer)}`;
  if (phase === 0 && timer > 0) return String(Math.ceil(timer));
  if (phase === 2) return 'ROUND';
  return '';
}
