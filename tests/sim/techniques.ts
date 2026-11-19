// Update 5 §6: the ten drift techniques as scripted inputs. Each entry drives the car until it
// hands over to the hold bot; nothing here touches the physics directly.
import type { Vehicle } from '../../src/physics/vehicle';
import type { DriverInput } from '../../src/physics/types';
import { angleDeg, DT, HoldBot } from './drift5';

export interface Technique {
  id: string;
  name: string;
  /** start speed (km/h) and gear */
  speed: number;
  gear: number;
  /** when the technique itself happens (s): the "within 2 s" clock starts here */
  trigger: number;
  /** entry inputs; return true once the entry is over and the hold bot takes over */
  entry: (t: number, inp: DriverInput, car: Vehicle) => boolean;
}

const set = (inp: DriverInput, steer: number, throttle: number, brake = 0, handbrake = 0, clutch = 0) => {
  inp.steer = steer;
  inp.throttle = throttle;
  inp.brake = brake;
  inp.handbrake = handbrake;
  inp.clutch = clutch;
};

export const TECHNIQUES: Technique[] = [
  { id: 'powerover', name: 'Power-over', speed: 50, gear: 2, trigger: 0.25, entry: (t, i) => { set(i, 0.6, t < 0.25 ? 0.2 : 1); return t > 0.8; } },
  { id: 'handbrake', name: 'Handbrake entry', speed: 55, gear: 2, trigger: 0.05, entry: (t, i) => { const hb = t > 0.05 && t < 0.3; set(i, 0.6, t > 0.3 ? 1 : 0.3, 0, hb ? 1 : 0, hb ? 1 : 0); return t > 0.6; } },
  { id: 'clutchkick', name: 'Clutch kick', speed: 50, gear: 2, trigger: 0.25, entry: (t, i) => { set(i, 0.55, 1, 0, 0, t < 0.25 ? 1 : 0); return t > 0.6; } },
  { id: 'braking', name: 'Braking drift', speed: 75, gear: 3, trigger: 0, entry: (t, i) => { set(i, t < 0.3 ? 1 : 0.6, t > 0.3 ? 1 : 0, t < 0.3 ? 1 : 0, 0, t > 0.25 && t < 0.4 ? 1 : 0); return t > 0.7; } },
  { id: 'feint', name: 'Feint (Scandinavian flick)', speed: 60, gear: 2, trigger: 0.35, entry: (t, i) => { set(i, t < 0.35 ? -0.6 : 0.9, t < 0.35 ? 0.3 : t < 0.55 ? 0 : 1); return t > 0.9; } },
  { id: 'liftoff', name: 'Lift-off oversteer', speed: 85, gear: 3, trigger: 1.0, entry: (t, i) => { set(i, t < 1 ? 0.45 : 1, t < 1 ? 0.85 : t < 1.3 ? 0 : 1); return t > 1.5; } },
];

/** A held drift to the right, then the hold bot for `seconds`. Returns the max angle and the hold time. */
export function run(car: Vehicle, world: Parameters<Vehicle['step']>[2], inp: DriverInput, tq: Technique, seconds = 6) {
  const bot = new HoldBot(35);
  let t = 0, entered = false, startT = 0, reached = -1, hold = 0, best = 0;
  for (let n = 0; n < seconds / DT; n++) {
    if (!entered) entered = tq.entry(t, inp, car);
    else bot.input(car, inp);
    if (entered && !startT) startT = t;
    car.step(DT, inp, world);
    t += DT;
    const a = Math.abs(angleDeg(car));
    if (reached < 0 && a > 25) reached = t;
    if (reached >= 0 && a >= 20 && a <= 55 && car.telemetry.speed > 4) hold += DT;
    else if (reached >= 0) {
      best = Math.max(best, hold);
      hold = 0;
    }
  }
  return { reachedAt: reached < 0 ? Infinity : reached - tq.trigger, hold: Math.max(best, hold) };
}
