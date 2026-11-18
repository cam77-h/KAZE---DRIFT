import { makeCar, DT } from './common';
const deg = (r: number) => r * 180 / Math.PI;
export function driftRun(opts: { assist?: number; target?: number; verbose?: boolean; kp?: number; kt?: number } = {}) {
  const { car, world, inp } = makeCar({ driftAssist: opts.assist ?? 0.55 });
  car.launch(55 / 3.6);
  const target = (opts.target ?? 35) * Math.PI / 180;
  let t = 0, held = 0, best = 0, minB = 99, maxB = 0;
  const log: string[] = [];
  while (t < 16) {
    const b = car.telemetry.driftAngle;
    if (t < 0.6) { inp.steer = -1; inp.throttle = 1; inp.handbrake = t > 0.15 && t < 0.45 ? 1 : 0; }
    else {
      inp.handbrake = 0;
      const err = b - target; // + = too much angle
      const lock = car.spec.steerLock;
      inp.steer = Math.max(-1, Math.min(1, (b * 0.55 + (opts.kp ?? 1.2) * err) / lock));
      inp.throttle = Math.max(0, Math.min(1, 0.75 - (opts.kt ?? 2.5) * err));
    }
    car.step(DT, inp, world); t += DT;
    const a = deg(car.telemetry.driftAngle);
    if (a >= 25 && a <= 45 && car.telemetry.speed > 5) { held += DT; best = Math.max(best, held); } else held = 0;
    if (t > 2) { minB = Math.min(minB, a); maxB = Math.max(maxB, a); }
    if (opts.verbose && Math.round(t * 120) % 30 === 0) log.push(`${t.toFixed(2)} ang ${a.toFixed(1)} v ${(car.telemetry.speed*3.6).toFixed(0)} thr ${inp.throttle.toFixed(2)} st ${inp.steer.toFixed(2)} rpm ${car.telemetry.rpm.toFixed(0)} g ${car.telemetry.gear} yawr ${car.telemetry.yawRate.toFixed(2)} rs ${car.wheels[2].result.slipRatio.toFixed(2)}`);
  }
  return { best, minB, maxB, log };
}
if (process.argv[1]?.endsWith('drift.ts')) {
  const r = driftRun({ verbose: true, assist: Number(process.argv[2] ?? 0.55) });
  console.log(r.log.join('\n'));
  console.log('best hold', r.best.toFixed(2), 'range', r.minB.toFixed(1), r.maxB.toFixed(1));
}
