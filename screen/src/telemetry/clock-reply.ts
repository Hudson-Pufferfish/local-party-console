export function replyClock(
  payload: unknown,
  hostNow: number,
  isPrimary: boolean,
): { slot: number; t1: number; t2: number; t3: number } | null {
  if (!isPrimary || !Number.isFinite(hostNow)) return null;
  if (typeof payload !== 'object' || payload === null) return null;
  const row = payload as { slot?: unknown; t1?: unknown };
  if (typeof row.slot !== 'number' || row.slot < 0 || row.slot > 7) return null;
  if (typeof row.t1 !== 'number' || !Number.isFinite(row.t1)) return null;
  return { slot: row.slot, t1: row.t1, t2: hostNow, t3: hostNow };
}
