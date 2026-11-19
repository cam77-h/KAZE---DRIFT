import { describe, expect, it } from 'vitest';
import { CARS, CAR_ORDER, carPhysics } from '../src/data';
import { Vehicle } from '../src/physics/vehicle';
import { FlatWorld } from '../src/physics/collision';
import { emptyInput, defaultAssists } from '../src/physics/types';
import { peakPower } from '../src/physics/drivetrain';

const DT = 1 / 120;

describe('every car is drivable', () => {
  for (const id of CAR_ORDER) {
    it(`${id}: settles, accelerates plausibly and never NaNs`, () => {
      const world = new FlatWorld();
      const car = new Vehicle(carPhysics(id), defaultAssists());
      car.reset(world, 0, 0, 0);
      const inp = emptyInput();
      for (let i = 0; i < 240; i++) car.step(DT, inp, world);
      expect(car.wheels.every((w) => w.onGround)).toBe(true);
      expect(car.velocity.length()).toBeLessThan(0.1);
      inp.throttle = 1;
      let t = 0;
      while (car.telemetry.speed * 3.6 < 100 && t < 20) {
        car.step(DT, inp, world);
        t += DT;
        expect(Number.isFinite(car.position.x + car.position.z + car.engine.rpm)).toBe(true);
      }
      // from a light 1.6 to an AWD twin-turbo: 0-100 between 3 and 13 s (exact targets: accel.test.ts)
      expect(t).toBeGreaterThan(3);
      expect(t).toBeLessThan(13);
      expect(Math.abs(car.position.x)).toBeLessThan(1.5);
    });
  }

  it('the stable has 8 cars with prices and level gates', () => {
    expect(CAR_ORDER.length).toBe(8);
    expect(CARS.takumi_ae.price).toBe(0);
    expect(CARS.raiden_34.level).toBe(15);
    expect(peakPower(CARS.raiden_34.physics.engine).hp).toBeGreaterThan(peakPower(CARS.takumi_ae.physics.engine).hp * 2);
  });
});
