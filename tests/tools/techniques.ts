// Prints every §6 technique entry for a car on the drift set-up: npx tsx tests/tools/techniques.ts [carId]
import { driftCar, driftSpec } from '../sim/drift5';
import { TECHNIQUES, run } from '../sim/techniques';
const id = process.argv[2] ?? 'sakura_s15';
for (const tq of TECHNIQUES) {
  const { car, world, inp } = driftCar({ spec: driftSpec(id), speed: tq.speed, gear: tq.gear });
  const r = run(car, world, inp, tq, 6);
  console.log(tq.id.padEnd(11), 'reached 25° at', r.reachedAt.toFixed(2), 's  hold', r.hold.toFixed(1), 's');
}
