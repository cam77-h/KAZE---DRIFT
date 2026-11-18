// Tunes each car towards the Update 4 acceleration targets and writes cars.json. Drag stays at a
// realistic value; the final drive is set so redline in top gear lands on the target top speed
// (short gearing), then the torque scale is chosen by a coarse scan (0-100 is not monotonic in
// torque once a car is traction-limited). Usage: npx tsx tests/tools/tune_accel.ts [carId]
import fs from 'node:fs';
import { CAR_ORDER, carPhysics } from '../../src/data';
import { measure } from '../../src/physics/performance';
const path = 'src/data/cars.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const only = process.argv[2];
type Tg = { zeroTo100: number; zeroTo200: number | null; topSpeed: number };
function specFor(id: string, base: ReturnType<typeof carPhysics>, k: number, drag: number) {
  const spec = carPhysics(id);
  spec.gearbox = { ...base.gearbox };
  spec.engine.torqueCurve = base.engine.torqueCurve.map(([r, t]) => [r, Math.round(t * k)] as [number, number]);
  spec.dragArea = Math.round(drag * 1000) / 1000;
  return spec;
}
function accelError(r: ReturnType<typeof measure>, tg: Tg): number {
  let e = ((r.zeroTo100 - tg.zeroTo100) / tg.zeroTo100) ** 2;
  if (tg.zeroTo200) e += (((r.zeroTo200 ?? 60) - tg.zeroTo200) / tg.zeroTo200) ** 2;
  return e;
}
for (const id of CAR_ORDER) {
  if (only && id !== only) continue;
  const tg: Tg = raw[id].targets;
  const base = carPhysics(id);
  const drag = base.dragArea;
  const ratios = base.gearbox.ratios;
  const vTop = tg.topSpeed / 3.6;
  base.gearbox.final = Math.round(((base.engine.redlineRpm * 1.02 * Math.PI) / 30 * base.wheelRadius) / (ratios[ratios.length - 1] * vTop) * 1000) / 1000;
  let k = 1, best = Infinity;
  for (let kk = 0.8; kk <= 2.0001; kk += 0.05) {
    const r = measure(specFor(id, base, kk, drag), 1.15, 90);
    const e = accelError(r, tg) + 0.5 * ((r.topSpeed - tg.topSpeed) / tg.topSpeed) ** 2;
    if (e < best) { best = e; k = kk; }
  }
  const spec = specFor(id, base, k, drag);
  const r = measure(spec, 1.15, 90);
  console.log(id.padEnd(12), 'k', k.toFixed(2), 'drag', spec.dragArea, '→ 0-100', r.zeroTo100.toFixed(2), '/', tg.zeroTo100, ' 0-200', r.zeroTo200?.toFixed(1), '/', tg.zeroTo200, ' top', r.topSpeed.toFixed(0), '/', tg.topSpeed);
  raw[id].physics.engine = { ...(raw[id].physics.engine ?? {}), torqueCurve: spec.engine.torqueCurve };
  raw[id].physics.gearbox = { ...(raw[id].physics.gearbox ?? {}), final: spec.gearbox.final };
}
// with a second argument, write just this car's result there (lets cars be tuned in parallel)
if (only && process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ id: only, physics: raw[only].physics }));
else fs.writeFileSync(path, JSON.stringify(raw, null, 1) + '\n');
