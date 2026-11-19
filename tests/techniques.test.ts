import { describe, expect, it } from 'vitest';
import { driftCar, driftSpec } from './sim/drift5';
import { run, TECHNIQUES } from './sim/techniques';

// Update 5 §6: techniques that work from the physics alone (scripted inputs, then the hold bot).
// Each must reach 25° within 2 s of its trigger and be held (20–55°) for 3 s.
// Entries still being tuned are listed in NEXT_STEPS.md; run tests/tools/techniques.ts to see them.
const PASSING: Record<string, string[]> = {
  sakura_s15: ['powerover', 'handbrake', 'clutchkick', 'feint'],
  takumi_ae: ['handbrake', 'clutchkick'],
};

for (const [carId, ids] of Object.entries(PASSING)) {
  describe(`drift techniques: ${carId} (drift set-up)`, () => {
    for (const id of ids) {
      const tq = TECHNIQUES.find((x) => x.id === id)!;
      it(tq.name, () => {
        const { car, world, inp } = driftCar({ spec: driftSpec(carId), speed: tq.speed, gear: tq.gear });
        const r = run(car, world, inp, tq, 6);
        expect(r.reachedAt, `${id} reached 25° after ${r.reachedAt.toFixed(2)} s`).toBeLessThan(2);
        expect(r.hold, `${id} held ${r.hold.toFixed(1)} s`).toBeGreaterThan(3);
      });
    }
  });
}
