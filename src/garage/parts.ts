import { peakPower } from '../physics/drivetrain';
import type { CarPhysicsSpec, EngineSpec, TurboSpec } from '../physics/types';

// Update 4 §3: the upgrade catalogue. Structure follows the classic open-world racer flow:
// conversions first, then engine, platform & handling, drivetrain, tires & rims, aero & appearance.
// Every option is data plus a small `apply` that edits a copy of the car's physics spec, so the
// same function (applyBuild) drives the car, the rating, the stat bars and the acceleration test.
// All brands are fictional.

export type CategoryId = 'conversion' | 'engine' | 'platform' | 'drivetrain' | 'tires' | 'aero';
export type TierId = 'stock' | 'street' | 'sport' | 'race' | 'rally' | 'drift' | 'special';

export interface BuildCtx {
  /** the car's unmodified spec (reference values for relative changes) */
  base: CarPhysicsSpec;
  /** engine family after any swap (for sound and swap rules) */
  family: string;
}

export interface PartOption {
  id: string;
  tier: TierId;
  brand: string;
  name: string;
  price: number;
  level: number;
  /** plain-language effect shown on the tier card */
  desc: string;
  apply?: (s: CarPhysicsSpec, c: BuildCtx) => void;
  /** only offered when this returns true (e.g. turbo upgrades need a turbo) */
  when?: (s: CarPhysicsSpec, c: BuildCtx) => boolean;
}

export interface SlotDef {
  id: string;
  category: CategoryId;
  name: string;
  options: PartOption[];
  /** conversions: slots reset to stock when this slot changes */
  resets?: string[];
  /** purely visual slots don't count toward the rating */
  visualOnly?: boolean;
}

export const CATEGORIES: { id: CategoryId; name: string; jp: string }[] = [
  { id: 'conversion', name: 'Conversion', jp: 'コンバージョン' },
  { id: 'engine', name: 'Engine', jp: 'エンジン' },
  { id: 'platform', name: 'Platform & Handling', jp: 'シャシー' },
  { id: 'drivetrain', name: 'Drivetrain', jp: '駆動系' },
  { id: 'tires', name: 'Tires & Rims', jp: 'タイヤ・ホイール' },
  { id: 'aero', name: 'Aero & Appearance', jp: 'エアロ' },
];

export const TIER_NAMES: Record<TierId, string> = { stock: 'Stock', street: 'Street', sport: 'Sport', race: 'Race', rally: 'Rally', drift: 'Drift', special: 'Special' };

// ---------- helpers ----------
const DEG = Math.PI / 180;
/** scale the torque curve, blending from `low` (idle) to `high` (redline) */
function torque(s: CarPhysicsSpec, low: number, high = low): void {
  const red = s.engine.redlineRpm;
  s.engine.torqueCurve = s.engine.torqueCurve.map(([r, t]) => {
    const f = Math.min(1, Math.max(0, r / red));
    return [r, t * (low + (high - low) * f)] as [number, number];
  });
}
/** stretch the rev range: redline/limiter up, the curve's top end extended */
function revs(s: CarPhysicsSpec, add: number): void {
  const e = s.engine;
  const last = e.torqueCurve[e.torqueCurve.length - 1];
  e.redlineRpm += add;
  e.limiterRpm += add;
  e.torqueCurve = e.torqueCurve.map(([r, t]) => [r >= e.redlineRpm - add - 600 ? r + add : r, t] as [number, number]);
  if (last[0] < e.limiterRpm) e.torqueCurve.push([e.limiterRpm, last[1] * 0.85]);
}
function addMass(s: CarPhysicsSpec, kg: number, atFront = 0.5): void {
  // atFront: 1 = mass sits on the front axle, 0 = on the rear axle
  const a = s.cgToFront, b = s.cgToRear, m = s.mass;
  const x = -b + (a + b) * atFront; // position along the car, CG = 0
  const d = (kg * x) / (m + kg);
  s.mass = Math.max(600, m + kg);
  s.cgToFront = a - d;
  s.cgToRear = b + d;
}
const opt = (id: string, tier: TierId, brand: string, name: string, price: number, level: number, desc: string, apply?: PartOption['apply'], when?: PartOption['when']): PartOption => ({ id, tier, brand, name, price, level, desc, apply, when });
const STOCK = (desc = 'Factory part.'): PartOption => ({ id: 'stock', tier: 'stock', brand: 'Factory', name: 'Stock', price: 0, level: 1, desc });

// ---------- engine swaps ----------
interface EnginePreset {
  id: string;
  label: string;
  family: string;
  mass: number;
  spec: EngineSpec;
}
const curve = (pts: [number, number][]) => pts;
export const ENGINES: EnginePreset[] = [
  { id: 'sr', label: 'I4 2.0 turbo · SR-style', family: 'i4t', mass: 160, spec: { name: 'KS20-R 2.0L turbo I4', idleRpm: 850, redlineRpm: 7400, limiterRpm: 7800, inertia: 0.16, torqueCurve: curve([[800, 190], [2500, 290], [3500, 350], [4800, 375], [6000, 365], [7000, 330], [7800, 270]]), engineBrake: 70, turbo: { spoolRpm: 2500, fullBoostRpm: 4300, lag: 0.5, boostTorqueShare: 0.4, maxBoostBar: 1.0 }, sound: 'i4turbo', cylinders: 4 } },
  { id: 'rb', label: 'I6 2.6 twin-turbo · RB-style', family: 'i6tt', mass: 225, spec: { name: 'RB26-R 2.6L twin-turbo I6', idleRpm: 900, redlineRpm: 7800, limiterRpm: 8200, inertia: 0.19, torqueCurve: curve([[800, 260], [2500, 420], [3500, 540], [4600, 600], [6000, 585], [7200, 520], [8200, 420]]), engineBrake: 75, turbo: { spoolRpm: 2700, fullBoostRpm: 4400, lag: 0.55, boostTorqueShare: 0.45, maxBoostBar: 1.2 }, sound: 'i6tt', cylinders: 6 } },
  { id: '2j', label: 'I6 3.0 twin-turbo · 2J-style', family: 'i6tt', mass: 240, spec: { name: 'J30-TT 3.0L twin-turbo I6', idleRpm: 800, redlineRpm: 7000, limiterRpm: 7400, inertia: 0.21, torqueCurve: curve([[800, 300], [2200, 480], [3200, 620], [4200, 670], [5600, 640], [6600, 560], [7400, 450]]), engineBrake: 80, turbo: { spoolRpm: 2400, fullBoostRpm: 4000, lag: 0.6, boostTorqueShare: 0.45, maxBoostBar: 1.3 }, sound: 'i6tt', cylinders: 6 } },
  { id: '13b', label: '1.3 twin-rotor · 13B-style', family: 'rotary', mass: 125, spec: { name: '13B-R 1.3L twin-rotor turbo', idleRpm: 900, redlineRpm: 8800, limiterRpm: 9200, inertia: 0.11, torqueCurve: curve([[800, 150], [2500, 230], [4000, 330], [5500, 360], [7000, 345], [8200, 300], [9200, 240]]), engineBrake: 55, turbo: { spoolRpm: 3000, fullBoostRpm: 4800, lag: 0.5, boostTorqueShare: 0.42, maxBoostBar: 1.0 }, sound: 'rotary', cylinders: 4 } },
  { id: 'vq', label: 'V6 3.5 · VQ-style', family: 'v6', mass: 200, spec: { name: 'VQ35-S 3.5L V6', idleRpm: 750, redlineRpm: 7200, limiterRpm: 7500, inertia: 0.19, torqueCurve: curve([[800, 280], [2000, 360], [3500, 420], [4800, 445], [6000, 420], [7000, 380], [7500, 340]]), engineBrake: 80, sound: 'v6', cylinders: 6 } },
  { id: 'v8', label: 'V8 5.0', family: 'v8', mass: 235, spec: { name: 'K50 5.0L V8', idleRpm: 700, redlineRpm: 7000, limiterRpm: 7400, inertia: 0.24, torqueCurve: curve([[800, 420], [2000, 560], [3500, 640], [4500, 670], [5800, 640], [6800, 570], [7400, 500]]), engineBrake: 95, sound: 'v8', cylinders: 8 } },
  { id: 'moto', label: '1.0 motorcycle I4 (kei swap)', family: 'moto', mass: 65, spec: { name: 'GSX-K 1.0L bike I4', idleRpm: 1400, redlineRpm: 13000, limiterRpm: 13500, inertia: 0.045, torqueCurve: curve([[1000, 60], [4000, 85], [7000, 105], [9500, 118], [11500, 112], [13000, 98], [13500, 85]]), engineBrake: 30, sound: 'moto', cylinders: 4 } },
];
/** rough mass of the car's original engine, from its layout */
function stockEngineMass(e: EngineSpec): number {
  if (/rotor/i.test(e.name)) return 125;
  if (e.cylinders >= 8) return 235;
  if (e.cylinders === 6) return /V6/.test(e.name) ? 195 : 215;
  return 150;
}

// ---------- aspiration ----------
function addTurbo(s: CarPhysicsSpec, t: TurboSpec, gain: number): void {
  s.engine.turbo = t;
  torque(s, 1 + gain * 0.7, 1 + gain);
}
function naCurve(s: CarPhysicsSpec): void {
  // strip an existing turbo back to its naturally aspirated equivalent
  const t = s.engine.turbo;
  if (!t) return;
  torque(s, 1 / (1 + t.boostTorqueShare * 0.9));
  s.engine.turbo = undefined;
}

// ---------- the catalogue ----------
export const SLOTS: SlotDef[] = [
  // ---- conversions
  {
    id: 'engineSwap', category: 'conversion', name: 'Engine Swap', resets: ['aspiration', 'intake', 'manifold', 'fuel', 'ignition', 'exhaust', 'cams', 'valves', 'displacement', 'pistons', 'turbo', 'intercooler', 'flywheel'],
    options: [STOCK('The car\'s original engine.'), ...ENGINES.map((e) => opt(e.id, 'special' as TierId, 'Kaze Swap Co.', e.label, e.id === 'v8' ? 32000 : e.id === 'moto' ? 14000 : e.id === '2j' ? 30000 : e.id === 'rb' ? 26000 : 18000, e.id === 'moto' ? 3 : 10,
      `${e.spec.name}: ${Math.round(peakPower(e.spec).hp)} hp, ${e.spec.redlineRpm.toLocaleString()} rpm redline, ${e.mass} kg engine, new sound.`,
      (s) => {
        const old = s.engine;
        addMass(s, e.mass - stockEngineMass(old), 0.85);
        s.engine = structuredClone(e.spec);
      },
      (_s, c) => e.id !== 'moto' || ['takumi_ae'].includes(c.base.id)))],
  },
  {
    id: 'aspiration', category: 'conversion', name: 'Aspiration', resets: ['turbo', 'intercooler'],
    options: [
      STOCK('Factory induction.'),
      opt('na', 'special', 'Kaze Swap Co.', 'Naturally aspirated', 2500, 3, 'Removes the turbo: instant, linear response, less power.', (s) => naCurve(s), (s) => !!s.engine.turbo),
      opt('turboS', 'street', 'Hayate Turbo', 'Single turbo · small', 9000, 4, 'Quick spool, +25% power from mid-range.', (s) => { naCurve(s); addTurbo(s, { spoolRpm: 2200, fullBoostRpm: 3800, lag: 0.35, boostTorqueShare: 0.3, maxBoostBar: 0.8 }, 0.25); }),
      opt('turboM', 'sport', 'Hayate Turbo', 'Single turbo · medium', 13000, 7, '+40% power, a touch of lag.', (s) => { naCurve(s); addTurbo(s, { spoolRpm: 2700, fullBoostRpm: 4400, lag: 0.5, boostTorqueShare: 0.38, maxBoostBar: 1.1 }, 0.4); }),
      opt('turboL', 'race', 'Hayate Turbo', 'Single turbo · large', 19000, 11, '+60% power. Big lag, then everything at once.', (s) => { naCurve(s); addTurbo(s, { spoolRpm: 3400, fullBoostRpm: 5400, lag: 0.8, boostTorqueShare: 0.5, maxBoostBar: 1.6 }, 0.6); }),
      opt('twin', 'race', 'Hayate Turbo', 'Twin turbo', 22000, 12, '+52% power with less lag than one big turbo.', (s) => { naCurve(s); addTurbo(s, { spoolRpm: 2600, fullBoostRpm: 4300, lag: 0.45, boostTorqueShare: 0.45, maxBoostBar: 1.3 }, 0.52); }),
      opt('scCentri', 'sport', 'Raijin Blowers', 'Supercharger · centrifugal', 15000, 8, 'No lag. Boost rises with rpm: +35% at the top.', (s) => { naCurve(s); torque(s, 1.05, 1.35); }),
      opt('scScrew', 'race', 'Raijin Blowers', 'Supercharger · twin-screw', 18000, 10, 'No lag, big low-end punch: +30% everywhere.', (s) => { naCurve(s); torque(s, 1.32, 1.26); s.engine.inertia *= 1.08; }),
    ],
  },
  {
    id: 'drivetrainSwap', category: 'conversion', name: 'Drivetrain Swap', resets: ['diff', 'transmission'],
    options: [
      STOCK('Factory layout.'),
      opt('rwd', 'special', 'Kaze Swap Co.', 'RWD conversion', 12000, 5, 'Rear-wheel drive: the purest drift layout. −70 kg.', (s) => { if (s.layout === 'AWD') addMass(s, -70, 0.55); s.layout = 'RWD'; s.frontTorqueShare = 0; s.frontDiff = undefined; }, (s) => s.layout !== 'RWD'),
      opt('awd', 'special', 'Kaze Swap Co.', 'AWD conversion', 20000, 9, 'All-wheel drive: huge launches and exit grip. +70 kg, harder to hold a slide.', (s) => { if (s.layout !== 'AWD') addMass(s, 70, 0.55); s.layout = 'AWD'; s.frontTorqueShare = 0.32; s.frontDiff = { type: 'open', preload: 0, accelLock: 0, decelLock: 0 }; }, (s) => s.layout !== 'AWD'),
    ],
  },
  {
    id: 'bodyKit', category: 'conversion', name: 'Body Kit',
    options: [
      STOCK('Factory body.'),
      opt('street', 'street', 'Kitsune Garage', 'Street kit', 4000, 2, 'Lower lip, side skirts, a touch less drag.', (s) => { s.dragArea *= 0.97; }),
      opt('widebody', 'race', 'Kitsune Garage', 'Widebody', 16000, 9, 'Bolt-on arches: +60 mm track, room for the widest tires. +15 kg, a little more drag.', (s) => { s.trackFront += 0.06; s.trackRear += 0.07; s.width += 0.12; s.dragArea *= 1.04; addMass(s, 15); }),
      opt('missile', 'drift', 'Yamabiko Works', 'Drift missile', 3000, 4, 'Zip-tied bumpers, no undertray, stripped trim. −60 kg, a bit more drag.', (s) => { addMass(s, -60, 0.5); s.dragArea *= 1.03; }),
    ],
  },
  // ---- engine
  ...engineSlot('intake', 'Intake', 'Akatsuki', [[1500, '+2% power, more induction noise.', 1.01, 1.02], [3200, '+3% power.', 1.02, 1.035], [5500, '+5% power, loud intake roar.', 1.03, 1.05]]),
  ...engineSlot('manifold', 'Intake Manifold / Throttle Body', 'Akatsuki', [[2500, '+2% power, sharper throttle.', 1.015, 1.02], [4800, '+3% power.', 1.02, 1.035], [8000, '+5% power, top-end biased.', 1.02, 1.06]]),
  ...engineSlot('fuel', 'Fuel System', 'Shiden', [[1800, '+1% power.', 1.01, 1.015], [3600, '+2% power.', 1.02, 1.025], [6500, '+4% power, supports big boost.', 1.035, 1.045]]),
  ...engineSlot('ignition', 'Ignition', 'Shiden', [[1200, '+1% power.', 1.01, 1.01], [2600, '+2% power.', 1.02, 1.02], [4800, '+3% power.', 1.03, 1.03]]),
  {
    id: 'exhaust', category: 'engine', name: 'Exhaust',
    options: [STOCK(), opt('street', 'street', 'Tora Works', 'Tora Works Street Exhaust', 1800, 1, '+3% power, a deeper note.', (s) => torque(s, 1.02, 1.03)),
      opt('sport', 'sport', 'Tora Works', 'Tora Works Sport Exhaust', 3600, 3, '+5% power, louder, pops on lift.', (s) => torque(s, 1.04, 1.055)),
      opt('race', 'race', 'Tora Works', 'Tora Works Race Exhaust', 6000, 6, '+8% power for ¥6,000: the best value in the catalogue. Straight-pipe sound, crackles on every shift.', (s) => torque(s, 1.06, 1.09))],
  },
  {
    id: 'cams', category: 'engine', name: 'Camshaft',
    options: [STOCK(), opt('street', 'street', 'Shiden', 'Shiden Street Cams', 2400, 3, '+4% top-end power, same low end.', (s) => torque(s, 1.0, 1.04)),
      opt('sport', 'sport', 'Shiden', 'Shiden Sport Cams', 4800, 6, '+7% top end, −4% low end, +300 rpm.', (s) => { torque(s, 0.96, 1.07); revs(s, 300); }),
      opt('race', 'race', 'Shiden', 'Shiden Race Cams', 8500, 9, '+11% top end but −9% low end: power moves high, harder to modulate in a drift. +600 rpm.', (s) => { torque(s, 0.91, 1.11); revs(s, 600); })],
  },
  {
    id: 'valves', category: 'engine', name: 'Valves',
    options: [STOCK(), opt('sport', 'sport', 'Shiden', 'Shiden Sport Valvetrain', 4200, 5, '+2% power, +300 rpm.', (s) => { torque(s, 1.01, 1.025); revs(s, 300); }),
      opt('race', 'race', 'Shiden', 'Shiden Race Valvetrain', 7500, 8, '+4% power, +500 rpm.', (s) => { torque(s, 1.02, 1.04); revs(s, 500); })],
  },
  {
    id: 'displacement', category: 'engine', name: 'Displacement',
    options: [STOCK(), opt('street', 'street', 'Raijin Motorsport', 'Raijin Bore-up', 7000, 4, '+5% torque everywhere.', (s) => { torque(s, 1.05); s.engine.inertia *= 1.03; }),
      opt('sport', 'sport', 'Raijin Motorsport', 'Raijin Stroker', 14000, 7, '+10% torque everywhere.', (s) => { torque(s, 1.1); s.engine.inertia *= 1.05; }),
      opt('race', 'race', 'Raijin Motorsport', 'Raijin Big-Block Kit', 24000, 11, '+16% torque everywhere: the biggest single gain, and the biggest bill.', (s) => { torque(s, 1.16); s.engine.inertia *= 1.08; addMass(s, 8, 0.85); })],
  },
  ...engineSlot('pistons', 'Pistons & Compression', 'Raijin Motorsport', [[2200, '+1% power.', 1.01, 1.01], [4500, '+2% power.', 1.02, 1.025], [7800, '+4% power, forged internals.', 1.035, 1.045]]),
  {
    id: 'turbo', category: 'engine', name: 'Turbo / Supercharger upgrade',
    options: [STOCK(), opt('street', 'street', 'Hayate Turbo', 'Hayate Street Turbo', 5000, 3, '+6% power, slightly more lag.', (s) => { torque(s, 1.03, 1.06); if (s.engine.turbo) s.engine.turbo.lag *= 1.08; }, (s) => !!s.engine.turbo),
      opt('sport', 'sport', 'Hayate Turbo', 'Hayate Sport Turbo', 9500, 6, '+11% power, more lag, boost arrives later.', (s) => { torque(s, 1.04, 1.12); const t = s.engine.turbo!; t.lag *= 1.2; t.fullBoostRpm += 300; t.maxBoostBar += 0.3; }, (s) => !!s.engine.turbo),
      opt('race', 'race', 'Hayate Turbo', 'Hayate Race Turbo', 16000, 10, '+18% power. Bigger turbo = real lag: boost arrives 700 rpm later, then all at once.', (s) => { torque(s, 1.04, 1.2); const t = s.engine.turbo!; t.lag *= 1.45; t.fullBoostRpm += 700; t.spoolRpm += 400; t.boostTorqueShare = Math.min(0.6, t.boostTorqueShare + 0.06); t.maxBoostBar += 0.6; }, (s) => !!s.engine.turbo)],
  },
  ...engineSlot('intercooler', 'Intercooler', 'Fujin Cooling', [[2000, '+2% power at high boost.', 1.0, 1.02], [3800, '+3% power.', 1.01, 1.035], [6000, '+5% power, front-mount core.', 1.02, 1.055]], (s) => !!s.engine.turbo),
  {
    id: 'cooling', category: 'engine', name: 'Oil & Cooling',
    options: [STOCK('Power fades a little after long flat-out runs.'), opt('street', 'street', 'Fujin Cooling', 'Fujin Oil Cooler', 1500, 2, 'Less power fade on long sessions.', (s) => { s.engine.cooling = 1.6; }),
      opt('sport', 'sport', 'Fujin Cooling', 'Fujin Sport Radiator', 3000, 4, 'Very little power fade.', (s) => { s.engine.cooling = 2.4; }),
      opt('race', 'race', 'Fujin Cooling', 'Fujin Race Cooling Pack', 5200, 7, 'No power fade, ever.', (s) => { s.engine.cooling = 99; })],
  },
  {
    id: 'flywheel', category: 'engine', name: 'Flywheel',
    options: [STOCK(), opt('street', 'street', 'Kumo Tech', 'Kumo Street Flywheel', 1400, 2, 'Revs 15% faster.', (s) => { s.engine.inertia *= 0.85; }),
      opt('sport', 'sport', 'Kumo Tech', 'Kumo Chromoly Flywheel', 2800, 4, 'Revs 30% faster, snappier shifts and clutch kicks.', (s) => { s.engine.inertia *= 0.7; }),
      opt('race', 'race', 'Kumo Tech', 'Kumo Race Flywheel', 4600, 7, 'Revs 50% faster. Easy to stall a drift if you lift.', (s) => { s.engine.inertia *= 0.5; })],
  },
  // ---- platform & handling
  {
    id: 'brakes', category: 'platform', name: 'Brakes',
    options: [STOCK(), opt('street', 'street', 'Kumo Tech', 'Kumo Street Brakes', 2000, 1, '+15% stopping power.', (s) => { s.brakeTorque *= 1.15; }),
      opt('sport', 'sport', 'Kumo Tech', 'Kumo Sport Brakes', 4200, 4, '+30% stopping power.', (s) => { s.brakeTorque *= 1.3; addMass(s, -3); }),
      opt('race', 'race', 'Kumo Tech', 'Kumo Race Big Brake Kit', 7800, 8, '+50% stopping power. Unlocks brake balance and pressure tuning.', (s) => { s.brakeTorque *= 1.5; addMass(s, -6); })],
  },
  {
    id: 'springs', category: 'platform', name: 'Springs & Dampers',
    options: [STOCK(),
      opt('street', 'street', 'Yamabiko', 'Yamabiko Lowering Springs', 1800, 1, '−20 mm, +15% stiffer: less roll.', (s) => susp(s, 1.15, 1.1, -0.02)),
      opt('sport', 'sport', 'Yamabiko', 'Yamabiko Sport Coilovers', 4500, 4, '−30 mm, +35% stiffer, sharper response.', (s) => susp(s, 1.35, 1.25, -0.03)),
      opt('race', 'race', 'Yamabiko', 'Yamabiko Race Coilovers', 8000, 8, '−40 mm, +60% stiffer. Unlocks alignment, springs, ride height and damping tuning.', (s) => susp(s, 1.6, 1.45, -0.04)),
      opt('rally', 'rally', 'Yamabiko', 'Yamabiko Rally Suspension', 6000, 6, '+30 mm, softer, long travel: soaks up gravel and jumps. Unlocks suspension tuning.', (s) => { susp(s, 0.85, 0.9, 0.03); s.suspension.travel *= 1.35; }),
      opt('drift', 'drift', 'Yamabiko', 'Yamabiko Drift Coilovers', 7200, 6, 'Stiff front, softer rear for forward bite in a slide. Unlocks suspension tuning.', (s) => { susp(s, 1.4, 1.3, -0.035); s.suspension.springRear *= 0.82; s.suspension.springFront *= 1.12; })],
  },
  arbSlot('arbFront', 'Front Anti-roll Bar', 'arbFront'),
  arbSlot('arbRear', 'Rear Anti-roll Bar', 'arbRear'),
  {
    id: 'chassis', category: 'platform', name: 'Chassis Reinforcement / Roll Cage',
    options: [STOCK(), opt('street', 'street', 'Kitsune Garage', 'Strut-tower bars', 1600, 2, 'Stiffer chassis: +1% grip, crisper turn-in.', (s) => { s.gripFront *= 1.01; s.gripRear *= 1.01; addMass(s, 4); }),
      opt('sport', 'sport', 'Kitsune Garage', 'Bolt-in half cage', 4200, 5, '+2% grip, steadier in a slide. +18 kg.', (s) => { s.gripFront *= 1.02; s.gripRear *= 1.02; s.inertiaScale *= 0.98; addMass(s, 18, 0.4); }),
      opt('race', 'race', 'Kitsune Garage', 'Welded full roll cage', 9000, 9, '+4% grip, very stiff shell. +30 kg.', (s) => { s.gripFront *= 1.04; s.gripRear *= 1.04; s.inertiaScale *= 0.96; addMass(s, 30, 0.4); })],
  },
  {
    id: 'weight', category: 'platform', name: 'Weight Reduction',
    options: [STOCK(), opt('street', 'street', 'Kitsune Garage', 'Street weight reduction', 2500, 2, '−30 kg: spare wheel and sound deadening out.', (s) => addMass(s, -30, 0.4)),
      opt('sport', 'sport', 'Kitsune Garage', 'Sport weight reduction', 6000, 5, '−80 kg: rear seats, trim and carpet gone.', (s) => addMass(s, -80, 0.4)),
      opt('race', 'race', 'Kitsune Garage', 'Race weight reduction', 12000, 9, '−150 kg: stripped shell, lexan windows, bucket seat.', (s) => addMass(s, -150, 0.45))],
  },
  {
    id: 'angleKit', category: 'platform', name: 'Angle Kit',
    options: [STOCK('Factory steering lock (about 35°).'),
      opt('street', 'street', 'Wise Angle Co.', 'Angle Kit · 50°', 3500, 2, 'Steering lock to 50°: hold deeper drifts without spinning.', (s) => { s.steerLock = Math.max(s.steerLock, 50 * DEG); }),
      opt('sport', 'sport', 'Wise Angle Co.', 'Angle Kit · 60°', 6500, 5, 'Steering lock to 60°.', (s) => { s.steerLock = Math.max(s.steerLock, 60 * DEG); }),
      opt('race', 'race', 'Wise Angle Co.', 'Angle Kit · 70° (competition)', 10000, 9, 'Steering lock to 70°: pro-level angle.', (s) => { s.steerLock = Math.max(s.steerLock, 70 * DEG); })],
  },
  {
    id: 'handbrake', category: 'platform', name: 'Hydraulic Handbrake',
    options: [STOCK('Cable handbrake.'), opt('drift', 'drift', 'Yamabiko', 'Yamabiko Hydro E-brake', 2200, 2, 'Locks the rears instantly: +80% handbrake force for sharp entries.', (s) => { s.handbrakeTorque *= 1.8; })],
  },
  // ---- drivetrain
  {
    id: 'clutch', category: 'drivetrain', name: 'Clutch',
    options: [STOCK(), opt('street', 'street', 'Kumo Tech', 'Kumo Organic Clutch', 1500, 1, '+30% clamping: no slip with power upgrades.', (s) => { s.clutchTorque *= 1.3; }),
      opt('sport', 'sport', 'Kumo Tech', 'Kumo Twin-plate Clutch', 3800, 4, '+70% clamping, faster shifts.', (s) => { s.clutchTorque *= 1.7; s.gearbox.shiftTime *= 0.9; }),
      opt('race', 'race', 'Kumo Tech', 'Kumo Triple-plate Clutch', 6500, 7, 'Double the clamping force, violent clutch kicks.', (s) => { s.clutchTorque *= 2.1; s.gearbox.shiftTime *= 0.85; })],
  },
  {
    id: 'transmission', category: 'drivetrain', name: 'Transmission',
    options: [STOCK(), opt('street', 'street', 'Shiden', 'Shiden Short-shifter', 1800, 1, 'Shifts 10% faster.', (s) => { s.gearbox.shiftTime = Math.min(s.gearbox.shiftTime, 0.072); }),
      opt('sport', 'sport', 'Shiden', 'Shiden Close-ratio Gearbox', 6500, 5, 'Closer ratios keep the engine in its power band.', (s) => { closeRatios(s, 0.9); s.gearbox.shiftTime = 0.065; }),
      opt('race', 'race', 'Shiden', 'Shiden Race 6-speed', 11000, 8, 'Six close race ratios, 55 ms shifts. Unlocks gearing tuning.', (s) => { sixSpeed(s); s.gearbox.shiftTime = 0.055; }),
      opt('seq', 'race', 'Shiden', 'Shiden Race Sequential', 18000, 11, 'Dog-box sequential: 40 ms shifts, no lift. Unlocks gearing tuning.', (s) => { sixSpeed(s); s.gearbox.shiftTime = 0.04; s.gearbox.efficiency = Math.min(0.9, s.gearbox.efficiency + 0.02); })],
  },
  {
    id: 'driveline', category: 'drivetrain', name: 'Driveline',
    options: [STOCK(), opt('sport', 'sport', 'Kumo Tech', 'Carbon prop shaft', 3000, 4, 'Lighter driveline: +2% at the wheels, sharper revs.', (s) => { s.gearbox.efficiency = Math.min(0.9, s.gearbox.efficiency + 0.02); s.wheelInertia *= 0.95; }),
      opt('race', 'race', 'Kumo Tech', 'Race driveline', 6000, 7, '+3% at the wheels, lighter hubs and axles.', (s) => { s.gearbox.efficiency = Math.min(0.91, s.gearbox.efficiency + 0.03); s.wheelInertia *= 0.88; addMass(s, -6); })],
  },
  {
    id: 'diff', category: 'drivetrain', name: 'Differential',
    options: [STOCK(),
      opt('street', 'street', 'Raijin Motorsport', '1-way LSD', 2800, 2, 'Locks on power: better traction out of corners.', (s) => { s.diff = { type: 'lsd15', preload: 70, accelLock: 0.4, decelLock: 0.05 }; }),
      opt('sport', 'sport', 'Raijin Motorsport', '1.5-way LSD', 5200, 4, 'Locks on power and a little off it: stable and predictable.', (s) => { s.diff = { type: 'lsd15', preload: 90, accelLock: 0.5, decelLock: 0.25 }; }),
      opt('race', 'race', 'Raijin Motorsport', 'Race LSD', 8000, 8, 'Strong lock on power. Unlocks differential tuning.', (s) => { s.diff = { type: 'lsd2', preload: 110, accelLock: 0.65, decelLock: 0.35 }; }),
      opt('drift', 'drift', 'Raijin Motorsport', '2-way drift LSD', 7000, 5, 'Locks hard both ways: both rears spin together, slides stay committed. Unlocks diff tuning.', (s) => { s.diff = { type: 'lsd2', preload: 140, accelLock: 0.75, decelLock: 0.65 }; }),
      opt('welded', 'drift', 'Backyard Fab', 'Welded diff', 600, 1, 'Cheap and fully locked: easy slides, scrubs and hops in tight turns.', (s) => { s.diff = { type: 'welded', preload: 0, accelLock: 1, decelLock: 1 }; })],
  },
  // ---- tires & rims
  {
    id: 'compound', category: 'tires', name: 'Tire Compound',
    options: [STOCK('The car\'s factory tires.'), ...([
      ['street', 'street', 'Street', 800, 1, 'Everyday tires: predictable, long-lasting.'],
      ['sport', 'sport', 'Sport', 2000, 2, 'More grip, still smokes well.'],
      ['semislick', 'race', 'Semi-slick', 4800, 6, 'Big grip, sharp limit.'],
      ['slick', 'race', 'Race Slick', 8500, 10, 'Maximum grip on tarmac, terrible anywhere else.'],
      ['rally', 'rally', 'Rally', 3500, 4, 'Grip on gravel and dirt, soft on tarmac.'],
      ['snow', 'rally', 'Snow', 3000, 4, 'For snow and ice.'],
      ['drift', 'drift', 'Drift', 3200, 3, 'Built to slide: long, smooth breakaway and thick smoke.'],
    ] as const).map(([id, tier, nm, price, lv, desc]) => opt(id, tier, 'Senko Tyres', `Senko ${nm}`, price, lv, desc, (s) => { s.tireFront = id; s.tireRear = id; }))],
  },
  widthSlot('widthFront', 'Front Tire Width', 'gripFront'),
  widthSlot('widthRear', 'Rear Tire Width', 'gripRear'),
  {
    id: 'rimSize', category: 'tires', name: 'Rim Size',
    options: [STOCK(), opt('plus1', 'street', 'Kaze Wheels', '+1 inch rims', 1500, 1, 'Sharper response (+1% grip), slightly heavier wheels.', (s) => { s.gripFront *= 1.01; s.gripRear *= 1.01; s.wheelInertia *= 1.05; }),
      opt('plus2', 'sport', 'Kaze Wheels', '+2 inch rims', 2800, 3, 'Low-profile tires: +2% grip, heavier wheels.', (s) => { s.gripFront *= 1.02; s.gripRear *= 1.02; s.wheelInertia *= 1.1; })],
  },
  {
    id: 'track', category: 'tires', name: 'Track Width',
    options: [STOCK(), opt('plus15', 'street', 'Kaze Wheels', 'Spacers +15 mm', 600, 1, 'Wider stance, a little more stability.', (s) => { s.trackFront += 0.03; s.trackRear += 0.03; }),
      opt('plus30', 'sport', 'Kaze Wheels', 'Spacers +30 mm', 1100, 3, 'Wider still: less weight transfer in corners.', (s) => { s.trackFront += 0.06; s.trackRear += 0.06; })],
  },
  {
    id: 'rimStyle', category: 'tires', name: 'Rim Style', visualOnly: true,
    options: [STOCK('Factory wheels.'), ...RIMS().map((r) => opt(r.id, 'special', 'Kaze Wheels', r.name, 1200, 1, 'Visual only.'))],
  },
  // ---- aero & appearance
  aeroSlot('frontAero', 'Front Bumper / Splitter', [[1800, 'Street lip: +a little front downforce.', 0.006, 0.0], [4200, 'Sport splitter: front downforce.', 0.014, 0.01], [8000, 'Race splitter: lots of front grip at speed.', 0.026, 0.02]]),
  {
    id: 'wing', category: 'aero', name: 'Rear Wing',
    options: [STOCK('No wing (factory spoiler).'),
      opt('ducktail', 'street', 'Fujin Aero', 'Fujin Ducktail', 1500, 1, 'Small rear downforce, almost no drag.', (s) => aero(s, 0, 0.008, 0.005)),
      opt('lowgt', 'sport', 'Fujin Aero', 'Fujin Low GT Wing', 3500, 3, 'Rear downforce for fast corners.', (s) => aero(s, 0, 0.02, 0.02)),
      opt('highgt', 'sport', 'Fujin Aero', 'Fujin High GT Wing', 5000, 5, 'More rear downforce, more drag.', (s) => aero(s, 0, 0.03, 0.035)),
      opt('swan', 'race', 'Fujin Aero', 'Fujin Swan-neck Wing', 7500, 8, 'Clean airflow under the wing: big downforce for its drag.', (s) => aero(s, 0, 0.04, 0.035)),
      opt('adjustable', 'race', 'Fujin Aero', 'Fujin Adjustable Race Wing', 9500, 10, 'Adjustable: unlocks the downforce sliders (grip vs top speed).', (s) => aero(s, 0, 0.035, 0.035))],
  },
  aeroSlot('skirts', 'Side Skirts', [[1200, 'Cleaner airflow: −1% drag.', 0, -0.01], [2400, '−2% drag.', 0, -0.02]]),
  aeroSlot('diffuser', 'Rear Bumper / Diffuser', [[1600, 'Small rear downforce.', -0.004, 0.0], [3600, 'Race diffuser: rear downforce with no drag.', -0.012, 0.0]], true),
  {
    id: 'hood', category: 'aero', name: 'Hood',
    options: [STOCK(), opt('vented', 'street', 'Kitsune Garage', 'Vented hood', 1800, 2, 'Keeps the engine cool, −2 kg.', (s) => { addMass(s, -2, 0.95); s.engine.cooling = Math.max(s.engine.cooling ?? 1, 1.3); }),
      opt('carbon', 'race', 'Kitsune Garage', 'Carbon hood', 4500, 6, '−12 kg off the nose: turns in sharper.', (s) => addMass(s, -12, 0.95))],
  },
  aeroSlot('canards', 'Canards', [[1400, 'Front downforce, a little drag.', 0.008, 0.01]]),
  visual('flares', 'Fender Flares', ['Bolt-on flares', 'Riveted overfenders']),
  visual('tips', 'Exhaust Tips', ['Burnt titanium', 'Dual slash-cut', 'Oval race']),
  visual('banner', 'Window Banner', ['Kaze Drift', 'Touge Society', 'Midnight Club']),
  visual('underglow', 'Underglow', ['Sodium amber', 'Ice blue', 'Red', 'Purple']),
];

export function RIMS(): { id: string; name: string }[] {
  return ['Kumo 6', 'Mesh 15', 'Ray 5', 'Dish 4', 'Turbofan', 'Split 10', 'Star 7', 'Ronin', 'Gram 57', 'Steelie', 'Kasumi Y', 'Hachi 8', 'Lattice'].map((n, i) => ({ id: `rim${i}`, name: n }));
}

function engineSlot(id: string, name: string, brand: string, tiers: [number, string, number, number][], when?: PartOption['when']): SlotDef[] {
  const names = ['Street', 'Sport', 'Race'];
  const tierIds: TierId[] = ['street', 'sport', 'race'];
  return [{
    id, category: 'engine', name,
    options: [STOCK(), ...tiers.map(([price, desc, lo, hi], i) => opt(tierIds[i], tierIds[i], brand, `${brand} ${names[i]} ${name.split(' /')[0]}`, price, [1, 4, 7][i], desc, (s) => torque(s, lo, hi), when))],
  }];
}
function susp(s: CarPhysicsSpec, spring: number, damp: number, lower: number): void {
  const q = s.suspension;
  q.springFront *= spring; q.springRear *= spring;
  q.bumpFront *= damp; q.bumpRear *= damp; q.reboundFront *= damp; q.reboundRear *= damp;
  q.cgHeight += lower;
  q.travel = Math.max(0.14, q.travel + lower * 1.5);
}
function arbSlot(id: string, name: string, key: 'arbFront' | 'arbRear'): SlotDef {
  return {
    id, category: 'platform', name,
    options: [STOCK(), opt('street', 'street', 'Yamabiko', `Yamabiko Street ${name}`, 900, 1, '+25% roll stiffness.', (s) => { s.suspension[key] *= 1.25; }),
      opt('sport', 'sport', 'Yamabiko', `Yamabiko Sport ${name}`, 1800, 3, '+50% roll stiffness.', (s) => { s.suspension[key] *= 1.5; }),
      opt('race', 'race', 'Yamabiko', `Yamabiko Race ${name}`, 3200, 6, 'Adjustable bar: +80%. Unlocks anti-roll bar tuning.', (s) => { s.suspension[key] *= 1.8; })],
  };
}
function widthSlot(id: string, name: string, key: 'gripFront' | 'gripRear'): SlotDef {
  const steps: [string, string, number, number, number, boolean][] = [
    ['plus1', '+10 mm', 600, 1, 1.02, false], ['plus2', '+20 mm', 1200, 2, 1.04, false], ['plus3', '+30 mm (widebody)', 2000, 4, 1.06, true], ['plus4', '+40 mm (widebody)', 2800, 6, 1.08, true],
  ];
  return {
    id, category: 'tires', name,
    options: [STOCK(), ...steps.map(([oid, w, price, lv, g, wide]) => opt(oid, wide ? 'race' : oid === 'plus1' ? 'street' : 'sport', 'Senko Tyres', `${name} ${w}`, price, lv, `${Math.round((g - 1) * 100)}% more grip on this axle${wide ? '. Needs the widebody kit' : ''}.`, (s) => { s[key] *= g; s.wheelInertia *= 1 + (g - 1) * 0.5; }))],
  };
}
function aero(s: CarPhysicsSpec, front: number, rear: number, drag: number): void {
  // catalogue values are in "kit units"; ×12 gives lift area Cl·A in m² (a full race kit ≈ 1 m²)
  s.downforceFront += front * 12;
  s.downforceRear += rear * 12;
  s.dragArea *= 1 + drag;
}
function aeroSlot(id: string, name: string, tiers: [number, string, number, number][], rear = false): SlotDef {
  const tierIds: TierId[] = ['street', 'sport', 'race'];
  return {
    id, category: 'aero', name,
    options: [STOCK(), ...tiers.map(([price, desc, df, drag], i) => opt(tierIds[i], tierIds[i], 'Fujin Aero', `Fujin ${['Street', 'Sport', 'Race'][i]} ${name.split(' /')[0]}`, price, [1, 3, 6][i], desc, (s) => (rear ? aero(s, 0, -df, drag) : aero(s, df, 0, drag))))],
  };
}
function visual(id: string, name: string, names: string[]): SlotDef {
  return { id, category: 'aero', name, visualOnly: true, options: [STOCK('None.'), ...names.map((n, i) => opt(`v${i}`, 'special', 'Kitsune Garage', n, 400 + i * 200, 1, 'Visual only.'))] };
}
function closeRatios(s: CarPhysicsSpec, k: number): void {
  // a slightly taller 1st and geometric steps up to the unchanged top gear: smaller rpm drops
  const r = s.gearbox.ratios, n = r.length, top = r[n - 1], first = r[0] * k;
  s.gearbox.ratios = r.map((_, i) => +(first * Math.pow(top / first, i / (n - 1))).toFixed(3));
}
function sixSpeed(s: CarPhysicsSpec): void {
  // six geometric race ratios between a strong 1st and the old top gear (top speed is kept)
  const r = s.gearbox.ratios, top = r[r.length - 1], first = Math.max(r[0] * 0.92, top * 3.4);
  s.gearbox.ratios = Array.from({ length: 6 }, (_, i) => +(first * Math.pow(top / first, i / 5)).toFixed(3));
}

// ---------- build application ----------
export type Build = Record<string, string>;
export const SLOT_BY_ID: Record<string, SlotDef> = Object.fromEntries(SLOTS.map((s) => [s.id, s]));

export function optionOf(slot: string, id: string | undefined): PartOption {
  const sd = SLOT_BY_ID[slot];
  return sd?.options.find((o) => o.id === (id ?? 'stock')) ?? sd?.options[0] ?? STOCK();
}

/** the options a slot offers for this car and build (rules like "turbo upgrade needs a turbo") */
export function availableOptions(base: CarPhysicsSpec, build: Build, slot: string): PartOption[] {
  const sd = SLOT_BY_ID[slot];
  // evaluate the `when` rules against the car with everything up to this slot's category applied
  const order = CATEGORIES.map((c) => c.id);
  const before: Build = {};
  for (const [k, v] of Object.entries(build)) {
    const d = SLOT_BY_ID[k];
    if (d && (order.indexOf(d.category) < order.indexOf(sd.category) || (d.category === 'conversion' && k !== slot))) before[k] = v;
  }
  const spec = applyBuild(base, before);
  const ctx: BuildCtx = { base, family: spec.engine.sound };
  const wide = build.bodyKit === 'widebody';
  return sd.options.filter((o) => {
    if (o.when && !o.when(spec, ctx)) return false;
    if ((slot === 'widthFront' || slot === 'widthRear') && (o.id === 'plus3' || o.id === 'plus4') && !wide) return false;
    return true;
  });
}

/** Apply a build (slot → option id) to a copy of the car's base spec. Order: conversions first. */
export function applyBuild(base: CarPhysicsSpec, build: Build, tune?: Record<string, number>): CarPhysicsSpec {
  const s = structuredClone(base);
  const ctx: BuildCtx = { base, family: base.engine.sound };
  let beforeEngine: [number, number][] | null = null;
  for (const cat of CATEGORIES) {
    if (cat.id === 'engine') beforeEngine = s.engine.torqueCurve.map((p) => [p[0], p[1]] as [number, number]);
    if (cat.id === 'platform' && beforeEngine) compressEngineGains(s, beforeEngine, (peakPower(base.engine).hp * 1.15) / (base.mass / 1000));
    for (const sd of SLOTS) {
      if (sd.category !== cat.id) continue;
      const id = build[sd.id];
      if (!id || id === 'stock') continue;
      const o = sd.options.find((x) => x.id === id);
      if (!o?.apply) continue;
      if (o.when && !o.when(s, ctx)) continue;
      o.apply(s, ctx);
      ctx.family = s.engine.sound;
    }
  }
  if (tune) applyTune(s, build, tune);
  return s;
}

/**
 * Stacked bolt-ons have diminishing returns: the combined torque gain of the engine category is
 * scaled by 0.8 (a full race engine build is about +85% instead of +115%), and by less again for
 * engines that already make over 360 hp per tonne.
 */
function compressEngineGains(s: CarPhysicsSpec, before: [number, number][], stockPwr: number): void {
  // engines that are already strong for their weight have less headroom left
  const k = 0.8 * Math.min(1, 360 / stockPwr);
  const at = (rpm: number) => {
    let best = before[0];
    for (const p of before) if (Math.abs(p[0] - rpm) < Math.abs(best[0] - rpm)) best = p;
    return best[1];
  };
  s.engine.torqueCurve = s.engine.torqueCurve.map(([r, t]) => {
    const t0 = at(r);
    const g = t / t0;
    return [r, g > 1 ? t0 * (1 + (g - 1) * k) : t] as [number, number];
  });
}

/** Slots a conversion resets when it changes. */
export function resetsFor(slot: string): string[] {
  return SLOT_BY_ID[slot]?.resets ?? [];
}

// ---------- tuning (locked behind race parts, like the reference game) ----------
export interface TuneDef {
  key: string;
  group: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** the part that unlocks it: [slot, option ids] */
  needs: [string, string[]];
  needsLabel: string;
  /** neutral value (no change to the car) */
  neutral: number;
}
export const TUNES: TuneDef[] = [
  { key: 'camberF', group: 'Alignment', label: 'Camber front', min: -5, max: 0, step: 0.1, unit: '°', needs: ['springs', ['race', 'rally', 'drift']], needsLabel: 'Install Race Springs to tune', neutral: -1 },
  { key: 'camberR', group: 'Alignment', label: 'Camber rear', min: -5, max: 0, step: 0.1, unit: '°', needs: ['springs', ['race', 'rally', 'drift']], needsLabel: 'Install Race Springs to tune', neutral: -0.5 },
  { key: 'toeF', group: 'Alignment', label: 'Toe front', min: -1, max: 1, step: 0.05, unit: '°', needs: ['springs', ['race', 'rally', 'drift']], needsLabel: 'Install Race Springs to tune', neutral: 0 },
  { key: 'toeR', group: 'Alignment', label: 'Toe rear', min: -1, max: 1, step: 0.05, unit: '°', needs: ['springs', ['race', 'rally', 'drift']], needsLabel: 'Install Race Springs to tune', neutral: 0 },
  { key: 'caster', group: 'Alignment', label: 'Caster', min: 3, max: 9, step: 0.1, unit: '°', needs: ['springs', ['race', 'rally', 'drift']], needsLabel: 'Install Race Springs to tune', neutral: 5 },
  { key: 'springF', group: 'Springs', label: 'Spring rate front', min: 0.6, max: 1.6, step: 0.02, unit: '×', needs: ['springs', ['race', 'rally', 'drift']], needsLabel: 'Install Race Springs to tune', neutral: 1 },
  { key: 'springR', group: 'Springs', label: 'Spring rate rear', min: 0.6, max: 1.6, step: 0.02, unit: '×', needs: ['springs', ['race', 'rally', 'drift']], needsLabel: 'Install Race Springs to tune', neutral: 1 },
  { key: 'ride', group: 'Springs', label: 'Ride height', min: -0.04, max: 0.04, step: 0.005, unit: 'm', needs: ['springs', ['race', 'rally', 'drift']], needsLabel: 'Install Race Springs to tune', neutral: 0 },
  { key: 'damp', group: 'Damping', label: 'Damping', min: 0.6, max: 1.6, step: 0.02, unit: '×', needs: ['springs', ['race', 'rally', 'drift']], needsLabel: 'Install Race Springs to tune', neutral: 1 },
  { key: 'arbF', group: 'Anti-roll bars', label: 'Front ARB', min: 0.4, max: 1.8, step: 0.02, unit: '×', needs: ['arbFront', ['race']], needsLabel: 'Install a Race Front ARB to tune', neutral: 1 },
  { key: 'arbR', group: 'Anti-roll bars', label: 'Rear ARB', min: 0.4, max: 1.8, step: 0.02, unit: '×', needs: ['arbRear', ['race']], needsLabel: 'Install a Race Rear ARB to tune', neutral: 1 },
  { key: 'brakeBias', group: 'Brakes', label: 'Brake balance (front)', min: 0.45, max: 0.8, step: 0.01, unit: '', needs: ['brakes', ['race']], needsLabel: 'Install Race Brakes to tune', neutral: -1 },
  { key: 'brakePressure', group: 'Brakes', label: 'Brake pressure', min: 0.7, max: 1.3, step: 0.01, unit: '×', needs: ['brakes', ['race']], needsLabel: 'Install Race Brakes to tune', neutral: 1 },
  { key: 'final', group: 'Gearing', label: 'Final drive', min: 0.8, max: 1.25, step: 0.01, unit: '×', needs: ['transmission', ['race', 'seq']], needsLabel: 'Install a Race Transmission to tune', neutral: 1 },
  { key: 'diffAccel', group: 'Differential', label: 'Acceleration lock', min: 0, max: 1, step: 0.01, unit: '', needs: ['diff', ['race', 'drift']], needsLabel: 'Install a Race Differential to tune', neutral: -1 },
  { key: 'diffDecel', group: 'Differential', label: 'Deceleration lock', min: 0, max: 1, step: 0.01, unit: '', needs: ['diff', ['race', 'drift']], needsLabel: 'Install a Race Differential to tune', neutral: -1 },
  { key: 'aeroF', group: 'Aero', label: 'Front downforce', min: 0.5, max: 1.6, step: 0.02, unit: '×', needs: ['wing', ['adjustable']], needsLabel: 'Install the Adjustable Race Wing to tune', neutral: 1 },
  { key: 'aeroR', group: 'Aero', label: 'Rear downforce', min: 0.5, max: 1.6, step: 0.02, unit: '×', needs: ['wing', ['adjustable']], needsLabel: 'Install the Adjustable Race Wing to tune', neutral: 1 },
];

export function tuneUnlocked(def: TuneDef, build: Build): boolean {
  return def.needs[1].includes(build[def.needs[0]] ?? 'stock');
}

/** the value a slider shows when the player has not touched it */
export function tuneDefault(def: TuneDef, spec: CarPhysicsSpec): number {
  if (def.key === 'brakeBias') return spec.brakeBias;
  if (def.key === 'diffAccel') return spec.diff.accelLock;
  if (def.key === 'diffDecel') return spec.diff.decelLock;
  return def.neutral;
}

function applyTune(s: CarPhysicsSpec, build: Build, tune: Record<string, number>): void {
  const v = (k: string) => {
    const def = TUNES.find((d) => d.key === k)!;
    if (!tuneUnlocked(def, build) || tune[k] === undefined) return undefined;
    return Math.min(def.max, Math.max(def.min, tune[k]));
  };
  const q = s.suspension;
  // alignment: camber near −1.5° front / −1° rear is the grip peak; toe-out front sharpens
  // turn-in, toe-in rear steadies the rear; caster adds self-centring (counter-steer speed)
  const cf = v('camberF'), cr = v('camberR');
  if (cf !== undefined) s.gripFront *= 1 + 0.02 - 0.01 * Math.abs(cf + 1.5) ** 1.5;
  if (cr !== undefined) s.gripRear *= 1 + 0.015 - 0.01 * Math.abs(cr + 1) ** 1.5;
  const tf = v('toeF'), tr = v('toeR'), cas = v('caster');
  if (tf !== undefined) s.gripFront *= 1 - 0.01 * Math.abs(tf) + Math.max(0, -tf) * 0.015;
  if (tr !== undefined) { s.gripRear *= 1 + Math.max(0, tr) * 0.02 - Math.max(0, -tr) * 0.03; s.falloffRear *= 1 + tr * 0.1; }
  if (cas !== undefined) s.steerLock *= 1 + (cas - 5) * 0.004;
  const sf = v('springF'), sr = v('springR'), ride = v('ride'), damp = v('damp');
  if (sf !== undefined) q.springFront *= sf;
  if (sr !== undefined) q.springRear *= sr;
  if (ride !== undefined) { q.cgHeight += ride; q.travel = Math.max(0.12, q.travel + ride); }
  if (damp !== undefined) { q.bumpFront *= damp; q.bumpRear *= damp; q.reboundFront *= damp; q.reboundRear *= damp; }
  const af = v('arbF'), ar = v('arbR');
  if (af !== undefined) q.arbFront *= af;
  if (ar !== undefined) q.arbRear *= ar;
  const bb = v('brakeBias'), bp = v('brakePressure');
  if (bb !== undefined && bb >= 0) s.brakeBias = bb;
  if (bp !== undefined) s.brakeTorque *= bp;
  const fd = v('final');
  if (fd !== undefined) s.gearbox.final *= fd;
  const da = v('diffAccel'), dd = v('diffDecel');
  if (da !== undefined && da >= 0 && s.diff.type !== 'welded') s.diff.accelLock = da;
  if (dd !== undefined && dd >= 0 && s.diff.type !== 'welded') s.diff.decelLock = dd;
  const ef = v('aeroF'), er = v('aeroR');
  if (ef !== undefined || er !== undefined) {
    const f0 = s.downforceFront, r0 = s.downforceRear;
    s.downforceFront *= ef ?? 1;
    s.downforceRear *= er ?? 1;
    // more wing = more drag
    const added = s.downforceFront - f0 + (s.downforceRear - r0);
    s.dragArea *= 1 + added * 0.35;
  }
}

/** The "best" build: the top performance tier in every slot (no conversions). Used by the acceleration test. */
export function fullyUpgraded(base: CarPhysicsSpec): Build {
  const b: Build = { bodyKit: 'widebody' };
  const pick: Record<string, string> = {
    intake: 'race', manifold: 'race', fuel: 'race', ignition: 'race', exhaust: 'race', cams: 'race', valves: 'race', displacement: 'race', pistons: 'race', intercooler: 'race', turbo: 'race', cooling: 'race', flywheel: 'race',
    brakes: 'race', springs: 'race', arbFront: 'race', arbRear: 'race', chassis: 'race', weight: 'race',
    clutch: 'race', transmission: 'seq', driveline: 'race', diff: 'race',
    compound: 'slick', widthFront: 'plus4', widthRear: 'plus4', rimSize: 'plus1', track: 'plus30',
    frontAero: 'race', wing: 'swan', skirts: 'sport', diffuser: 'sport', hood: 'carbon',
  };
  for (const [k, v] of Object.entries(pick)) if (availableOptions(base, { ...b, ...pick }, k).some((o) => o.id === v)) b[k] = v;
  return b;
}
