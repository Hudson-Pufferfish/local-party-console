import { CYBER_CITADEL_CONSTANTS as C } from './constants.ts';
import type { FlowField, Vec2Out } from './types.ts';

const COLS = C.gridCols;
const ROWS = C.gridRows;
const CELLS = C.gridCells;
const CELL_SIZE = C.cellSize;
const HALF_ARENA = C.halfArena;
const INF_COST = 0xffff;
const DIAG_INV = Math.SQRT1_2;

// Deterministic tie-break order: N, E, S, W, NE, SE, SW, NW
const DIR_DX = new Int8Array([0, 1, 0, -1, 1, 1, -1, -1]);
const DIR_DY = new Int8Array([-1, 0, 1, 0, -1, 1, 1, -1]);
const DIR_COST = new Uint8Array([10, 10, 10, 10, 14, 14, 14, 14]);
const DIR_UX = new Float32Array([0, 1, 0, -1, DIAG_INV, DIAG_INV, -DIAG_INV, -DIAG_INV]);
const DIR_UY = new Float32Array([-1, 0, 1, 0, -DIAG_INV, DIAG_INV, DIAG_INV, -DIAG_INV]);

export function worldToCell(worldCoord: number): number {
  const raw = Math.floor((worldCoord + HALF_ARENA) / CELL_SIZE);
  if (raw <= 0) return 0;
  if (raw >= COLS - 1) return COLS - 1;
  return raw;
}

export function cellCenter(cellIndex: number): number {
  return -HALF_ARENA + (cellIndex + 0.5) * CELL_SIZE;
}

export function isCoreSeedCell(cx: number, cy: number): boolean {
  const xc = cellCenter(cx);
  const yc = cellCenter(cy);
  const r = C.coreRadius + CELL_SIZE * 0.5;
  return xc * xc + yc * yc <= r * r;
}

export function findNearestBarricadeCell(
  x: number,
  y: number,
  barCellX: Uint8Array,
  barCellY: Uint8Array,
  barActive: Uint8Array,
  capacity: number,
): number {
  let bestIdx = -1;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < capacity; i += 1) {
    if (barActive[i] === 0) continue;
    const bx = cellCenter(barCellX[i]!);
    const by = cellCenter(barCellY[i]!);
    const dx = bx - x;
    const dy = by - y;
    const dSq = dx * dx + dy * dy;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function createFlowField(): FlowField {
  const blocked = new Uint8Array(CELLS);
  const cost = new Uint16Array(CELLS);
  const flowX = new Float32Array(CELLS);
  const flowY = new Float32Array(CELLS);
  const dirCode = new Uint8Array(CELLS);
  const queue = new Uint16Array(CELLS);
  const inQueue = new Uint8Array(CELLS);
  const coreSeed = new Uint8Array(CELLS);

  for (let cy = 0; cy < ROWS; cy += 1) {
    const rowOff = cy * COLS;
    for (let cx = 0; cx < COLS; cx += 1) {
      if (isCoreSeedCell(cx, cy)) {
        coreSeed[rowOff + cx] = 1;
      }
    }
  }

  let dirty = true;
  let rebuildCount = 0;

  function reset(): void {
    blocked.fill(0);
    dirty = true;
    rebuildCount = 0;
    rebuildIfDirty();
  }

  function setBlocked(cx: number, cy: number, isBlocked: boolean): void {
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return;
    const idx = cy * COLS + cx;
    const next = isBlocked ? 1 : 0;
    if (blocked[idx] !== next) {
      blocked[idx] = next;
      dirty = true;
    }
  }

  function isBlocked(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return true;
    return blocked[cy * COLS + cx] === 1;
  }

  function markDirty(): void {
    dirty = true;
  }

  function rebuildIfDirty(): boolean {
    if (!dirty) return false;
    dirty = false;
    rebuildCount += 1;

    cost.fill(INF_COST);
    inQueue.fill(0);
    flowX.fill(0);
    flowY.fill(0);
    dirCode.fill(255);

    let head = 0;
    let tail = 0;
    let qCount = 0;

    for (let idx = 0; idx < CELLS; idx += 1) {
      if (coreSeed[idx] === 1 && blocked[idx] === 0) {
        cost[idx] = 0;
        dirCode[idx] = 254;
        queue[tail] = idx;
        tail = (tail + 1) % CELLS;
        inQueue[idx] = 1;
        qCount += 1;
      }
    }

    // Zero-allocation shortest-path relaxation over 40x40 grid (cardinal +10, diagonal +14)
    while (qCount > 0) {
      const idx = queue[head]!;
      head = (head + 1) % CELLS;
      qCount -= 1;
      inQueue[idx] = 0;

      const baseCost = cost[idx]!;
      const cx = idx % COLS;
      const cy = (idx - cx) / COLS;

      for (let d = 0; d < 8; d += 1) {
        const dx = DIR_DX[d]!;
        const dy = DIR_DY[d]!;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        const nIdx = ny * COLS + nx;
        if (blocked[nIdx] === 1) continue;

        // Disallow diagonal corner-clipping if either adjacent cardinal cell is blocked
        if (d >= 4) {
          if (blocked[cy * COLS + nx] === 1 || blocked[ny * COLS + cx] === 1) continue;
        }

        const nextCost = baseCost + DIR_COST[d]!;
        if (nextCost < cost[nIdx]!) {
          cost[nIdx] = nextCost;
          if (inQueue[nIdx] === 0) {
            queue[tail] = nIdx;
            tail = (tail + 1) % CELLS;
            inQueue[nIdx] = 1;
            qCount += 1;
          }
        }
      }
    }

    // Extract deterministic gradient vectors
    for (let cy = 0; cy < ROWS; cy += 1) {
      const rowOff = cy * COLS;
      for (let cx = 0; cx < COLS; cx += 1) {
        const idx = rowOff + cx;
        if (blocked[idx] === 1) {
          dirCode[idx] = 255;
          continue;
        }
        const selfCost = cost[idx]!;
        if (selfCost === 0) {
          dirCode[idx] = 254;
          const xc = cellCenter(cx);
          const yc = cellCenter(cy);
          const len = Math.hypot(xc, yc);
          if (len > 1e-4) {
            flowX[idx] = -xc / len;
            flowY[idx] = -yc / len;
          }
          continue;
        }
        if (selfCost === INF_COST) {
          dirCode[idx] = 255;
          continue;
        }

        let bestDir = -1;
        let bestCost = selfCost;
        for (let d = 0; d < 8; d += 1) {
          const dx = DIR_DX[d]!;
          const dy = DIR_DY[d]!;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
          const nIdx = ny * COLS + nx;
          if (blocked[nIdx] === 1) continue;
          if (d >= 4) {
            if (blocked[cy * COLS + nx] === 1 || blocked[ny * COLS + cx] === 1) continue;
          }
          const nCost = cost[nIdx]!;
          if (nCost < bestCost) {
            bestCost = nCost;
            bestDir = d;
          }
        }

        if (bestDir >= 0) {
          flowX[idx] = DIR_UX[bestDir]!;
          flowY[idx] = DIR_UY[bestDir]!;
          dirCode[idx] = bestDir;
        }
      }
    }

    return true;
  }

  function sample(x: number, y: number, out: Vec2Out): void {
    const cx = worldToCell(x);
    const cy = worldToCell(y);
    const idx = cy * COLS + cx;
    out.x = flowX[idx]!;
    out.y = flowY[idx]!;
  }

  function isCellUnreachable(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return true;
    return cost[cy * COLS + cx] === INF_COST;
  }

  function isUnreachable(x: number, y: number): boolean {
    const cx = worldToCell(x);
    const cy = worldToCell(y);
    return cost[cy * COLS + cx] === INF_COST;
  }

  function writeDebugBytes(auxState: Uint8Array, offset: number): void {
    if (auxState.byteLength < offset + CELLS) return;
    auxState.set(dirCode, offset);
  }

  return {
    blocked,
    cost,
    flowX,
    flowY,
    get rebuildCount() {
      return rebuildCount;
    },
    reset,
    setBlocked,
    isBlocked,
    markDirty,
    rebuildIfDirty,
    sample,
    isUnreachable,
    isCellUnreachable,
    writeDebugBytes,
  };
}
