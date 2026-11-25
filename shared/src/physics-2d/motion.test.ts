import { expect, test } from 'vitest';
import { integrateMotion, type PhysicsBody2D } from './motion';

test('integrateMotion advances position without drag and applies exponential damping with drag', () => {
  // Zero drag: constant velocity integration.
  const linear: PhysicsBody2D = { x: 10, y: -5, vx: 120, vy: -60 };
  integrateMotion(linear, 0.5);
  expect(linear.vx).toBe(120);
  expect(linear.vy).toBe(-60);
  expect(linear.x).toBeCloseTo(70, 5);
  expect(linear.y).toBeCloseTo(-35, 5);

  // Exponential drag matches semi-implicit Euler: v *= exp(-drag * dt), x += v * dt.
  const damped: PhysicsBody2D = { x: 0, y: 0, vx: 100, vy: -200 };
  const dt = 1 / 120;
  const drag = 4.2;
  const expectedFactor = Math.exp(-drag * dt);
  integrateMotion(damped, dt, drag);
  expect(damped.vx).toBeCloseTo(100 * expectedFactor, 6);
  expect(damped.vy).toBeCloseTo(-200 * expectedFactor, 6);
  expect(damped.x).toBeCloseTo(damped.vx * dt, 6);
  expect(damped.y).toBeCloseTo(damped.vy * dt, 6);

  // Non-positive or non-finite dt is a safe no-op.
  const frozen: PhysicsBody2D = { x: 3, y: 4, vx: 50, vy: 60 };
  integrateMotion(frozen, 0, 4.2);
  integrateMotion(frozen, -0.1, 4.2);
  integrateMotion(frozen, Number.NaN, 4.2);
  expect(frozen).toEqual({ x: 3, y: 4, vx: 50, vy: 60 });
});
