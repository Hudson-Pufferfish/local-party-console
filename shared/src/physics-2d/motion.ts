export interface PhysicsBody2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function integrateMotion(body: PhysicsBody2D, dt: number, drag = 0): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  if (Number.isFinite(drag) && drag > 0) {
    const damp = Math.exp(-drag * dt);
    body.vx *= damp;
    body.vy *= damp;
  }
  body.x += body.vx * dt;
  body.y += body.vy * dt;
}
