import { expect, test } from 'vitest';
import { UniformGridHash } from './grid-hash';

test('UniformGridHash inserts, deduplicates multi-cell radius/rect queries, enforces bounds, and clears cleanly', () => {
  expect(
    () =>
      new UniformGridHash({
        minX: -400,
        minY: -400,
        width: 800,
        height: 800,
        cellSize: 0,
        maxEntities: 160,
      }),
  ).toThrow(RangeError);

  const grid = new UniformGridHash({
    minX: -400,
    minY: -400,
    width: 800,
    height: 800,
    cellSize: 20,
    maxEntities: 160,
  });

  expect(grid.cols).toBe(40);
  expect(grid.rows).toBe(40);

  // Entity 0 spans a 4-cell corner around (0, 0); entity 1 sits at exact upper corner (400, 400).
  // Entity 2 sits at exact lower corner (-400, -400); entity 3 is far away at (200, -200).
  expect(grid.insert(0, 0, 0, 18)).toBe(true);
  expect(grid.insert(1, 400, 400, 0)).toBe(true);
  expect(grid.insert(2, -400, -400, 0)).toBe(true);
  expect(grid.insert(3, 200, -200, 10)).toBe(true);

  // Reject out-of-bounds, invalid entity IDs, and non-finite coordinates.
  expect(grid.insert(4, 450, 0, 5)).toBe(false);
  expect(grid.insert(-1, 0, 0, 5)).toBe(false);
  expect(grid.insert(160, 0, 0, 5)).toBe(false);
  expect(grid.insert(5, Number.NaN, 0, 5)).toBe(false);

  const out = new Int32Array(16);

  // Multi-cell entity 0 appears exactly once; distant entities are excluded.
  const nearCount = grid.queryRadius(5, 5, 25, out);
  expect(Array.from(out.subarray(0, nearCount))).toEqual([0]);

  // Repeated query produces the same result (visit stamp advances cleanly).
  const repeatCount = grid.queryRadius(5, 5, 25, out);
  expect(Array.from(out.subarray(0, repeatCount))).toEqual([0]);

  // Exact upper and lower arena corners are queryable.
  const upperCount = grid.queryRect(390, 390, 400, 400, out);
  expect(Array.from(out.subarray(0, upperCount))).toEqual([1]);

  const lowerCount = grid.queryRect(-400, -400, -390, -390, out);
  expect(Array.from(out.subarray(0, lowerCount))).toEqual([2]);

  // Output buffer capacity is never exceeded.
  expect(grid.insert(10, 0, 0, 5)).toBe(true);
  expect(grid.insert(11, 2, 2, 5)).toBe(true);
  const tiny = new Int32Array(2);
  const capped = grid.queryRadius(0, 0, 30, tiny);
  expect(capped).toBe(2);

  // Clear resets entries so stale entities never leak across ticks.
  grid.clear();
  expect(grid.entryCount).toBe(0);
  expect(grid.queryRadius(0, 0, 400, out)).toBe(0);
  expect(grid.insert(3, 0, 0, 5)).toBe(true);
  expect(Array.from(out.subarray(0, grid.queryRadius(0, 0, 10, out)))).toEqual([3]);
});

test('UniformGridHash queryRay traverses DDA cells for axis, diagonal, clipped, zero-length, and padded rays', () => {
  const grid = new UniformGridHash({
    minX: -400,
    minY: -400,
    width: 800,
    height: 800,
    cellSize: 20,
    maxEntities: 64,
  });

  // Diagonal targets from (-300, -300) toward (300, 300).
  grid.insert(1, -100, -100, 12);
  grid.insert(2, 0, 0, 16); // Multi-cell entity crossed by ray — must be deduplicated.
  grid.insert(3, 180, 180, 8);
  // Off-diagonal target far from the ray.
  grid.insert(4, -200, 200, 10);
  // Horizontal target along y = 100 and a nearby offset target at y = 126.
  grid.insert(5, 50, 100, 6);
  grid.insert(6, 50, 126, 4);

  const out = new Int32Array(16);

  // Diagonal ray starting and ending outside the arena clips into [-400, 400] and hits 1, 2, 3 once each.
  const diagCount = grid.queryRay(-500, -500, 500, 500, out);
  const diagHits = Array.from(out.subarray(0, diagCount)).sort((a, b) => a - b);
  expect(diagHits).toEqual([1, 2, 3]);

  // Reverse diagonal ray (-x, -y) hits the same entities.
  const revCount = grid.queryRay(350, 350, -350, -350, out);
  const revHits = Array.from(out.subarray(0, revCount)).sort((a, b) => a - b);
  expect(revHits).toEqual([1, 2, 3]);

  // Horizontal ray hits entity 5 but not off-beam entity 6; adding padding=30 catches entity 6 too.
  const thinCount = grid.queryRay(-100, 100, 200, 100, out);
  expect(Array.from(out.subarray(0, thinCount))).toEqual([5]);

  const thickCount = grid.queryRay(-100, 100, 200, 100, out, 30);
  const thickHits = Array.from(out.subarray(0, thickCount)).sort((a, b) => a - b);
  expect(thickHits).toEqual([5, 6]);

  // Zero-length ray queries the cell at the point; out-of-grid and non-finite rays return 0.
  const pointCount = grid.queryRay(50, 100, 50, 100, out);
  expect(Array.from(out.subarray(0, pointCount))).toEqual([5]);
  expect(grid.queryRay(-600, -600, -500, -500, out)).toBe(0);
  expect(grid.queryRay(Number.NaN, 0, 100, 0, out)).toBe(0);
});
