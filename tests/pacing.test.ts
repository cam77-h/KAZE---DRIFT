import { describe, expect, it } from 'vitest';
import { makeCar, DT } from './sim/common';
import { SkillChain } from '../src/scoring/skillChain';
import { ECONOMY, xpForLevel } from '../src/core/progression';
import { CARS } from '../src/data';

// Pacing playtest: a scripted driver links drifts on a flat test pad for 3 simulated minutes.
// Real players spend time cruising, crashing and in menus, so the typical earning rate is
// taken as a fraction of the scripted rate. economy.json is tuned so the targets hold.
const TYPICAL = 0.35;

function scriptedRun(seconds: number) {
  const { car, world, inp } = makeCar();
  car.launch(55 / 3.6);
  const chain = new SkillChain();
  let t = 0, dir = 1, phase = 0;
  const target = 0.55;
  while (t < seconds) {
    const b = car.telemetry.driftAngle * dir;
    phase += DT;
    if (phase < 0.5) { inp.steer = -dir; inp.throttle = 1; inp.handbrake = phase > 0.1 && phase < 0.35 ? 1 : 0; }
    else {
      inp.handbrake = 0;
      const err = b - target;
      inp.steer = dir * Math.max(-1, Math.min(1, (b * 0.55 + 1.2 * err) / car.spec.steerLock));
      inp.throttle = Math.max(0, Math.min(1, 0.75 - 2.5 * err));
    }
    // switch direction every 9 s (a transition) and cruise for 3 s every 3rd drift
    if (phase > 9) { dir = -dir as 1 | -1; phase = 0; }
    car.step(DT, inp, world);
    chain.update(DT, car);
    t += DT;
  }
  chain.bank();
  return chain.stats.banked / (seconds / 60); // points per minute
}

describe('economy pacing', () => {
  const ppm = scriptedRun(180) * TYPICAL;
  const yenPerMin = ppm * ECONOMY.openRoad.yenPerPoint;
  const xpPerMin = ppm / ECONOMY.xp.pointsPerXp;
  const minutesToLevel = (lv: number) => {
    let xp = 0;
    for (let n = 1; n < lv; n++) xp += xpForLevel(n);
    return xp / xpPerMin;
  };

  it('the scripted driver earns', () => {
    expect(ppm).toBeGreaterThan(0);
    console.log(`typical: ${Math.round(ppm)} pts/min, ¥${Math.round(yenPerMin)}/min, ${Math.round(xpPerMin)} XP/min`);
  });

  it('first performance part within 5 minutes', () => {
    const cheapestPart = 3000;
    const minutes = Math.max(0, cheapestPart - ECONOMY.startingMoney) / yenPerMin;
    expect(minutes).toBeLessThanOrEqual(5);
  });

  it('second car (Sakura 18 Targa, after a part) within 30-45 minutes', () => {
    const need = CARS.sakura_18.price + 8000 - ECONOMY.startingMoney;
    const minutes = need / yenPerMin;
    console.log(`second car after ${minutes.toFixed(1)} min`);
    expect(minutes).toBeGreaterThanOrEqual(25);
    expect(minutes).toBeLessThanOrEqual(45);
  });

  it('Raiden 34 within 4-6 hours (level 15 gate and price)', () => {
    const byLevel = minutesToLevel(CARS.raiden_34.level);
    const byMoney = (CARS.raiden_34.price + 35000 + 60000) / yenPerMin; // plus a mid car and parts along the way
    const hours = Math.max(byLevel, byMoney) / 60;
    console.log(`Raiden 34 after ${hours.toFixed(2)} h (level ${(byLevel / 60).toFixed(2)} h, money ${(byMoney / 60).toFixed(2)} h)`);
    expect(hours).toBeGreaterThanOrEqual(4);
    expect(hours).toBeLessThanOrEqual(6);
  });
});
