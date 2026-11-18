import type { TireCompound } from './types';

// Simplified Pacejka "magic formula" with combined slip.
//
// Longitudinal slip (ratio) and lateral slip (angle) are each normalised by their peak
// value, so 1.0 means "at the peak" in either direction. The two normalised slips form a
// vector; its length picks the force magnitude from one magic-formula curve and its
// direction sets how that force is shared between drive/brake and cornering. That is the
// friction circle: wheelspin or a locked wheel eats into the cornering grip and vice versa.

export interface TireCurve {
  B: number;
  C: number;
  E: number;
}

const curveCache = new Map<string, TireCurve>();

/** Build magic-formula coefficients so the peak lands at s = 1 and the force settles at (1 - falloff). */
export function makeCurve(falloff: number, E: number): TireCurve {
  const key = falloff.toFixed(4) + ':' + E.toFixed(4);
  const hit = curveCache.get(key);
  if (hit) return hit;
  const f = Math.min(0.6, Math.max(0.01, falloff));
  // sin(C * pi/2) = 1 - falloff  → the value the curve settles to at very large slip
  const C = 2 - (2 / Math.PI) * Math.asin(1 - f);
  // peak where C * atan(arg) = pi/2 → arg = tan(pi / 2C); solve arg(B, s=1) for B
  const phi = Math.tan(Math.PI / (2 * C));
  let B = phi;
  for (let i = 0; i < 30; i++) {
    const g = B - E * (B - Math.atan(B)) - phi;
    const dg = 1 - E * (1 - 1 / (1 + B * B));
    const step = g / dg;
    B -= step;
    if (Math.abs(step) < 1e-9) break;
  }
  const curve = { B, C, E };
  curveCache.set(key, curve);
  return curve;
}

/** Normalised force (0..1) for a normalised slip magnitude s >= 0. */
export function magic(c: TireCurve, s: number): number {
  const bs = c.B * s;
  return Math.sin(c.C * Math.atan(bs - c.E * (bs - Math.atan(bs))));
}

export interface TireResult {
  fx: number;
  fy: number;
  /** combined normalised slip (>1 means past the peak, i.e. sliding) */
  slip: number;
  slipRatio: number;
  slipAngle: number;
}

/** Below this speed slips are computed against this floor so they stay finite and stable. */
export const SLIP_SPEED_FLOOR = 2.5;

/**
 * Tire forces in the contact frame.
 * @param vx contact-patch velocity along the wheel's heading (m/s)
 * @param vy contact-patch velocity to the wheel's right (m/s)
 * @param wheelSpeed wheel surface speed omega * r (m/s)
 * @param load vertical load (N)
 * @param grip surface grip multiplier times per-axle grip
 */
export function tireForces(
  t: TireCompound,
  curve: TireCurve,
  vx: number,
  vy: number,
  wheelSpeed: number,
  load: number,
  grip: number,
  out: TireResult,
): TireResult {
  const ref = Math.max(Math.abs(vx), SLIP_SPEED_FLOOR);
  const slipRatio = (wheelSpeed - vx) / ref;
  const tanAlpha = -vy / ref;
  out.slipRatio = slipRatio;
  out.slipAngle = Math.atan(tanAlpha);
  if (load <= 0) {
    out.fx = 0;
    out.fy = 0;
    out.slip = 0;
    return out;
  }
  const sx = slipRatio / t.peakSlipRatio;
  const sy = tanAlpha / Math.tan(t.peakSlipAngle);
  const s = Math.hypot(sx, sy);
  out.slip = s;
  if (s < 1e-9) {
    out.fx = 0;
    out.fy = 0;
    return out;
  }
  const nominal = 3000;
  const mu = t.mu * Math.max(0.6, 1 - t.loadSensitivity * (load / nominal - 1));
  const F = mu * load * grip * magic(curve, s);
  out.fx = (F * sx) / s * t.longRatio;
  out.fy = (F * sy) / s;
  return out;
}
