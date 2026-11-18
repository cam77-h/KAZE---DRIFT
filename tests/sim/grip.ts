import { makeCar, DT } from './common';
const deg = (r: number) => r * 180 / Math.PI;
for (const steer of [0.15, 0.3, 0.5]) {
  const { car, world, inp } = makeCar();
  car.launch(70 / 3.6);
  let maxB = 0, t = 0;
  while (t < 10) {
    inp.steer = steer;
    // hold ~70 km/h
    inp.throttle = Math.max(0, Math.min(1, (70/3.6 - car.telemetry.speed) * 0.5 + 0.25));
    car.step(DT, inp, world); t += DT;
    if (t > 2) maxB = Math.max(maxB, Math.abs(deg(car.telemetry.driftAngle)));
  }
  const latG = car.telemetry.speed * car.telemetry.yawRate / 9.81;
  console.log('steer', steer, 'maxBeta', maxB.toFixed(2), 'speed', (car.telemetry.speed*3.6).toFixed(1), 'yawRate', car.telemetry.yawRate.toFixed(3), 'latG', latG.toFixed(2), 'roll? y', car.position.y.toFixed(3));
}
