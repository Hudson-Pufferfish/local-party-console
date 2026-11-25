import type { PhysicsBody2D } from './motion';

export interface CircleBody2D extends PhysicsBody2D {
  radius: number;
  mass?: number;
}

export interface CirclePairModifier {
  scaleI: number;
  scaleJ: number;
}

export interface CircleBufferPairHooks {
  isActive?: (index: number) => boolean;
  onImpact?: (i: number, j: number, modifier: CirclePairModifier) => void;
}

const impactModifier: CirclePairModifier = { scaleI: 1, scaleJ: 1 };

export function resolveCirclePair(
  p1: CircleBody2D,
  p2: CircleBody2D,
  restitution = 0.85,
  fallbackAngle = 0,
): boolean {
  const minDist = p1.radius + p2.radius;
  if (!Number.isFinite(minDist) || minDist <= 0) return false;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distSq = dx * dx + dy * dy;
  if (distSq >= minDist * minDist) return false;

  const m1 = p1.mass ?? 1;
  const m2 = p2.mass ?? 1;
  const invM1 = m1 > 0 && Number.isFinite(m1) ? 1 / m1 : 0;
  const invM2 = m2 > 0 && Number.isFinite(m2) ? 1 / m2 : 0;
  const invMassSum = invM1 + invM2;
  if (invMassSum === 0) return false;

  let nx = Math.cos(fallbackAngle);
  let ny = Math.sin(fallbackAngle);
  let dist = 0;
  if (distSq !== 0) {
    dist = Math.sqrt(distSq);
    nx = dx / dist;
    ny = dy / dist;
  }

  const overlap = minDist - dist;
  const sep1 = overlap * (invM1 / invMassSum);
  const sep2 = overlap * (invM2 / invMassSum);
  p1.x -= nx * sep1;
  p1.y -= ny * sep1;
  p2.x += nx * sep2;
  p2.y += ny * sep2;

  const vr = (p2.vx - p1.vx) * nx + (p2.vy - p1.vy) * ny;
  if (vr < 0) {
    const impulse = (-(1 + restitution) * vr) / invMassSum;
    p1.vx -= impulse * invM1 * nx;
    p1.vy -= impulse * invM1 * ny;
    p2.vx += impulse * invM2 * nx;
    p2.vy += impulse * invM2 * ny;
  }
  return true;
}

export function resolveCircleBufferPairs(
  buffer: Float32Array,
  count: number,
  stride: number,
  posOffset: number,
  velOffset: number,
  radius: number,
  restitution = 0.85,
  hooks?: CircleBufferPairHooks,
): void {
  const minDist = radius * 2;
  if (!Number.isFinite(minDist) || minDist <= 0) return;
  const minDistSq = minDist * minDist;
  const isActive = hooks?.isActive;
  const onImpact = hooks?.onImpact;

  for (let i = 0; i < count; i += 1) {
    if (isActive !== undefined && !isActive(i)) continue;
    const pi = i * stride + posOffset;
    const vi = i * stride + velOffset;
    for (let j = i + 1; j < count; j += 1) {
      if (isActive !== undefined && !isActive(j)) continue;
      const pj = j * stride + posOffset;
      const xi = buffer[pi];
      const yi = buffer[pi + 1];
      const xj = buffer[pj];
      const yj = buffer[pj + 1];
      const dx = xj - xi;
      const dy = yj - yi;
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDistSq) continue;

      let nx = Math.cos(i);
      let ny = Math.sin(i);
      let dist = 0;
      if (distSq !== 0) {
        dist = Math.sqrt(distSq);
        nx = dx / dist;
        ny = dy / dist;
      }
      const half = (minDist - dist) * 0.5;
      buffer[pi] = xi - nx * half;
      buffer[pi + 1] = yi - ny * half;
      buffer[pj] = xj + nx * half;
      buffer[pj + 1] = yj + ny * half;

      const vj = j * stride + velOffset;
      const vxi = buffer[vi];
      const vyi = buffer[vi + 1];
      const vxj = buffer[vj];
      const vyj = buffer[vj + 1];
      const vr = (vxj - vxi) * nx + (vyj - vyi) * ny;
      if (vr >= 0) continue;

      const impulse = (-(1 + restitution) * vr) / 2;
      let scaleI = 1;
      let scaleJ = 1;
      if (onImpact !== undefined) {
        impactModifier.scaleI = 1;
        impactModifier.scaleJ = 1;
        onImpact(i, j, impactModifier);
        scaleI = impactModifier.scaleI;
        scaleJ = impactModifier.scaleJ;
      }
      buffer[vi] = vxi - impulse * nx * scaleI;
      buffer[vi + 1] = vyi - impulse * ny * scaleI;
      buffer[vj] = vxj + impulse * nx * scaleJ;
      buffer[vj + 1] = vyj + impulse * ny * scaleJ;
    }
  }
}
