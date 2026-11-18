import { CARS, CAR_ORDER, carPhysics } from '../../src/data';
import { measure } from '../../src/physics/performance';
for (const id of CAR_ORDER) {
  const r = measure(carPhysics(id));
  const tg = (CARS[id] as any).targets ?? {};
  console.log(id.padEnd(12), '0-100', r.zeroTo100.toFixed(2), tg.zeroTo100 ?? '', ' 0-200', r.zeroTo200?.toFixed(1) ?? '—', tg.zeroTo200 ?? '', ' top', r.topSpeed.toFixed(0), tg.topSpeed ?? '');
}
