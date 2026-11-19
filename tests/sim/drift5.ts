// Shared helpers for the Update 5 sim-model tests: a drift-prepared car and a "gamepad bot"
// that only uses throttle and a small stick input (±0.25).
import { carPhysics } from '../../src/data';
import { applyBuild } from '../../src/garage/parts';
import { FlatWorld } from '../../src/physics/collision';
import { Vehicle } from '../../src/physics/vehicle';
import { defaultAssists, emptyInput, type CarPhysicsSpec } from '../../src/physics/types';

export const DT = 1 / 120;

/** angle kit 60°, locked 2-way diff, drift tires, drift alignment (Section 7 turns this into the Drift Base preset) */
export function driftSpec(id = 'sakura_s15'): CarPhysicsSpec {
  const s = applyBuild(carPhysics(id), { angleKit: 'sport', diff: 'drift', compound: 'drift' });
  s.diff.accelLock = 1;
  s.diff.decelLock = 1;
  s.alignment = { camberFront: -6.5, camberRear: 0.4, toeFront: -0.3, toeRear: 0.15, caster: 7.5, ackermann: 0.1 };
  return s;
}

export function driftCar(opts: { id?: string; spec?: CarPhysicsSpec; assist?: number; speed?: number; gear?: number } = {}) {
  const spec = opts.spec ?? driftSpec(opts.id);
  const world = new FlatWorld();
  const car = new Vehicle(spec, { ...defaultAssists(), driftAssist: 0, steeringAssist: false, abs: false, countersteer: opts.assist ?? 0.7, transmission: 'manual' }, 'sim');
  car.engine.powerScale = 1.15;
  car.reset(world, 0, 0, 0);
  const v = (opts.speed ?? 50) / 3.6;
  car.launch(v);
  car.engine.gear = opts.gear ?? 2;
  car.engine.omega = (v / spec.wheelRadius) * car.engine.ratio();
  return { car, world, inp: emptyInput() };
}

/** body slip angle in degrees (+ = sliding to the right) */
export const angleDeg = (car: Vehicle) => car.telemetry.driftAngle * (180 / Math.PI);

/** Gamepad bot: holds `target`° with throttle and a stick limited to ±0.25 (PD on angle). */
export class HoldBot {
  private prev = 0;
  constructor(private target = 35) {}
  input(car: Vehicle, inp: ReturnType<typeof emptyInput>): void {
    const ang = angleDeg(car), a = Math.abs(ang);
    const dA = (a - this.prev) / DT;
    this.prev = a;
    const err = this.target - a, into = ang < 0 ? 1 : -1;
    inp.handbrake = 0;
    inp.throttle = Math.max(0.1, Math.min(1, 0.6 + 0.02 * err - 0.006 * dA));
    inp.steer = into * Math.max(-0.25, Math.min(0.25, 0.02 * err - 0.006 * dA));
  }
}

/** Runs `seconds` and returns the longest continuous stretch held between lo and hi degrees. */
export function longestHold(car: Vehicle, world: FlatWorld, inp: ReturnType<typeof emptyInput>, ctl: (t: number) => void, seconds: number, lo = 25, hi = 50) {
  let t = 0, hold = 0, best = 0, maxAngle = 0;
  for (let n = 0; n < seconds / DT; n++) {
    ctl(t);
    car.step(DT, inp, world);
    t += DT;
    const a = Math.abs(angleDeg(car));
    maxAngle = Math.max(maxAngle, a);
    if (a >= lo && a <= hi && car.telemetry.speed > 4) hold += DT;
    else {
      best = Math.max(best, hold);
      hold = 0;
    }
  }
  return { hold: Math.max(best, hold), maxAngle, speed: car.telemetry.speed * 3.6 };
}
