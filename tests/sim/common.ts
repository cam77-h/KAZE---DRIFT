import { carPhysics } from '../../src/data';
import { Vehicle } from '../../src/physics/vehicle';
import { FlatWorld } from '../../src/physics/collision';
import { emptyInput, defaultAssists, type CarPhysicsSpec, type AssistSettings } from '../../src/physics/types';

export const DT = 1 / 120;
export function s15(): CarPhysicsSpec {
  return carPhysics('sakura_s15');
}
export function makeCar(assists: Partial<AssistSettings> = {}) {
  const world = new FlatWorld();
  const car = new Vehicle(s15(), { ...defaultAssists(), ...assists });
  car.reset(world, 0, 0, 0);
  // settle on the springs
  const inp = emptyInput();
  for (let i = 0; i < 120; i++) car.step(DT, inp, world);
  return { car, world, inp };
}
