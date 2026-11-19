import { Vehicle, type PhysicsModel } from './vehicle';
import { FlatWorld } from './collision';
import { defaultAssists, emptyInput, type CarPhysicsSpec } from './types';

// Measures a car's straight-line performance by simulation: the same numbers the
// acceleration test checks are the ones shown on the car cards and in the upgrade shop.

export interface Performance {
  zeroTo100: number;
  zeroTo200: number | null;
  topSpeed: number;
}

export const ARCADE_POWER = 1.15;
const DT = 1 / 120;
const cache = new Map<string, Performance>();

export function measure(spec: CarPhysicsSpec, powerScale = ARCADE_POWER, maxSeconds = 70, model: PhysicsModel = 'classic'): Performance {
  const key = JSON.stringify(spec) + powerScale + model;
  const hit = cache.get(key);
  if (hit) return hit;
  const world = new FlatWorld();
  const car = new Vehicle(structuredClone(spec), defaultAssists(), model);
  car.engine.powerScale = powerScale;
  car.reset(world, 0, 0, 0);
  const inp = emptyInput();
  for (let i = 0; i < 60; i++) car.step(DT, inp, world);
  // staged launch: brake + throttle for a second and a half, then the clock starts as the brake comes off
  inp.throttle = 1;
  inp.brake = 1;
  for (let i = 0; i < 180; i++) car.step(DT, inp, world);
  inp.brake = 0;
  let t = 0, t100 = 0, t200: number | null = null, top = 0, lastGain = 0;
  while (t < maxSeconds) {
    car.step(DT, inp, world);
    t += DT;
    const kmh = car.telemetry.speed * 3.6;
    if (!t100 && kmh >= 100) t100 = t;
    if (t200 === null && kmh >= 200) t200 = t;
    if (kmh > top + 0.05) {
      top = kmh;
      lastGain = t;
    }
    // top speed: stop once the car has stopped gaining for a few seconds
    if (t - lastGain > 4 && t > 10) break;
  }
  const r = { zeroTo100: t100 || Infinity, zeroTo200: t200, topSpeed: top };
  cache.set(key, r);
  return r;
}
