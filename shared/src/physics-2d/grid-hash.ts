export type GridQueryBuffer = Int32Array | Uint16Array | Uint32Array;

export interface UniformGridConfig {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly maxEntities: number;
  readonly maxNodes?: number;
}

/**
 * Zero-allocation flat uniform grid broadphase backed by pre-allocated TypedArrays.
 * Uses an intrusive per-cell linked list (`cellHead`, `nodeEntity`, `nodeNext`) and
 * monotonic `visitStamp` deduplication so `clear`, `insert`, `queryRect`, `queryRadius`,
 * and `queryRay` perform zero heap allocations on the gameplay hot path.
 */
export class UniformGridHash {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly maxEntities: number;
  readonly maxNodes: number;

  private readonly invCellSize: number;
  private readonly cellHead: Int32Array;
  private readonly nodeEntity: Int32Array;
  private readonly nodeNext: Int32Array;
  private readonly visitStamp: Uint32Array;
  private nodeCount = 0;
  private queryStamp = 0;

  constructor(config: UniformGridConfig) {
    const { minX, minY, width, height, cellSize, maxEntities } = config;
    const maxNodes = config.maxNodes ?? maxEntities * 4;

    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      !Number.isFinite(cellSize) ||
      width <= 0 ||
      height <= 0 ||
      cellSize <= 0 ||
      !Number.isInteger(maxEntities) ||
      maxEntities < 1 ||
      !Number.isInteger(maxNodes) ||
      maxNodes < maxEntities
    ) {
      throw new RangeError('Invalid UniformGridHash configuration');
    }

    this.minX = minX;
    this.minY = minY;
    this.maxX = minX + width;
    this.maxY = minY + height;
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.maxEntities = maxEntities;
    this.maxNodes = maxNodes;

    this.cellHead = new Int32Array(this.cols * this.rows);
    this.cellHead.fill(-1);
    this.nodeEntity = new Int32Array(maxNodes);
    this.nodeNext = new Int32Array(maxNodes);
    this.visitStamp = new Uint32Array(maxEntities);
  }

  get entryCount(): number {
    return this.nodeCount;
  }

  clear(): void {
    this.cellHead.fill(-1);
    this.nodeCount = 0;
  }

  insert(entityId: number, x: number, y: number, radius = 0): boolean {
    if (!Number.isInteger(entityId) || entityId < 0 || entityId >= this.maxEntities) {
      return false;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) {
      return false;
    }

    const r = radius > 0 ? radius : 0;
    const minEx = x - r;
    const maxEx = x + r;
    const minEy = y - r;
    const maxEy = y + r;
    if (maxEx < this.minX || minEx > this.maxX || maxEy < this.minY || minEy > this.maxY) {
      return false;
    }

    const minCx = clampInt(Math.floor((minEx - this.minX) * this.invCellSize), 0, this.cols - 1);
    const maxCx = clampInt(Math.floor((maxEx - this.minX) * this.invCellSize), 0, this.cols - 1);
    const minCy = clampInt(Math.floor((minEy - this.minY) * this.invCellSize), 0, this.rows - 1);
    const maxCy = clampInt(Math.floor((maxEy - this.minY) * this.invCellSize), 0, this.rows - 1);

    const needed = (maxCx - minCx + 1) * (maxCy - minCy + 1);
    if (this.nodeCount + needed > this.maxNodes) {
      return false;
    }

    const cols = this.cols;
    const cellHead = this.cellHead;
    const nodeEntity = this.nodeEntity;
    const nodeNext = this.nodeNext;
    let node = this.nodeCount;

    for (let cy = minCy; cy <= maxCy; cy += 1) {
      const rowOffset = cy * cols;
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const cell = rowOffset + cx;
        nodeEntity[node] = entityId;
        nodeNext[node] = cellHead[cell];
        cellHead[cell] = node;
        node += 1;
      }
    }

    this.nodeCount = node;
    return true;
  }

  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: GridQueryBuffer): number {
    const cap = out.length;
    if (
      cap === 0 ||
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      return 0;
    }

    const x0 = minX <= maxX ? minX : maxX;
    const x1 = minX <= maxX ? maxX : minX;
    const y0 = minY <= maxY ? minY : maxY;
    const y1 = minY <= maxY ? maxY : minY;
    if (x1 < this.minX || x0 > this.maxX || y1 < this.minY || y0 > this.maxY) {
      return 0;
    }

    const minCx = clampInt(Math.floor((x0 - this.minX) * this.invCellSize), 0, this.cols - 1);
    const maxCx = clampInt(Math.floor((x1 - this.minX) * this.invCellSize), 0, this.cols - 1);
    const minCy = clampInt(Math.floor((y0 - this.minY) * this.invCellSize), 0, this.rows - 1);
    const maxCy = clampInt(Math.floor((y1 - this.minY) * this.invCellSize), 0, this.rows - 1);

    const stamp = this.nextStamp();
    const cols = this.cols;
    let count = 0;

    for (let cy = minCy; cy <= maxCy; cy += 1) {
      const rowOffset = cy * cols;
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        count = this.collectCell(rowOffset + cx, stamp, out, count, cap);
        if (count >= cap) return count;
      }
    }

    return count;
  }

  queryRadius(cx: number, cy: number, radius: number, out: GridQueryBuffer): number {
    const cap = out.length;
    if (
      cap === 0 ||
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(radius) ||
      radius < 0
    ) {
      return 0;
    }

    const x0 = cx - radius;
    const x1 = cx + radius;
    const y0 = cy - radius;
    const y1 = cy + radius;
    if (x1 < this.minX || x0 > this.maxX || y1 < this.minY || y0 > this.maxY) {
      return 0;
    }

    const minCx = clampInt(Math.floor((x0 - this.minX) * this.invCellSize), 0, this.cols - 1);
    const maxCx = clampInt(Math.floor((x1 - this.minX) * this.invCellSize), 0, this.cols - 1);
    const minCy = clampInt(Math.floor((y0 - this.minY) * this.invCellSize), 0, this.rows - 1);
    const maxCy = clampInt(Math.floor((y1 - this.minY) * this.invCellSize), 0, this.rows - 1);

    const stamp = this.nextStamp();
    const cols = this.cols;
    const cellSize = this.cellSize;
    const gridMinX = this.minX;
    const gridMinY = this.minY;
    const rSq = radius * radius;
    let count = 0;

    for (let gy = minCy; gy <= maxCy; gy += 1) {
      const cellMinY = gridMinY + gy * cellSize;
      const cellMaxY = cellMinY + cellSize;
      const dy = cy < cellMinY ? cellMinY - cy : cy > cellMaxY ? cy - cellMaxY : 0;
      const dySq = dy * dy;
      if (dySq > rSq) continue;

      const rowOffset = gy * cols;
      for (let gx = minCx; gx <= maxCx; gx += 1) {
        const cellMinX = gridMinX + gx * cellSize;
        const cellMaxX = cellMinX + cellSize;
        const dx = cx < cellMinX ? cellMinX - cx : cx > cellMaxX ? cx - cellMaxX : 0;
        if (dx * dx + dySq > rSq) continue;

        count = this.collectCell(rowOffset + gx, stamp, out, count, cap);
        if (count >= cap) return count;
      }
    }

    return count;
  }

  queryRay(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    out: GridQueryBuffer,
    padding = 0,
  ): number {
    const cap = out.length;
    if (
      cap === 0 ||
      !Number.isFinite(x0) ||
      !Number.isFinite(y0) ||
      !Number.isFinite(x1) ||
      !Number.isFinite(y1) ||
      !Number.isFinite(padding)
    ) {
      return 0;
    }

    const pad = padding > 0 ? padding : 0;
    const padCells = pad > 0 ? Math.ceil(pad * this.invCellSize) : 0;

    // Inline Liang-Barsky clip to [minX - pad, maxX + pad] x [minY - pad, maxY + pad].
    const clipMinX = this.minX - pad;
    const clipMaxX = this.maxX + pad;
    const clipMinY = this.minY - pad;
    const clipMaxY = this.maxY + pad;

    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;

    if (dx === 0) {
      if (x0 < clipMinX || x0 > clipMaxX) return 0;
    } else {
      const invDx = 1 / dx;
      let txMin = (clipMinX - x0) * invDx;
      let txMax = (clipMaxX - x0) * invDx;
      if (txMin > txMax) {
        const tmp = txMin;
        txMin = txMax;
        txMax = tmp;
      }
      if (txMin > t0) t0 = txMin;
      if (txMax < t1) t1 = txMax;
      if (t0 > t1) return 0;
    }

    if (dy === 0) {
      if (y0 < clipMinY || y0 > clipMaxY) return 0;
    } else {
      const invDy = 1 / dy;
      let tyMin = (clipMinY - y0) * invDy;
      let tyMax = (clipMaxY - y0) * invDy;
      if (tyMin > tyMax) {
        const tmp = tyMin;
        tyMin = tyMax;
        tyMax = tmp;
      }
      if (tyMin > t0) t0 = tyMin;
      if (tyMax < t1) t1 = tyMax;
      if (t0 > t1) return 0;
    }

    const sx = x0 + t0 * dx;
    const sy = y0 + t0 * dy;
    const ex = x0 + t1 * dx;
    const ey = y0 + t1 * dy;

    const minBoundX = -padCells;
    const maxBoundX = this.cols - 1 + padCells;
    const minBoundY = -padCells;
    const maxBoundY = this.rows - 1 + padCells;

    let cx = clampInt(Math.floor((sx - this.minX) * this.invCellSize), minBoundX, maxBoundX);
    let cy = clampInt(Math.floor((sy - this.minY) * this.invCellSize), minBoundY, maxBoundY);
    const endCx = clampInt(Math.floor((ex - this.minX) * this.invCellSize), minBoundX, maxBoundX);
    const endCy = clampInt(Math.floor((ey - this.minY) * this.invCellSize), minBoundY, maxBoundY);

    const stamp = this.nextStamp();
    let count = this.collectCellBand(cx, cy, padCells, stamp, out, 0, cap);
    if (count >= cap || (cx === endCx && cy === endCy)) {
      return count;
    }

    const cdx = ex - sx;
    const cdy = ey - sy;
    const stepX = cdx > 0 ? 1 : cdx < 0 ? -1 : 0;
    const stepY = cdy > 0 ? 1 : cdy < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(this.cellSize / cdx) : Number.POSITIVE_INFINITY;
    const tDeltaY = stepY !== 0 ? Math.abs(this.cellSize / cdy) : Number.POSITIVE_INFINITY;

    let tMaxX =
      stepX !== 0
        ? (this.minX + (stepX > 0 ? cx + 1 : cx) * this.cellSize - sx) / cdx
        : Number.POSITIVE_INFINITY;
    let tMaxY =
      stepY !== 0
        ? (this.minY + (stepY > 0 ? cy + 1 : cy) * this.cellSize - sy) / cdy
        : Number.POSITIVE_INFINITY;

    const maxSteps = Math.abs(endCx - cx) + Math.abs(endCy - cy) + 2;
    for (let step = 0; step < maxSteps; step += 1) {
      if (tMaxX < tMaxY) {
        if (cx !== endCx && stepX !== 0) {
          cx += stepX;
          tMaxX += tDeltaX;
        } else if (cy !== endCy && stepY !== 0) {
          cy += stepY;
          tMaxY += tDeltaY;
        } else {
          break;
        }
      } else if (tMaxY < tMaxX) {
        if (cy !== endCy && stepY !== 0) {
          cy += stepY;
          tMaxY += tDeltaY;
        } else if (cx !== endCx && stepX !== 0) {
          cx += stepX;
          tMaxX += tDeltaX;
        } else {
          break;
        }
      } else {
        if (cx !== endCx && stepX !== 0) {
          cx += stepX;
          tMaxX += tDeltaX;
        }
        if (cy !== endCy && stepY !== 0) {
          cy += stepY;
          tMaxY += tDeltaY;
        }
      }

      count = this.collectCellBand(cx, cy, padCells, stamp, out, count, cap);
      if (count >= cap || (cx === endCx && cy === endCy)) {
        break;
      }
    }

    return count;
  }

  private nextStamp(): number {
    const next = (this.queryStamp + 1) >>> 0;
    if (next === 0) {
      this.visitStamp.fill(0);
      this.queryStamp = 1;
      return 1;
    }
    this.queryStamp = next;
    return next;
  }

  private collectCell(
    cellIndex: number,
    stamp: number,
    out: GridQueryBuffer,
    count: number,
    cap: number,
  ): number {
    let node = this.cellHead[cellIndex];
    const nodeEntity = this.nodeEntity;
    const nodeNext = this.nodeNext;
    const visitStamp = this.visitStamp;

    while (node !== -1 && count < cap) {
      const entityId = nodeEntity[node];
      if (visitStamp[entityId] !== stamp) {
        visitStamp[entityId] = stamp;
        out[count] = entityId;
        count += 1;
      }
      node = nodeNext[node];
    }

    return count;
  }

  private collectCellBand(
    cx: number,
    cy: number,
    padCells: number,
    stamp: number,
    out: GridQueryBuffer,
    count: number,
    cap: number,
  ): number {
    if (padCells === 0) {
      if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return count;
      return this.collectCell(cy * this.cols + cx, stamp, out, count, cap);
    }

    const minX = cx - padCells > 0 ? cx - padCells : 0;
    const maxX = cx + padCells < this.cols - 1 ? cx + padCells : this.cols - 1;
    const minY = cy - padCells > 0 ? cy - padCells : 0;
    const maxY = cy + padCells < this.rows - 1 ? cy + padCells : this.rows - 1;
    const cols = this.cols;

    for (let gy = minY; gy <= maxY; gy += 1) {
      const rowOffset = gy * cols;
      for (let gx = minX; gx <= maxX; gx += 1) {
        count = this.collectCell(rowOffset + gx, stamp, out, count, cap);
        if (count >= cap) return count;
      }
    }

    return count;
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
