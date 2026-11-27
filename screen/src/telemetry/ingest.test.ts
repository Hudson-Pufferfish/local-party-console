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
  expect(row.hz).toBe(3);
  expect(row.lossPct).toBe(25);
  expect(row.netP50).toBe(10);
  expect(row.touchMs).toBe(2);
  expect(row.hasOffset).toBe(true);
  const other = ingest.read(1);
  expect(other.hasOffset).toBe(false);
  expect(other.netP50).toBeNull();
});

test('duplicate and backward seq packets do not inflate hz or pollute transit rings', () => {
  const ingest = createIngest();
  ingest.onOffset(0, 0);
  ingest.onInput(0, 5, 4990, 4, 5000);
  ingest.onInput(0, 5, 4990, 10, 5025);
  ingest.onInput(0, 4, 4980, 12, 5030);
  const row = ingest.read(0);
  expect(row.hz).toBe(1);
  expect(row.lossPct).toBe(0);
  expect(row.netP50).toBe(10);
  expect(row.netP99).toBe(10);
  expect(row.jitter).toBe(0);
  expect(row.touchMs).toBe(2);
});

test('thirty unique seqs at 33ms spacing with duplicates still report 30 hz', () => {
  const ingest = createIngest();
  ingest.onOffset(0, 0);
  for (let i = 0; i < 30; i += 1) {
    const hostNow = 5000 + i * 33;
    const phoneTs = hostNow - 5;
    ingest.onInput(0, i + 1, phoneTs, 4, hostNow);
    ingest.onInput(0, i + 1, phoneTs, 4, hostNow + 4);
  }
  const row = ingest.read(0);
  expect(row.hz).toBe(30);
  expect(row.lossPct).toBe(0);
  expect(row.netP50).toBe(5);
});
