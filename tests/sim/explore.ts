import { makeCar, DT } from './common';
const kmh = (v: number) => v * 3.6;
{ // 0-100
  const { car, world, inp } = makeCar();
  inp.throttle = 1; let t = 0, t60 = 0;
  while (kmh(car.telemetry.speed) < 100 && t < 20) { car.step(DT, inp, world); t += DT; if (!t60 && kmh(car.telemetry.speed) >= 60) t60 = t; if (Math.round(t*120)%60===0) console.log(t.toFixed(1), kmh(car.telemetry.speed).toFixed(1), 'rpm', car.telemetry.rpm.toFixed(0), 'g', car.telemetry.gear, 'boost', car.telemetry.boost.toFixed(2), 'y', car.position.y.toFixed(3), 'slipR', car.wheels[2].result.slipRatio.toFixed(2)); }
  console.log('0-60', t60.toFixed(2), '0-100', t.toFixed(2));
  let ts=0; while(ts<30){car.step(DT,inp,world); ts+=DT;} console.log('speed after 30s more', kmh(car.telemetry.speed).toFixed(0), 'gear', car.telemetry.gear);
}
{ // braking 100-0
  const { car, world, inp } = makeCar(); car.launch(100/3.6);
  inp.brake = 1; let d = 0; const z0 = car.position.z; let t = 0;
  while (car.velocity.length() > 0.3 && t < 10) { car.step(DT, inp, world); t += DT; }
  console.log('brake dist', (car.position.z - z0).toFixed(1), 'time', t.toFixed(2), 'yaw', car.yaw.toFixed(3));
}
