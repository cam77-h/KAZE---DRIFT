import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { makeCar, DT } from './sim/common';
import { driftRun } from './sim/drift';
import { makeCurve, magic, tireForces } from '../src/physics/tire';
import { getTire } from '../src/physics/vehicle';
import { FlatWorld } from '../src/physics/collision';
import { Engine, peakPower } from '../src/physics/drivetrain';
import cars from '../src/data/cars.json';
import type { CarPhysicsSpec } from '../src/physics/types';

const kmh = (v: number) => v * 3.6;
const deg = (r: number) => (r * 180) / Math.PI;

describe('tire model', () => {
  it('peaks at normalised slip 1 and settles at (1 - falloff)', () => {
    const c = makeCurve(0.2, -0.4);
    expect(magic(c, 1)).toBeCloseTo(1, 3);
    expect(magic(c, 0.9)).toBeLessThan(1);
    expect(magic(c, 1.1)).toBeLessThan(1);
    expect(magic(c, 200)).toBeGreaterThan(0.79);
    expect(magic(c, 200)).toBeLessThan(0.85);
  });

  it('never exceeds the friction circle under combined slip', () => {
    const t = getTire('sport');
    const c = makeCurve(t.falloff, t.shapeE);
    const out = { fx: 0, fy: 0, slip: 0, slipRatio: 0, slipAngle: 0 };
    const load = 3000;
    for (let i = 0; i < 2000; i++) {
      const vx = Math.random() * 60 - 10;
      const vy = Math.random() * 30 - 15;
      const ws = Math.random() * 90 - 20;
      tireForces(t, c, vx, vy, ws, load, 1, out);
      const f = Math.hypot(out.fx / t.longRatio, out.fy);
      expect(f).toBeLessThanOrEqual(t.mu * load * 1.0001);
      expect(Number.isFinite(out.fx) && Number.isFinite(out.fy)).toBe(true);
    }
  });

  it('wheelspin reduces cornering force (friction circle)', () => {
    const t = getTire('sport');
    const c = makeCurve(t.falloff, t.shapeE);
    const a = { fx: 0, fy: 0, slip: 0, slipRatio: 0, slipAngle: 0 };
    const b = { ...a };
    tireForces(t, c, 20, 2, 20, 3000, 1, a); // rolling, cornering
    tireForces(t, c, 20, 2, 30, 3000, 1, b); // same, with 50% wheelspin
    expect(Math.abs(b.fy)).toBeLessThan(Math.abs(a.fy) * 0.6);
  });
});

describe('drivetrain', () => {
  const spec = (cars as Record<string, { physics: CarPhysicsSpec }>).sakura_s15.physics;
  it('stock S15 makes about 245 hp', () => {
    const p = peakPower(spec.engine);
    expect(p.hp).toBeGreaterThan(230);
    expect(p.hp).toBeLessThan(260);
  });
  it('rev limiter cuts fuel above the limiter', () => {
    const e = new Engine(spec.engine, spec.gearbox);
    e.omega = (spec.engine.limiterRpm + 100) * (Math.PI / 30);
    const t = e.produceTorque(1, DT);
    expect(t).toBeLessThan(0);
  });
});

describe('vehicle physics (Sakura S15, stock)', () => {
  it('settles at its ride height and stays still', () => {
    const { car, world, inp } = makeCar();
    for (let i = 0; i < 240; i++) car.step(DT, inp, world);
    expect(car.velocity.length()).toBeLessThan(0.05);
    expect(car.position.y).toBeGreaterThan(0.4);
    expect(car.position.y).toBeLessThan(0.56);
    for (const w of car.wheels) expect(w.onGround).toBe(true);
  });

  it('accelerates 0-100 km/h in a plausible time (5-8 s)', () => {
    const { car, world, inp } = makeCar();
    inp.throttle = 1;
    let t = 0;
    while (kmh(car.telemetry.speed) < 100 && t < 20) {
      car.step(DT, inp, world);
      t += DT;
    }
    expect(t).toBeGreaterThan(5);
    expect(t).toBeLessThan(8);
    // and keeps going straight
    expect(Math.abs(car.position.x)).toBeLessThan(1);
  });

  it('reaches a plausible top speed (200-280 km/h)', () => {
    const { car, world, inp } = makeCar();
    inp.throttle = 1;
    for (let i = 0; i < 120 * 60; i++) car.step(DT, inp, world);
    expect(kmh(car.telemetry.speed)).toBeGreaterThan(200);
    expect(kmh(car.telemetry.speed)).toBeLessThan(280);
  });

  it('brakes from 100 km/h in a plausible distance (30-48 m) and stays straight', () => {
    const { car, world, inp } = makeCar();
    car.launch(100 / 3.6);
    const z0 = car.position.z;
    inp.brake = 1;
    let t = 0;
    while (car.velocity.length() > 0.3 && t < 10) {
      car.step(DT, inp, world);
      t += DT;
    }
    const d = car.position.z - z0;
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(48);
    expect(Math.abs(car.yaw)).toBeLessThan(0.05);
  });

  it('corners at the grip limit without spinning', () => {
    for (const steer of [0.2, 0.4, 0.6]) {
      const { car, world, inp } = makeCar();
      car.launch(70 / 3.6);
      let maxBeta = 0;
      for (let t = 0; t < 10; t += DT) {
        inp.steer = steer;
        inp.throttle = Math.max(0, Math.min(1, (70 / 3.6 - car.telemetry.speed) * 0.5 + 0.25));
        car.step(DT, inp, world);
        if (t > 2) maxBeta = Math.max(maxBeta, Math.abs(deg(car.telemetry.driftAngle)));
      }
      expect(maxBeta).toBeLessThan(6);
      expect(car.telemetry.forwardSpeed).toBeGreaterThan(10);
      // steering right turns right (negative yaw rate in our Y-up frame)
      expect(car.telemetry.yawRate).toBeLessThan(-0.1);
    }
  });

  it('a scripted controller holds a 25-45 degree drift for 8 seconds', () => {
    const r = driftRun({ target: 32 });
    expect(r.best).toBeGreaterThanOrEqual(8);
  });

  it('handbrake at speed rotates the car (e-brake entry)', () => {
    const { car, world, inp } = makeCar();
    car.launch(60 / 3.6);
    for (let t = 0; t < 0.8; t += DT) {
      inp.steer = -0.6;
      inp.handbrake = 1;
      car.step(DT, inp, world);
    }
    expect(Math.abs(deg(car.telemetry.driftAngle))).toBeGreaterThan(12);
  });

  it('clutch kick breaks the rear loose', () => {
    const { car, world, inp } = makeCar({ transmission: 'manual' });
    car.launch(45 / 3.6);
    inp.steer = -0.7;
    inp.throttle = 1;
    for (let t = 0; t < 0.4; t += DT) car.step(DT, inp, world);
    const before = Math.abs(car.wheels[2].result.slipRatio);
    inp.clutch = 1;
    for (let t = 0; t < 0.3; t += DT) car.step(DT, inp, world);
    inp.clutch = 0;
    let peak = 0;
    for (let t = 0; t < 0.4; t += DT) {
      car.step(DT, inp, world);
      peak = Math.max(peak, car.wheels[2].result.slipRatio);
    }
    expect(peak).toBeGreaterThan(Math.max(0.3, before * 2));
  });

  it('never produces NaN under random inputs, walls, drops and flips', () => {
    const world = new FlatWorld();
    world.walls.addPolyline([[-40, 0, -40], [40, 0, -40], [40, 0, 40], [-40, 0, 40]], 0.5, 1.2, 'concrete', true);
    const { car } = makeCar();
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const inp = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0, shiftUp: false, shiftDown: false };
    for (let i = 0; i < 120 * 90; i++) {
      if (i % 30 === 0) {
        inp.throttle = rnd() < 0.7 ? rnd() : 0;
        inp.brake = rnd() < 0.2 ? rnd() : 0;
        inp.steer = rnd() * 2 - 1;
        inp.handbrake = rnd() < 0.15 ? 1 : 0;
        inp.clutch = rnd() < 0.05 ? 1 : 0;
      }
      if (i === 120 * 30) {
        // drop from height, upside down
        car.position.y = 6;
        car.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
      }
      if (i === 120 * 60) {
        car.velocity.set(80, 0, 0);
      }
      car.step(DT, inp, world);
      const vals = [car.position.x, car.position.y, car.position.z, car.velocity.x, car.velocity.y, car.velocity.z, car.angularVelocity.y, car.engine.rpm, ...car.wheels.map((w) => w.omega)];
      for (const v of vals) expect(Number.isFinite(v)).toBe(true);
    }
    // never falls through the floor or escapes the walls
    expect(car.position.y).toBeGreaterThan(-0.5);
    expect(Math.abs(car.position.x)).toBeLessThan(45);
    expect(Math.abs(car.position.z)).toBeLessThan(45);
  });
});
