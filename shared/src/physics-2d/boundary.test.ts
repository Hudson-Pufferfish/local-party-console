import { expect, test } from 'vitest';
import { clampBoxBoundary, clampRadialBoundary } from './boundary';
import type { PhysicsBody2D } from './motion';

test('clampRadialBoundary contains positions within arenaRadius - bodyRadius and reflects outward velocity', () => {
  // Body safely inside is untouched.
  const inside: PhysicsBody2D = { x: 100, y: 50, vx: 80, vy: 40 };
  expect(clampRadialBoundary(inside, 400, 28, 0.85)).toBe(false);
  expect(inside).toEqual({ x: 100, y: 50, vx: 80, vy: 40 });

  // Body outside on +X with outward + tangential velocity bounces radially while keeping tangential speed.
  const outside: PhysicsBody2D = { x: 420, y: 0, vx: 200, vy: 75 };
  expect(clampRadialBoundary(outside, 400, 28, 0.85)).toBe(true);
  expect(outside.x).toBeLessThanOrEqual(372);
  expect(outside.x).toBeCloseTo(372, 3);
  expect(outside.y).toBeCloseTo(0, 5);
  expect(outside.vx).toBeCloseTo(-170, 4);
  expect(outside.vy).toBeCloseTo(75, 4);

  // Diagonal clamp remains <= maxR even after float32 rounding, and zero bounce cancels outward velocity only.
  const diag: PhysicsBody2D = { x: 300, y: 300, vx: 100, vy: 100 };
  expect(clampRadialBoundary(diag, 400, 28, 0)).toBe(true);
  const f32R = Math.hypot(Math.fround(diag.x), Math.fround(diag.y));
  expect(f32R).toBeLessThanOrEqual(372);
  expect(diag.vx).toBeCloseTo(0, 4);
  expect(diag.vy).toBeCloseTo(0, 4);

  // Body outside moving inward keeps its inward velocity.
  const inward: PhysicsBody2D = { x: 390, y: 0, vx: -50, vy: 10 };
  expect(clampRadialBoundary(inward, 400, 28, 0.85)).toBe(true);
  expect(inward.vx).toBe(-50);
  expect(inward.vy).toBe(10);

  // Degenerate bounds (arenaRadius <= bodyRadius) return false safely.
  const degen: PhysicsBody2D = { x: 10, y: 0, vx: 10, vy: 0 };
  expect(clampRadialBoundary(degen, 20, 28, 0.85)).toBe(false);
});

test('clampBoxBoundary clamps centered rectangular bounds and reflects outward axis velocity', () => {
  // Centered 200x100 box with radius 10 -> valid center range [-90, 90] x [-40, 40].
  const inside: PhysicsBody2D = { x: 20, y: -15, vx: 30, vy: -10 };
  expect(clampBoxBoundary(inside, 200, 100, 10, 0.8)).toBe(false);
  expect(inside).toEqual({ x: 20, y: -15, vx: 30, vy: -10 });

  // Corner violation clamps both axes and reflects both outward components.
  const corner: PhysicsBody2D = { x: 115, y: -60, vx: 50, vy: -100 };
  expect(clampBoxBoundary(corner, 200, 100, 10, 0.5)).toBe(true);
  expect(corner.x).toBe(90);
  expect(corner.y).toBe(-40);
  expect(corner.vx).toBeCloseTo(-25, 5);
  expect(corner.vy).toBeCloseTo(50, 5);

  // Zero bounce zeroes outward velocity without producing -0, and preserves inward velocity.
  const slide: PhysicsBody2D = { x: -105, y: 55, vx: -40, vy: -20 };
  expect(clampBoxBoundary(slide, 200, 100, 10, 0)).toBe(true);
  expect(slide.x).toBe(-90);
  expect(slide.y).toBe(40);
  expect(Object.is(slide.vx, 0)).toBe(true);
  expect(slide.vy).toBe(-20);
});
