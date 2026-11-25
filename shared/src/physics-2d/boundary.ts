import type { PhysicsBody2D } from './motion';

/** Clamp a body inside a circular arena centered at (0, 0). */
export function clampRadialBoundary(
  body: PhysicsBody2D,
  arenaRadius: number,
  bodyRadius: number,
  bounceMultiplier = 0,
): boolean {
  const maxR = arenaRadius - bodyRadius;
  if (!Number.isFinite(maxR) || maxR <= 0) return false;
  const maxRSq = maxR * maxR;
  const x = body.x;
  const y = body.y;
  const radiusSq = x * x + y * y;
  if (radiusSq <= maxRSq) return false;

  const radius = Math.sqrt(radiusSq);
  const nx = x / radius;
  const ny = y / radius;
  let clampedX = nx * maxR;
  let clampedY = ny * maxR;
  const f32x = Math.fround(clampedX);
  const f32y = Math.fround(clampedY);
  if (clampedX * clampedX + clampedY * clampedY > maxRSq || f32x * f32x + f32y * f32y > maxRSq) {
    const safe = maxR * (1 - 1e-6);
    clampedX = nx * safe;
    clampedY = ny * safe;
  }
  body.x = clampedX;
  body.y = clampedY;

  const outward = body.vx * nx + body.vy * ny;
  if (outward > 0) {
    const impulse = (1 + bounceMultiplier) * outward;
    body.vx -= impulse * nx;
    body.vy -= impulse * ny;
  }
  return true;
}

/** Clamp a body inside a rectangular arena of size width x height centered at (0, 0). */
export function clampBoxBoundary(
  body: PhysicsBody2D,
  width: number,
  height: number,
  bodyRadius: number,
  bounceMultiplier = 0,
): boolean {
  const halfW = width * 0.5 - bodyRadius;
  const halfH = height * 0.5 - bodyRadius;
  if (!Number.isFinite(halfW) || !Number.isFinite(halfH) || halfW <= 0 || halfH <= 0) {
    return false;
  }

  let clamped = false;
  if (body.x > halfW) {
    body.x = halfW;
    if (body.vx > 0) body.vx = -body.vx * bounceMultiplier || 0;
    clamped = true;
  } else if (body.x < -halfW) {
    body.x = -halfW;
    if (body.vx < 0) body.vx = -body.vx * bounceMultiplier || 0;
    clamped = true;
  }
  if (body.y > halfH) {
    body.y = halfH;
    if (body.vy > 0) body.vy = -body.vy * bounceMultiplier || 0;
    clamped = true;
  } else if (body.y < -halfH) {
    body.y = -halfH;
    if (body.vy < 0) body.vy = -body.vy * bounceMultiplier || 0;
    clamped = true;
  }
  return clamped;
}
