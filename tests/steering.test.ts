import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILES, defaultWheel, looksLikeWheel, pedal, profileFor, shape, SteerPipeline, wheelSteer } from '../src/input/steering';
import { driftCar, HoldBot, longestHold } from './sim/drift5';

// Update 5 §5: steering geometry, the input pipeline and the countersteer assist.

describe('input pipeline (§5.2)', () => {
  it('deadzone then gamma; the output still reaches full lock', () => {
    expect(shape(0.02, 0.03, 1.4)).toBe(0);
    expect(shape(1, 0.03, 1.4)).toBeCloseTo(1);
    expect(shape(0.5, 0.03, 2)).toBeLessThan(0.3);
    expect(shape(-1, 0.03, 2)).toBeCloseTo(-1);
  });
  it('steering speed limits how fast the wheel turns; release returns it', () => {
    const p = new SteerPipeline();
    const prof = DEFAULT_PROFILES.keyboard;
    const v1 = p.update(1, 1 / 60, prof, 0, false);
    expect(v1).toBeGreaterThan(0);
    expect(v1).toBeLessThan(0.3);
    for (let i = 0; i < 60; i++) p.update(1, 1 / 60, prof, 0, false);
    expect(p.value).toBeCloseTo(1);
    for (let i = 0; i < 30; i++) p.update(0, 1 / 60, prof, 0, false);
    expect(Math.abs(p.value)).toBeLessThan(0.01);
  });
  it('speed sensitivity cuts max lock at speed, except while sliding on drift profiles', () => {
    const run = (id: 'gamepadGrip' | 'gamepadDrift', sliding: boolean) => {
      const p = new SteerPipeline();
      let v = 0;
      for (let i = 0; i < 120; i++) v = p.update(1, 1 / 60, DEFAULT_PROFILES[id], 40, sliding);
      return v;
    };
    expect(run('gamepadGrip', false)).toBeLessThan(0.7);
    expect(run('gamepadDrift', true)).toBeCloseTo(1);
  });
  it('profiles: gamepad drift by default in drift modes, assist strengths per device', () => {
    expect(profileFor('gamepad', true)).toBe('gamepadDrift');
    expect(DEFAULT_PROFILES.gamepadDrift.assist).toBe(0.7);
    expect(DEFAULT_PROFILES.keyboard.assist).toBe(0.85);
    expect(DEFAULT_PROFILES.touch.assist).toBe(0.9);
    expect(DEFAULT_PROFILES.wheel.assist).toBe(0);
  });
});

describe('steering wheel (§5.2)', () => {
  // a fake Gamepad API device: a 900° wheel, pedals report +1 released / -1 pressed
  const fake = { id: 'Logitech G29 Driving Force Racing Wheel (Vendor: 046d)', axes: [0.25, 1, -1, 0.5] };
  it('detects common wheels by name', () => {
    expect(looksLikeWheel(fake.id)).toBe(true);
    expect(looksLikeWheel('Xbox Wireless Controller')).toBe(false);
  });
  it('maps rotation 1:1 to the car lock and calibrates pedals', () => {
    const cfg = defaultWheel();
    // 0.25 of 450° = 112.5° at the wheel; a 35° lock × 13 ratio = 455° → about 0.25 of lock
    expect(wheelSteer(fake.axes[0], cfg, 35, 13)).toBeCloseTo(112.5 / 455, 3);
    // a 70° angle kit needs 910° of wheel: a 900° wheel reaches 99% of lock
    expect(wheelSteer(1, cfg, 70, 13)).toBeCloseTo(450 / 910, 3);
    expect(wheelSteer(1, { ...cfg, invertSteer: true }, 35, 13)).toBeCloseTo(-450 / 455, 3);
    expect(pedal(fake.axes, cfg.throttle)).toBe(1); // axis 2 = -1 = fully pressed
    expect(pedal(fake.axes, cfg.clutch)).toBe(0); // axis 1 = +1 = released
    expect(pedal(fake.axes, cfg.brake)).toBeCloseTo(0.25); // axis 3 = 0.5
  });
});

describe('countersteer assist (§5.3)', () => {
  const entry = (car: ReturnType<typeof driftCar>['car'], inp: ReturnType<typeof driftCar>['inp']) => {
    const bot = new HoldBot(35);
    return (t: number) => {
      if (t < 0.6) {
        inp.steer = 0.7;
        inp.throttle = 1;
        inp.handbrake = t > 0.1 && t < 0.25 ? 1 : 0;
      } else bot.input(car, inp);
    };
  };
  it('a gamepad bot (throttle + small stick) holds a ~35° drift for 10 s with the assist on', () => {
    const { car, world, inp } = driftCar({ assist: 0.7 });
    const r = longestHold(car, world, inp, entry(car, inp), 13);
    expect(r.hold).toBeGreaterThan(10);
  });
  it('the same inputs spin out with the assist off', () => {
    const { car, world, inp } = driftCar({ assist: 0 });
    const r = longestHold(car, world, inp, entry(car, inp), 13);
    expect(r.hold).toBeLessThan(3);
  });
});
