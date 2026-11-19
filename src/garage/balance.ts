import tiresJson from '../data/tires.json';
import type { CarPhysicsSpec, TireCompound } from '../physics/types';

// Update 4 §3.1: the Mechanical Balance meter. ~0.55–0.60 is balanced, lower understeers, higher
// is loose at the rear. It combines roll-stiffness distribution (springs and anti-roll bars,
// the classic handling-balance lever), rear grip relative to front grip, weight distribution
// and diff lock.
const TIRES = tiresJson as Record<string, TireCompound>;

export function mechanicalBalance(s: CarPhysicsSpec): number {
  const q = s.suspension;
  const tf = s.trackFront ** 2, tr = s.trackRear ** 2;
  const rollF = q.springFront * tf + q.arbFront * tf * 2;
  const rollR = q.springRear * tr + q.arbRear * tr * 2;
  const rearRoll = rollR / (rollF + rollR);
  const muF = (TIRES[s.tireFront]?.mu ?? 1.2) * s.gripFront;
  const muR = (TIRES[s.tireRear]?.mu ?? 1.2) * s.gripRear;
  const front = s.cgToRear / (s.cgToFront + s.cgToRear);
  const lock = s.diff.type === 'welded' ? 1 : s.diff.accelLock;
  const m = 0.575 + (rearRoll - 0.44) * 1.1 - (muR / muF - 1.075) * 1.2 + (0.53 - front) * 0.6 + (lock - 0.35) * 0.08 + (s.downforceFront - s.downforceRear) * 0.05;
  return Math.min(0.95, Math.max(0.3, m));
}
