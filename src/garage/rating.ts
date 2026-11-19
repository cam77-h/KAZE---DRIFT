import tiresJson from '../data/tires.json';
import { peakPower, RPM_TO_RADS } from '../physics/drivetrain';
import { ARCADE_POWER } from '../physics/performance';
import type { CarPhysicsSpec, TireCompound } from '../physics/types';

// Update 4 §3.4: one function rates every car, everywhere (showroom, upgrade shop, events).
// Rating 100–999 from power-to-weight, grip, braking, aero and handling; class bands D…R.
// Stat bars 0–10. All analytic, so hover previews update instantly; the honest 0–100 and top
// speed shown next to them come from the physics run in performance.ts.

export type ClassId = 'D' | 'C' | 'B' | 'A' | 'S1' | 'S2' | 'R';
export const CLASSES: { id: ClassId; min: number; max: number; color: string }[] = [
  { id: 'D', min: 100, max: 400, color: '#5ec8e5' },
  { id: 'C', min: 401, max: 500, color: '#f2c94c' },
  { id: 'B', min: 501, max: 600, color: '#f2994a' },
  { id: 'A', min: 601, max: 700, color: '#eb5757' },
  { id: 'S1', min: 701, max: 800, color: '#bb6bd9' },
  { id: 'S2', min: 801, max: 900, color: '#2f80ed' },
  { id: 'R', min: 901, max: 999, color: '#27ae60' },
];
export function classOf(rating: number): (typeof CLASSES)[number] {
  return CLASSES.find((c) => rating <= c.max) ?? CLASSES[CLASSES.length - 1];
}

export interface StatBars {
  speed: number;
  handling: number;
  acceleration: number;
  launch: number;
  braking: number;
  drift: number;
}
export interface CarRating {
  rating: number;
  cls: ClassId;
  color: string;
  bars: StatBars;
  hp: number;
  torque: number;
  mass: number;
  frontPct: number;
  /** analytic estimates (the shop shows the simulated numbers when they are ready) */
  estTop: number;
  pwr: number;
}

const TIRES = tiresJson as Record<string, TireCompound>;
const G = 9.81;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const bar = (v: number) => Math.round(clamp(v, 0, 10) * 10) / 10;

export function rate(s: CarPhysicsSpec, powerScale = ARCADE_POWER): CarRating {
  const pk = peakPower(s.engine);
  const hp = pk.hp * powerScale;
  const torque = Math.max(...s.engine.torqueCurve.map(([, t]) => t)) * powerScale;
  const ton = s.mass / 1000;
  const pwr = hp / ton;
  const frontPct = s.cgToRear / (s.cgToFront + s.cgToRear);

  // top speed: power vs drag + rolling, capped by gearing at the limiter
  const tf = TIRES[s.tireFront] ?? TIRES.sport, tr = TIRES[s.tireRear] ?? TIRES.sport;
  const pw = hp * 745.7 * s.gearbox.efficiency;
  const crr = (tf.rolling + tr.rolling) / 2;
  let lo = 0, hi = 150;
  for (let i = 0; i < 40; i++) {
    const v = (lo + hi) / 2;
    const need = (0.5 * 1.2 * s.dragArea * v * v + crr * s.mass * G) * v;
    if (need > pw) hi = v; else lo = v;
  }
  const r = s.gearbox.ratios;
  const vGear = (s.engine.limiterRpm * RPM_TO_RADS * s.wheelRadius) / (r[r.length - 1] * s.gearbox.final);
  const top = Math.min(lo, vGear) * 3.6;

  // lateral grip (g) at 120 km/h including downforce
  const q = 0.5 * 1.2 * (120 / 3.6) ** 2;
  const df = (s.downforceFront + s.downforceRear) * q;
  const mu = (tf.mu * s.gripFront + tr.mu * s.gripRear) / 2;
  const lat = mu * (1 + df / (s.mass * G)) * (1 - (s.suspension.cgHeight - 0.45) * 0.3);
  // braking (g), limited by tire grip
  const brake = Math.min((s.brakeTorque / s.wheelRadius) / (s.mass * G), mu * 1.05);
  // traction-limited launch: driven-axle share of grip
  const driven = s.layout === 'AWD' ? 1 : s.layout === 'FWD' ? frontPct * 0.9 : (1 - frontPct) * 1.12;
  const launchG = Math.min(driven * (tr.mu * tr.longRatio * s.gripRear), (torque * r[0] * s.gearbox.final * s.gearbox.efficiency) / s.wheelRadius / (s.mass * G));
  // drift: steering lock, diff lock, power and a forgiving breakaway
  const lockDeg = (s.steerLock * 180) / Math.PI;
  const diffLock = s.diff.type === 'welded' ? 1 : s.diff.type === 'lsd2' ? 0.85 : s.diff.type === 'lsd15' ? 0.6 : 0.2;
  const rwd = s.layout === 'RWD' ? 1 : s.layout === 'AWD' ? 0.6 : 0.1;
  const forgiving = 1 - clamp((tr.falloff - 0.12) * 3, 0, 0.6);

  const bars: StatBars = {
    speed: bar((top - 150) / 22),
    handling: bar((lat - 0.85) / 0.075 + (s.inertiaScale < 1 ? 0.3 : 0)),
    acceleration: bar((pwr - 60) / 55),
    launch: bar((launchG - 0.35) / 0.07),
    braking: bar((brake - 0.7) / 0.08),
    drift: bar(rwd * (2 + clamp((lockDeg - 30) / 40, 0, 1) * 3 + diffLock * 2 + clamp(pwr / 250, 0, 1.5) * 1.6 + forgiving * 1.2)),
  };

  // rating: power-to-weight dominates, then grip; braking, aero and handling fill in
  const a = Math.pow(Math.max(0, (pwr - 70) / 630), 0.75);
  const g = Math.max(0, (lat - 0.85) / 0.85);
  const b = clamp((brake - 0.7) / 0.7, 0, 1.2);
  const aero = clamp(df / (s.mass * G) / 0.25, 0, 1);
  const launch = clamp((launchG - 0.35) / 0.7, 0, 1);
  let raw = 100 + 430 * a + 260 * g + 70 * b + 50 * aero + 70 * launch;
  // compress the top end so heavily built cars spread across S1–R instead of piling up at 999
  if (raw > 600) raw = 600 + 399 * (1 - Math.exp(-(raw - 600) / 420));
  const rating = Math.round(clamp(raw, 100, 999));
  const c = classOf(rating);
  return { rating, cls: c.id, color: c.color, bars, hp, torque, mass: s.mass, frontPct, estTop: top, pwr };
}
