import { describe, expect, it } from 'vitest';
import { CARS, CAR_ORDER, carPhysics } from '../src/data';
import { measure } from '../src/physics/performance';

// Update 4 §1: every car must hit its acceleration targets within ±10% (staged launch, automatic
// box, default assists, arcadePower 1.15). The fully upgraded checks live with the parts system.
const within = (v: number, target: number) => Math.abs(v - target) / target <= 0.1;

for (const model of ['classic', 'sim'] as const)
describe(`acceleration targets (stock, ${model} physics)`, () => {
  for (const id of CAR_ORDER) {
    const tg = (CARS[id] as { targets?: { zeroTo100: number; zeroTo200: number | null; topSpeed: number } }).targets;
    it(`${id}`, () => {
      expect(tg, `${id} has targets`).toBeTruthy();
      const r = measure(carPhysics(id), undefined, undefined, model);
      expect(within(r.zeroTo100, tg!.zeroTo100), `0-100 ${r.zeroTo100.toFixed(2)} s vs ${tg!.zeroTo100}`).toBe(true);
      if (tg!.zeroTo200) expect(within(r.zeroTo200 ?? 99, tg!.zeroTo200), `0-200 ${r.zeroTo200?.toFixed(1)} s vs ${tg!.zeroTo200}`).toBe(true);
      expect(within(r.topSpeed, tg!.topSpeed), `top ${r.topSpeed.toFixed(0)} km/h vs ${tg!.topSpeed}`).toBe(true);
    }, 60_000);
  }
});
