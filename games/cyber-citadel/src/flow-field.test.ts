import { expect, test } from 'vitest';
import { AUX_LAYOUT, CYBER_CITADEL_CONSTANTS as C } from './constants.ts';
import {
  cellCenter,
  createFlowField,
  findNearestBarricadeCell,
  worldToCell,
} from './flow-field.ts';

test('open arena flow field points monotonically toward Core with zero NaNs and skips clean rebuilds', () => {
  const ff = createFlowField();
  expect(ff.rebuildIfDirty()).toBe(true);
  const countAfterFirst = ff.rebuildCount;
  expect(ff.rebuildIfDirty()).toBe(false);
  expect(ff.rebuildCount).toBe(countAfterFirst);

  const vec = { x: 0, y: 0 };
  for (let cy = 0; cy < C.gridRows; cy += 1) {
    for (let cx = 0; cx < C.gridCols; cx += 1) {
      const wx = cellCenter(cx);
      const wy = cellCenter(cy);
      ff.sample(wx, wy, vec);
      expect(Number.isFinite(vec.x)).toBe(true);
      expect(Number.isFinite(vec.y)).toBe(true);
      if (wx * wx + wy * wy > (C.coreRadius + 30) * (C.coreRadius + 30)) {
        // Flow vector must have positive dot product toward Core (0, 0)
        const dotTowardCore = vec.x * -wx + vec.y * -wy;
        expect(dotTowardCore).toBeGreaterThan(0);
      }
    }
  }
});

test('partial barricade wall routes around obstacles without diagonal corner-cutting', () => {
  const ff = createFlowField();
  // Build a vertical wall on the east side at cx = 26, cy = 17..23
  for (let cy = 17; cy <= 23; cy += 1) {
    ff.setBlocked(26, cy, true);
  }
  expect(ff.rebuildIfDirty()).toBe(true);

  const vec = { x: 0, y: 0 };
  // Cell immediately east of wall center (27, 20) cannot step directly west into blocked (26, 20)
  ff.sample(cellCenter(27), cellCenter(20), vec);
  expect(vec.x).toBeGreaterThanOrEqual(-0.01);
  expect(Math.abs(vec.y)).toBeGreaterThan(0.5);

  // Diagonal corner check: block (25, 19) and (26, 20) so diagonal from (26, 19) to (25, 20) is blocked
  const ff2 = createFlowField();
  ff2.setBlocked(25, 19, true);
  ff2.setBlocked(26, 20, true);
  ff2.rebuildIfDirty();
  const idx2619 = 19 * C.gridCols + 26;
  const idx2520 = 20 * C.gridCols + 25;
  // Direct diagonal cost would be cost[25,20] + 14; routing around must cost more
  expect(ff2.cost[idx2619]).toBeGreaterThan(ff2.cost[idx2520]! + 14);
});

test('sealed barricade ring marks outer cells unreachable and selects nearest barricade deterministically', () => {
  const ff = createFlowField();
  // Build a closed square ring around Core at cx/cy in [14..25]
  const barX = new Uint8Array(44);
  const barY = new Uint8Array(44);
  const barActive = new Uint8Array(44);
  let count = 0;
  for (let c = 14; c <= 25; c += 1) {
    for (const [cx, cy] of [
      [c, 14],
      [c, 25],
      [14, c],
      [25, c],
    ] as const) {
      if (!ff.isBlocked(cx, cy)) {
        ff.setBlocked(cx, cy, true);
        barX[count] = cx;
        barY[count] = cy;
        barActive[count] = 1;
        count += 1;
      }
    }
  }
  ff.rebuildIfDirty();

  expect(ff.isUnreachable(cellCenter(5), cellCenter(20))).toBe(true);
  expect(ff.isCellUnreachable(5, 20)).toBe(true);
  expect(ff.isCellUnreachable(20, 20)).toBe(false);

  const nearest = findNearestBarricadeCell(
    cellCenter(5),
    cellCenter(20),
    barX,
    barY,
    barActive,
    count,
  );
  expect(nearest).toBeGreaterThanOrEqual(0);
  expect(barX[nearest]).toBe(14);
  expect(barY[nearest]).toBe(20);

  // Debug byte export populates 1600 bytes cleanly
  const debugAux = new Uint8Array(AUX_LAYOUT.AUX_DEBUG_BYTES);
  ff.writeDebugBytes(debugAux, AUX_LAYOUT.FLOW_DEBUG_OFFSET);
  expect(debugAux[AUX_LAYOUT.FLOW_DEBUG_OFFSET + 20 * C.gridCols + 20]).toBe(254);
  expect(debugAux[AUX_LAYOUT.FLOW_DEBUG_OFFSET + 20 * C.gridCols + 14]).toBe(255);
  expect(worldToCell(-400)).toBe(0);
  expect(worldToCell(400)).toBe(39);
});
