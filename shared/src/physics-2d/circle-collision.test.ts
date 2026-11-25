import { expect, test } from 'vitest';
import {
  resolveCircleBufferPairs,
  resolveCirclePair,
  type CircleBody2D,
} from './circle-collision';

test('resolveCirclePair separates penetration, conserves momentum, and applies restitution', () => {
  // Separated bodies do not collide.
  const farA: CircleBody2D = { x: -50, y: 0, vx: 10, vy: 0, radius: 10, mass: 1 };
  const farB: CircleBody2D = { x: 50, y: 0, vx: -10, vy: 0, radius: 10, mass: 1 };
  expect(resolveCirclePair(farA, farB, 0.85)).toBe(false);
  expect(farA.x).toBe(-50);
  expect(farB.x).toBe(50);

  // Head-on unequal-mass collision: check separation, momentum conservation, and restitution.
  const a: CircleBody2D = { x: -5, y: 0, vx: 120, vy: 15, radius: 10, mass: 1 };
  const b: CircleBody2D = { x: 5, y: 0, vx: -60, vy: -25, radius: 10, mass: 3 };
  const pxBefore = a.mass! * a.vx + b.mass! * b.vx;
  const pyBefore = a.mass! * a.vy + b.mass! * b.vy;
  const keBefore = 0.5 * a.mass! * (a.vx * a.vx + a.vy * a.vy) + 0.5 * b.mass! * (b.vx * b.vx + b.vy * b.vy);

  expect(resolveCirclePair(a, b, 0.85)).toBe(true);
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(20, 5);
  // Lighter body shifts 3x farther than heavier body during separation (overlap = 10 -> 7.5 vs 2.5).
  expect(a.x).toBeCloseTo(-12.5, 5);
  expect(b.x).toBeCloseTo(7.5, 5);

  const pxAfter = a.mass! * a.vx + b.mass! * b.vx;
  const pyAfter = a.mass! * a.vy + b.mass! * b.vy;
  const keAfter = 0.5 * a.mass! * (a.vx * a.vx + a.vy * a.vy) + 0.5 * b.mass! * (b.vx * b.vx + b.vy * b.vy);
  expect(pxAfter).toBeCloseTo(pxBefore, 5);
  expect(pyAfter).toBeCloseTo(pyBefore, 5);
  // Tangential velocities remain unchanged on an X-axis collision.
  expect(a.vy).toBeCloseTo(15, 5);
  expect(b.vy).toBeCloseTo(-25, 5);
  // Relative normal velocity reverses scaled by restitution (-0.85 * (-180) = +153).
  expect(b.vx - a.vx).toBeCloseTo(0.85 * 180, 5);
  expect(keAfter).toBeLessThan(keBefore);

  // Perfectly elastic collision (restitution = 1) conserves kinetic energy.
  const eA: CircleBody2D = { x: -4, y: 0, vx: 100, vy: 0, radius: 10, mass: 2 };
  const eB: CircleBody2D = { x: 4, y: 0, vx: -50, vy: 0, radius: 10, mass: 1 };
  const eKeBefore = 0.5 * 2 * 100 * 100 + 0.5 * 1 * 50 * 50;
  expect(resolveCirclePair(eA, eB, 1)).toBe(true);
  const eKeAfter = 0.5 * 2 * eA.vx * eA.vx + 0.5 * 1 * eB.vx * eB.vx;
  expect(eKeAfter).toBeCloseTo(eKeBefore, 5);
});

test('resolveCirclePair handles exact overlap and already-separating pairs without NaN or sticking', () => {
  // Exact-center overlap stays finite and separates to r1 + r2.
  const c1: CircleBody2D = { x: 10, y: 10, vx: 0, vy: 0, radius: 15 };
  const c2: CircleBody2D = { x: 10, y: 10, vx: 0, vy: 0, radius: 15 };
  expect(resolveCirclePair(c1, c2, 0.85)).toBe(true);
  expect(Number.isFinite(c1.x) && Number.isFinite(c1.y)).toBe(true);
  expect(Number.isFinite(c2.x) && Number.isFinite(c2.y)).toBe(true);
  expect(Math.hypot(c2.x - c1.x, c2.y - c1.y)).toBeCloseTo(30, 5);

  // Already moving apart: separates position without pulling velocities back together.
  const s1: CircleBody2D = { x: -5, y: 0, vx: -40, vy: 0, radius: 10 };
  const s2: CircleBody2D = { x: 5, y: 0, vx: 40, vy: 0, radius: 10 };
  expect(resolveCirclePair(s1, s2, 0.85)).toBe(true);
  expect(Math.hypot(s2.x - s1.x, s2.y - s1.y)).toBeCloseTo(20, 5);
  expect(s1.vx).toBe(-40);
  expect(s2.vx).toBe(40);
});

test('resolveCircleBufferPairs resolves strided Float32Array pairs with optional active filter and impact scaling', () => {
  // Layout: 4-float header + 3 entities * stride 6 (x, y, vx, vy, pad, active).
  const header = 4;
  const stride = 6;
  const buf = new Float32Array(header + 3 * stride);

  // Entity 0 and Entity 1 collide head-on; Entity 2 overlaps Entity 0 but is inactive.
  buf[header + 0] = -10;
  buf[header + 1] = 0;
  buf[header + 2] = 100;
  buf[header + 3] = 0;
  buf[header + 5] = 1;

  buf[header + stride + 0] = 10;
  buf[header + stride + 1] = 0;
  buf[header + stride + 2] = -100;
  buf[header + stride + 3] = 0;
  buf[header + stride + 5] = 1;

  buf[header + 2 * stride + 0] = -10;
  buf[header + 2 * stride + 1] = 0;
  buf[header + 2 * stride + 2] = 0;
  buf[header + 2 * stride + 3] = 0;
  buf[header + 2 * stride + 5] = 0;

  let impacts = 0;
  resolveCircleBufferPairs(buf, 3, stride, header, header + 2, 20, 0.85, {
    isActive: (i) => buf[header + i * stride + 5] === 1,
    onImpact: (i, j, out) => {
      impacts += 1;
      if (i === 0 && j === 1) {
        out.scaleJ = 1.75;
      }
    },
  });

  expect(impacts).toBe(1);
  // Separated symmetrically to 2 * radius = 40 -> (-20, 0) and (20, 0).
  expect(buf[header + 0]).toBeCloseTo(-20, 4);
  expect(buf[header + stride + 0]).toBeCloseTo(20, 4);
  // Base impulse = -(1 + 0.85) * (-200) / 2 = 185.
  expect(buf[header + 2]).toBeCloseTo(100 - 185, 3);
  expect(buf[header + stride + 2]).toBeCloseTo(-100 + 185 * 1.75, 3);
  // Inactive entity 2 stays untouched.
  expect(buf[header + 2 * stride + 0]).toBe(-10);
  expect(buf[header + 2 * stride + 2]).toBe(0);
});
