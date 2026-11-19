import { describe, expect, it } from 'vitest';
import tiresJson from '../src/data/tires.json';
import { carPhysics } from '../src/data';
import { FlatWorld } from '../src/physics/collision';
import { Vehicle } from '../src/physics/vehicle';
import { curve, makeTireState, muAtLoad, relax, simForces, thermal, type SimCompound } from '../src/physics/simTire';
import { defaultAssists, emptyInput, type TireCompound } from '../src/physics/types';

// Update 5 §1–3: the sim model's chassis, suspension and tires.
const TIRES = tiresJson as unknown as Record<string, TireCompound & { sim: SimCompound }>;
const DT = 1 / 120;
const out = { fx: 0, fy: 0, slip: 0, slipRatio: 0, slipAngle: 0 };

/** lateral force at a steady slip angle (deg), after the relaxation length has settled */
function fyAt(c: SimCompound, deg: number, load = 3000) {
  const st = makeTireState(c, c.idealPsi);
  st.tSurf = (c.tempLo + c.tempHi) / 2;
  st.camberDeg = c.camberOpt;
  thermal(c, st, 0, 0, load, 0);
  const vx = 20, vy = -Math.tan((deg * Math.PI) / 180) * vx;
  for (let i = 0; i < 400; i++) relax(c, st, vx, vy, load, 1 / 360);
  return simForces(c, st, vx, vy, vx, load, 1, out).fy;
}

describe('sim tire (§3)', () => {
  for (const id of ['street', 'sport', 'semislick', 'drift']) {
    it(`${id}: peaks at its friction-limit angle and falls to its falloff level`, () => {
      const c = TIRES[id].sim;
      let best = 0, bestDeg = 0;
      for (let d = 0.5; d <= 30; d += 0.25) {
        const f = fyAt(c, d);
        if (f > best) { best = f; bestDeg = d; }
      }
      expect(Math.abs(bestDeg - c.peakAngleDeg)).toBeLessThan(0.8);
      const far = fyAt(c, 60);
      expect(far / best).toBeGreaterThan(c.falloffLevel - 0.06);
      expect(far / best).toBeLessThan(c.falloffLevel + 0.04);
    });
  }

  it('the drift compound has a wider peak and holds more grip when sliding than street', () => {
    expect(TIRES.drift.sim.peakAngleDeg).toBeGreaterThan(TIRES.street.sim.peakAngleDeg);
    expect(TIRES.drift.sim.falloffLevel).toBeGreaterThan(TIRES.street.sim.falloffLevel);
    expect(curve(3, 0.92, 0.6)).toBeGreaterThan(curve(3, 0.85, 1.0));
  });

  it('load sensitivity: μ falls as load rises', () => {
    const c = TIRES.sport.sim;
    expect(muAtLoad(1, c, 6000)).toBeLessThan(muAtLoad(1, c, 3000));
    expect(muAtLoad(1, c, 1500)).toBeGreaterThan(muAtLoad(1, c, 3000));
    // force still rises with load, just less than proportionally
    expect(fyAt(c, 6, 6000)).toBeGreaterThan(fyAt(c, 6, 3000));
    expect(fyAt(c, 6, 6000)).toBeLessThan(2 * fyAt(c, 6, 3000));
  });

  it('combined slip stays inside the friction ellipse', () => {
    const c = TIRES.sport.sim;
    const st = makeTireState(c, c.idealPsi);
    st.tSurf = 85;
    st.camberDeg = c.camberOpt;
    thermal(c, st, 0, 0, 3000, 0);
    st.alpha = (8 * Math.PI) / 180;
    const pure = Math.abs(simForces(c, st, 20, -2.8, 20, 3000, 1, out).fy);
    for (const sr of [0.05, 0.15, 0.4, 1]) {
      const r = simForces(c, st, 20, -2.8, 20 * (1 + sr), 3000, 1, out);
      const e = Math.hypot(r.fx / (c.muLong * 3000), r.fy / (c.muLat * 3000));
      expect(e).toBeLessThanOrEqual(1.02);
      expect(Math.abs(r.fy)).toBeLessThan(pure);
    }
  });

  it('relaxation length: lateral force lags a step in slip angle', () => {
    const c = TIRES.sport.sim;
    const st = makeTireState(c, c.idealPsi);
    const steps: number[] = [];
    for (let i = 0; i < 40; i++) {
      relax(c, st, 20, -1.5, 3000, 1 / 360);
      steps.push(st.alpha);
    }
    const target = Math.atan(1.5 / 20);
    expect(steps[0]).toBeLessThan(target * 0.25);
    expect(steps[39]).toBeGreaterThan(target * 0.9);
  });

  it('thermal: sliding warms the tread, the window gives full grip, pressure rises with heat', () => {
    const c = TIRES.drift.sim;
    const st = makeTireState(c, 28, 20);
    thermal(c, st, 0, 0, 3000, 0);
    const coldGrip = st.gripMul;
    const psi0 = st.psi;
    for (let i = 0; i < 360 * 20; i++) thermal(c, st, 25000, 20, 3500, 1 / 360);
    expect(st.tSurf).toBeGreaterThan(c.tempLo - 5);
    expect(st.psi).toBeGreaterThan(psi0);
    expect(st.wear).toBeGreaterThan(0);
    expect(coldGrip).toBeLessThan(1);
  });
});

function simCar(id = 'sakura_s15') {
  const world = new FlatWorld();
  const car = new Vehicle(carPhysics(id), { ...defaultAssists(), driftAssist: 0, steeringAssist: false }, 'sim');
  car.reset(world, 0, 0, 0);
  return { car, world, inp: emptyInput() };
}

describe('sim chassis and suspension (§1–2)', () => {
  it('a car dropped from 0.3 m settles in under 1.5 s', () => {
    const { car, world, inp } = simCar();
    car.position.y += 0.3;
    const ys: number[] = [];
    for (let i = 0; i < 360; i++) {
      car.step(DT, inp, world);
      ys.push(car.position.y);
    }
    const final = ys[ys.length - 1];
    const settled = ys.findIndex((_, i) => ys.slice(i).every((y) => Math.abs(y - final) < 0.005));
    expect(settled * DT).toBeLessThan(1.5);
  });

  it('body roll in a steady corner is 2–5° toward the outside', () => {
    const { car, world, inp } = simCar();
    // near the grip limit, as on a skidpad
    car.launch(80 / 3.6);
    inp.steer = 0.18;
    inp.throttle = 0.45;
    for (let i = 0; i < 480; i++) car.step(DT, inp, world);
    // the body's left vector (1,0,0) rotated: its y is + when the left side is up
    const leftY = 2 * (car.quaternion.x * car.quaternion.y + car.quaternion.w * car.quaternion.z);
    const roll = (Math.asin(leftY) * 180) / Math.PI;
    // steering right (+) turns right; the car rolls left (left side down)
    expect(Math.abs(roll)).toBeGreaterThan(2);
    expect(Math.abs(roll)).toBeLessThan(5);
    expect(roll).toBeLessThan(0);
  });

  it('brake dive and throttle squat', () => {
    const pitch = (car: Vehicle) => {
      // forward vector y: + = nose up
      const q = car.quaternion;
      return (Math.asin(2 * (q.y * q.z - q.w * q.x)) * 180) / Math.PI;
    };
    const a = simCar();
    for (let i = 0; i < 120; i++) a.car.step(DT, a.inp, a.world);
    const rest = pitch(a.car);
    a.inp.throttle = 1;
    let squat = rest;
    for (let i = 0; i < 90; i++) {
      a.car.step(DT, a.inp, a.world);
      squat = Math.max(squat, pitch(a.car));
    }
    const b = simCar();
    b.car.launch(90 / 3.6);
    for (let i = 0; i < 60; i++) b.car.step(DT, b.inp, b.world);
    b.inp.brake = 1;
    let dive = rest;
    for (let i = 0; i < 60; i++) {
      b.car.step(DT, b.inp, b.world);
      dive = Math.min(dive, pitch(b.car));
    }
    expect(squat - rest).toBeGreaterThan(0.4);
    expect(rest - dive).toBeGreaterThan(0.6);
  });

  it('fuzz: 100 seeds × 60 s of random input never produce NaN', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 100; k++) {
      seed = k + 7;
      const { car, world, inp } = simCar(k % 2 ? 'takumi_ae' : 'sakura_s15');
      car.launch(rnd() * 30);
      for (let i = 0; i < 120 * 60; i += 1) {
        if (i % 30 === 0) {
          inp.steer = rnd() * 2 - 1;
          inp.throttle = rnd() > 0.4 ? rnd() : 0;
          inp.brake = rnd() > 0.8 ? rnd() : 0;
          inp.handbrake = rnd() > 0.9 ? 1 : 0;
          inp.clutch = rnd() > 0.95 ? 1 : 0;
        }
        car.step(DT, inp, world);
        if (i % 600 === 0) expect(Number.isFinite(car.position.x + car.velocity.length() + car.engine.omega)).toBe(true);
      }
      expect(car.nanResets).toBe(0);
    }
  }, 600_000);

  it('burnout: full throttle on a stationary car spins the rear wheels up', () => {
    const { car, world, inp } = simCar();
    for (let i = 0; i < 60; i++) car.step(DT, inp, world);
    inp.throttle = 1;
    inp.brake = 0;
    // hold the car with the front brakes only: a burnout
    car.spec.brakeBias = 1;
    car.rebuild();
    inp.brake = 1;
    inp.throttle = 1;
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      car.step(DT, { ...inp, brake: 0 }, world);
      // keep it from launching: pin the body
      car.velocity.set(0, car.velocity.y, 0);
      peak = Math.max(peak, car.wheels[2].omega * car.wheels[2].radius);
    }
    expect(peak).toBeGreaterThan(10);
  });
});
