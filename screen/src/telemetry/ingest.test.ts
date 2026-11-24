import { expect, test } from 'vitest';
import { createIngest } from './ingest.ts';

test('three input packets record one seq gap and a 10ms one-way delay', () => {
  const ingest = createIngest();
  ingest.onOffset(0, 0);
  ingest.onInput(0, 1, 4990, 4, 5000);
  ingest.onInput(0, 2, 5000, 4, 5010);
  ingest.onInput(0, 4, 5020, 4, 5030);
  ingest.onHeartbeat(0, 5040);
  const row = ingest.read(0);
  expect(row.lossPct).toBe(25);
  expect(row.netP50).toBe(10);
  expect(row.touchMs).toBe(2);
  expect(row.hasOffset).toBe(true);
  const other = ingest.read(1);
  expect(other.hasOffset).toBe(false);
  expect(other.netP50).toBeNull();
});
