import type { TireCompound } from './types';

// Update 5 §3: the "sim" tire. Same concepts a sim tire file exposes, our own maths:
// - a force curve per compound that rises to a peak at the friction-limit slip angle, then falls
//   to a falloff level at a falloff speed
// - load sensitivity: μ(Fz) = μref · (Fref / Fz)^(1 − exponent)
// - combined slip on a friction ellipse (μlong vs μlat)
// - camber (optimal small negative camber, camber thrust), inflation pressure,
//   a two-node thermal model and wear
// - relaxation length (the slip angle the tire "feels" lags the geometric one)
// - self-aligning torque from pneumatic trail
// Pure functions + a small per-wheel state object; no allocation in the hot loop.

export interface SimCompound {
  /** slip angle at peak lateral force (deg) */
  peakAngleDeg: number;
  /** slip ratio at peak longitudinal force */
  peakRatio: number;
  /** fraction of peak grip left when sliding far past the peak */
  falloffLevel: number;
  /** how quickly the force drops from the peak to the falloff level (per unit of normalised slip) */
  falloffSpeed: number;
  muLat: number;
  muLong: number;
  /** reference load for μ (N) */
  loadRef: number;
  /** load-sensitivity exponent (0.75–0.85: μ falls as load rises) */
  loadExp: number;
  /** optimal surface temperature window (°C) */
  tempLo: number;
  tempHi: number;
  /** ideal hot pressure (psi) */
  idealPsi: number;
  /** relaxation length at reference load (m) */
  relaxation: number;
  /** wear per MJ of sliding energy (fraction of tread) */
  wearRate: number;
  /** camber of best grip (deg, negative = top in) */
  camberOpt: number;
}

/** Fallback when a compound in tires.json has no "sim" block. */
export function simFromClassic(t: TireCompound): SimCompound {
  return {
    peakAngleDeg: (t.peakSlipAngle * 180) / Math.PI,
    peakRatio: t.peakSlipRatio,
    falloffLevel: 1 - t.falloff * 0.6,
    falloffSpeed: 1,
    muLat: t.mu,
    muLong: t.mu * t.longRatio,
    loadRef: 3000,
    loadExp: 0.8,
    tempLo: 70,
    tempHi: 90,
    idealPsi: 30,
    relaxation: 0.45,
    wearRate: 0.02,
    camberOpt: -1.5,
  };
}

/** Per-wheel tire state that persists between steps. */
export interface SimTireState {
  /** lagged slip angle the carcass actually has (rad) */
  alpha: number;
  /** surface and core temperature (°C) */
  tSurf: number;
  tCore: number;
  /** tread used 0..1 */
  wear: number;
  /** cold (set-up) pressure, psi */
  coldPsi: number;
  /** current hot pressure, psi */
  psi: number;
  /** camber relative to the road (deg, negative = top toward the car), set by the suspension each step */
  camberDeg: number;
  /** the same lean expressed toward the wheel's right (rad), for camber thrust */
  leanRight: number;
  /** self-aligning torque (N·m), for steering feel */
  mz: number;
  /** grip multiplier from temperature/pressure/wear (for the Tyre widget) */
  gripMul: number;
}

export function makeTireState(c: SimCompound, coldPsi = c.idealPsi - 3, temp = c.tempLo): SimTireState {
  return { alpha: 0, tSurf: temp, tCore: temp, wear: 0, coldPsi, psi: coldPsi, camberDeg: 0, leanRight: 0, mz: 0, gripMul: 1 };
}

export const AMBIENT_C = 20;

/**
 * Normalised force curve: s = slip / peak slip. Rises with zero slope at s = 1 to 1.0, then decays
 * toward `falloff` with a smooth gaussian shoulder controlled by `speed`.
 */
export function curve(s: number, falloff: number, speed: number): number {
  const a = Math.abs(s);
  if (a <= 1) return a * (2 - a);
  const d = (a - 1) * speed;
  return falloff + (1 - falloff) * Math.exp(-d * d);
}

/** μ at load Fz: falls as load rises (load sensitivity). */
export function muAtLoad(muRef: number, c: SimCompound, fz: number): number {
  return muRef * Math.pow(c.loadRef / Math.max(200, fz), 1 - c.loadExp);
}

/** Grip multiplier from surface temperature: 1 in the window, down to ~0.85 frozen / overheated. */
export function tempGrip(c: SimCompound, t: number): number {
  if (t < c.tempLo) return Math.max(0.85, 1 - ((c.tempLo - t) / 60) * 0.15);
  if (t > c.tempHi) return Math.max(0.8, 1 - ((t - c.tempHi) / 50) * 0.2);
  return 1;
}

/** Grip multiplier from hot pressure: the contact patch shrinks either side of ideal. */
export function pressureGrip(c: SimCompound, psi: number): number {
  const d = (psi - c.idealPsi) / c.idealPsi;
  return Math.max(0.85, 1 - 0.8 * d * d);
}

/** Camber: best near the optimum; the further away, the smaller the patch. */
export function camberGrip(c: SimCompound, camberDeg: number): number {
  const d = (camberDeg - c.camberOpt) / 6;
  return Math.max(0.85, 1 - 0.5 * d * d);
}

export interface SimTireOut {
  fx: number;
  fy: number;
  slip: number;
  slipRatio: number;
  slipAngle: number;
}

export const SIM_SLIP_FLOOR = 1.0;

/**
 * Forces in the contact frame (x forward, y right). Uses the lagged slip angle in `st` (call
 * relax() once per step first). Same sign conventions as the classic tire.
 */
export function simForces(c: SimCompound, st: SimTireState, vx: number, vy: number, wheelSpeed: number, load: number, grip: number, out: SimTireOut): SimTireOut {
  const ref = Math.max(Math.abs(vx), SIM_SLIP_FLOOR);
  const slipRatio = (wheelSpeed - vx) / ref;
  out.slipRatio = slipRatio;
  out.slipAngle = st.alpha;
  if (load <= 0) {
    out.fx = 0;
    out.fy = 0;
    out.slip = 0;
    return out;
  }
  const tanA = Math.tan(st.alpha);
  const sx = slipRatio / c.peakRatio;
  const sy = tanA / Math.tan((c.peakAngleDeg * Math.PI) / 180);
  const s = Math.hypot(sx, sy);
  out.slip = s;
  const mul = grip * st.gripMul;
  const muLat = muAtLoad(c.muLat, c, load) * mul;
  const muLong = muAtLoad(c.muLong, c, load) * mul;
  let fx = 0, fy = 0;
  if (s > 1e-9) {
    const f = curve(s, c.falloffLevel, c.falloffSpeed);
    // friction ellipse: the direction of the slip vector shares one force between the axes
    fx = muLong * load * f * (sx / s);
    fy = muLat * load * f * (sy / s);
  }
  // camber thrust: a leaning tire pushes toward the side it leans to; it fades once sliding
  fy += load * mul * 0.15 * st.leanRight * Math.max(0, 1 - s * 0.5);
  // low-speed blend: below ~2 m/s a damped "sticky" contact stops creep and jitter
  const lowV = Math.hypot(vx, vy);
  if (lowV < 2) {
    const k = 1 - lowV / 2;
    const sticky = Math.max(-muLat * load, Math.min(muLat * load, -vy * load * 0.9));
    fy = fy * (1 - k) + sticky * k;
  }
  out.fx = fx;
  out.fy = fy;
  // pneumatic trail: rises with slip angle up to the peak, then collapses past it
  const trail = 0.035 * Math.max(0, 1 - Math.abs(sy)) + 0.004;
  st.mz = -fy * trail;
  return out;
}

/** Relaxation length: the carcass slip angle follows the geometric one over a rolled distance. */
export function relax(c: SimCompound, st: SimTireState, vx: number, vy: number, load: number, dt: number): void {
  const ref = Math.max(Math.abs(vx), SIM_SLIP_FLOOR);
  const target = Math.atan(-vy / ref);
  // shorter at high load, longer with soft (low-pressure) tires
  const sigma = c.relaxation * Math.pow(c.loadRef / Math.max(500, load), 0.3) * (1 + Math.max(0, c.idealPsi - st.psi) * 0.02);
  const rolled = Math.max(Math.hypot(vx, vy), 0.5) * dt;
  st.alpha += (target - st.alpha) * Math.min(1, rolled / sigma);
}

/**
 * Two-node thermal model, pressure from temperature (ideal gas), wear, and the resulting grip
 * multiplier. `slidePower` = |slip velocity| × |force| (W).
 */
export function thermal(c: SimCompound, st: SimTireState, slidePower: number, speed: number, load: number, dt: number): void {
  const heatIn = slidePower * 0.004 + load * speed * 0.00004; // sliding + rolling hysteresis
  const cool = (6 + speed * 0.9) * (st.tSurf - AMBIENT_C) * 0.004;
  const toCore = (st.tSurf - st.tCore) * 0.25;
  st.tSurf += (heatIn - cool - toCore) * dt;
  st.tCore += (toCore * 0.25 - (st.tCore - AMBIENT_C) * 0.002) * dt;
  st.tSurf = Math.min(220, Math.max(-20, st.tSurf));
  st.tCore = Math.min(180, Math.max(-20, st.tCore));
  st.psi = st.coldPsi * ((st.tCore + 273) / (AMBIENT_C + 10 + 273));
  st.wear = Math.min(1, st.wear + (slidePower * dt * c.wearRate) / 1e6);
  st.gripMul = tempGrip(c, st.tSurf) * pressureGrip(c, st.psi) * camberGrip(c, st.camberDeg) * (1 - 0.15 * st.wear);
}
