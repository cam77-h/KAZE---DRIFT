import { describe, expect, it } from 'vitest';
import { carPhysics } from '../src/data';
import { FlatWorld } from '../src/physics/collision';
import { Vehicle } from '../src/physics/vehicle';
import { defaultAssists, emptyInput, type CarPhysicsSpec } from '../src/physics/types';

// Update 5 §4: drivetrain, engine, clutch and differential on the sim model.
const DT = 1 / 120;
function car(mod?: (s: CarPhysicsSpec) => void, manual = true) {
  const spec = carPhysics('sakura_s15');
  mod?.(spec);
  const world = new FlatWorld();
  const c = new Vehicle(spec, { ...defaultAssists(), driftAssist: 0, steeringAssist: false, abs: false, transmission: manual ? 'manual' : 'auto' }, 'sim');
  c.reset(world, 0, 0, 0);
  const inp = emptyInput();
  for (let i = 0; i < 60; i++) c.step(DT, inp, world);
  return { c, world, inp };
}
const rearSlip = (c: Vehicle) => Math.max(c.wheels[2].result.slipRatio, c.wheels[3].result.slipRatio);

describe('differential (§4)', () => {
  const spin = (type: 'open' | 'welded') => {
    const { c, world, inp } = car((s) => { s.diff = { type, preload: 0, accelLock: type === 'welded' ? 1 : 0, decelLock: type === 'welded' ? 1 : 0 }; });
    c.launch(25 / 3.6);
    inp.steer = 1;
    inp.throttle = 1;
    let maxDiff = 0;
    for (let i = 0; i < 180; i++) {
      c.step(DT, inp, world);
      maxDiff = Math.max(maxDiff, Math.abs(c.wheels[2].omega - c.wheels[3].omega));
    }
    return maxDiff;
  };
  it('the open diff lets the inside wheel spin up; the welded diff keeps both rears equal', () => {
    const open = spin('open'), welded = spin('welded');
    // road speed is ~22 rad/s at the wheel: the unloaded inside wheel runs 30%+ faster
    expect(open).toBeGreaterThan(0.3 * (25 / 3.6) / 0.317);
    expect(welded).toBeLessThan(0.5);
  });
  it('a 100% power / 100% coast LSD behaves as locked', () => {
    const { c, world, inp } = car((s) => { s.diff = { type: 'lsd2', preload: 50, accelLock: 1, decelLock: 1 }; });
    c.launch(25 / 3.6);
    inp.steer = 1;
    inp.throttle = 1;
    let maxDiff = 0;
    for (let i = 0; i < 180; i++) {
      c.step(DT, inp, world);
      maxDiff = Math.max(maxDiff, Math.abs(c.wheels[2].omega - c.wheels[3].omega));
    }
    expect(maxDiff).toBeLessThan(0.5);
  });
});

describe('clutch, limiter, engine braking (§4)', () => {
  it('a clutch kick at 6,000 rpm breaks the rear loose on the S15 at 60 km/h in 2nd', () => {
    const { c, world, inp } = car();
    c.launch(60 / 3.6);
    c.engine.gear = 2;
    c.engine.omega = ((60 / 3.6) / c.spec.wheelRadius) * c.engine.ratio() ;
    inp.steer = 0.3;
    inp.throttle = 0.3;
    for (let i = 0; i < 60; i++) c.step(DT, inp, world);
    expect(rearSlip(c)).toBeLessThan(0.1);
    // dip the clutch and rev to 6,000+
    inp.clutch = 1;
    inp.throttle = 1;
    for (let i = 0; i < 60 && c.engine.rpm < 6000; i++) c.step(DT, inp, world);
    expect(c.engine.rpm).toBeGreaterThan(6000);
    // drop it
    inp.clutch = 0;
    let slip = 0, angle = 0;
    for (let i = 0; i < 120; i++) {
      c.step(DT, inp, world);
      slip = Math.max(slip, rearSlip(c));
      angle = Math.max(angle, Math.abs(c.telemetry.driftAngle) * 57.3);
    }
    expect(slip).toBeGreaterThan(0.3);
    expect(angle).toBeGreaterThan(12);
  });

  it('the rev limiter bounces', () => {
    const { c, world, inp } = car();
    inp.clutch = 1;
    inp.throttle = 1;
    let cuts = 0, was = false, max = 0;
    for (let i = 0; i < 240; i++) {
      c.step(DT, inp, world);
      if (c.engine.limiterCut && !was) cuts++;
      was = c.engine.limiterCut;
      max = Math.max(max, c.engine.rpm);
    }
    expect(cuts).toBeGreaterThan(3);
    expect(max).toBeLessThan(c.spec.engine.limiterRpm + 500);
  });

  it('engine braking slows the car in gear, more than coasting with the clutch in', () => {
    const coast = (clutch: number) => {
      const { c, world, inp } = car();
      c.launch(100 / 3.6);
      c.engine.gear = 4;
      c.engine.omega = ((100 / 3.6) / c.spec.wheelRadius) * c.engine.ratio();
      inp.clutch = clutch;
      for (let i = 0; i < 240; i++) c.step(DT, inp, world);
      return 100 - c.telemetry.speed * 3.6;
    };
    const inGear = coast(0), free = coast(1);
    expect(inGear).toBeGreaterThan(free + 1.5);
    // realistic: a couple of km/h per second, not a wall
    expect(inGear / 2).toBeLessThan(9);
    expect(inGear / 2).toBeGreaterThan(1.5);
  });
});
