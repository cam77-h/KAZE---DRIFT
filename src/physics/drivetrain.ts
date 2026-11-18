import type { EngineSpec, GearboxSpec } from './types';

export const RPM_TO_RADS = (2 * Math.PI) / 60;
export const RADS_TO_RPM = 60 / (2 * Math.PI);

/** Linear interpolation into the full-load torque curve. */
export function curveTorque(spec: EngineSpec, rpm: number): number {
  const c = spec.torqueCurve;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const [r0, t0] = c[i - 1];
      const [r1, t1] = c[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return c[c.length - 1][1];
}

export function peakPower(spec: EngineSpec): { hp: number; rpm: number; torque: number } {
  let best = { hp: 0, rpm: 0, torque: 0 };
  for (let rpm = spec.idleRpm; rpm <= spec.limiterRpm; rpm += 50) {
    const t = curveTorque(spec, rpm);
    const hp = (t * rpm) / 7121;
    if (hp > best.hp) best = { hp, rpm, torque: t };
  }
  return best;
}

/** Engine, turbo and gearbox state. The clutch coupling to the wheels lives in Vehicle. */
export class Engine {
  /** crank speed, rad/s */
  omega: number;
  boost = 0;
  /** -1 reverse, 0 neutral, 1..n forward */
  gear = 1;
  shiftTimer = 0;
  clutchLocked = false;
  limiterCut = false;
  /** last delivered engine torque, for audio/HUD */
  torque = 0;
  /** effective throttle after the limiter and shifts */
  load = 0;
  /** blow-off valve event flag, consumed by audio */
  bovEvent = 0;
  private lastThrottle = 0;
  private limiterTime = 0;
  private reverseTimer = 0;

  constructor(
    public spec: EngineSpec,
    public box: GearboxSpec,
  ) {
    this.omega = spec.idleRpm * RPM_TO_RADS;
  }

  get rpm(): number {
    return this.omega * RADS_TO_RPM;
  }

  /** Total ratio from crank to wheel, signed (reverse is negative). 0 in neutral. */
  ratio(gear = this.gear): number {
    if (gear === 0) return 0;
    if (gear < 0) return -this.box.reverse * this.box.final;
    return this.box.ratios[gear - 1] * this.box.final;
  }

  get gearCount(): number {
    return this.box.ratios.length;
  }

  shift(to: number): void {
    const clamped = Math.max(-1, Math.min(this.gearCount, to));
    if (clamped === this.gear) return;
    this.gear = clamped;
    this.shiftTimer = this.box.shiftTime;
    this.clutchLocked = false;
  }

  get shifting(): boolean {
    return this.shiftTimer > 0;
  }

  /** Update turbo and limiter, return the combustion torque minus friction. */
  produceTorque(throttle: number, dt: number): number {
    const s = this.spec;
    const rpm = this.rpm;
    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    // rev limiter with a small hysteresis band → the classic bounce
    if (rpm > s.limiterRpm) this.limiterCut = true;
    else if (rpm < s.limiterRpm - 250) this.limiterCut = false;
    // time spent bouncing near the limiter (the auto box upshifts out of a drift after a while)
    if (rpm > s.limiterRpm - 350) this.limiterTime += dt;
    else this.limiterTime = Math.max(0, this.limiterTime - dt * 2);

    let thr = this.limiterCut ? 0 : throttle;
    if (this.shiftTimer > 0) thr *= 0.15;
    // idle governor
    const idleNeed = Math.min(1, Math.max(0, (s.idleRpm - rpm) / 250));
    thr = Math.max(thr, idleNeed * 0.35);

    // turbo
    let boostFactor = 1;
    if (s.turbo) {
      const tb = s.turbo;
      const avail = smoothstep(tb.spoolRpm, tb.fullBoostRpm, rpm);
      const target = thr * avail;
      const tau = target > this.boost ? tb.lag : tb.lag * 0.35;
      this.boost += (target - this.boost) * Math.min(1, dt / tau);
      if (this.lastThrottle > 0.6 && throttle < 0.2 && this.boost > 0.45) this.bovEvent = this.boost;
      boostFactor = 1 - tb.boostTorqueShare * (1 - this.boost);
    }
    this.lastThrottle = throttle;
    this.load = thr;

    const combustion = thr * curveTorque(s, rpm) * boostFactor;
    const friction = (1 - thr) * s.engineBrake * Math.min(1.2, rpm / s.redlineRpm) + 8;
    this.torque = combustion - friction;
    return this.torque;
  }

  /** How long the limiter has been bouncing (auto box uses this while drifting). */
  get limiterHold(): number {
    return this.limiterTime;
  }

  /**
   * Automatic gearbox. Holds the gear while the car is sliding so a drift does not upshift
   * itself out of the power band, and uses brake-at-standstill for reverse.
   */
  autoShift(dt: number, opts: { throttle: number; brake: number; handbrake: number; speed: number; forwardSpeed: number; sliding: boolean; wheelRpm: number }): void {
    if (this.shiftTimer > 0) return;
    const s = this.spec;
    const g = this.gear;
    // reverse handling
    if (g >= 1 && opts.forwardSpeed < 0.8 && opts.brake > 0.2 && opts.throttle < 0.05) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.3) {
        this.shift(-1);
        this.reverseTimer = 0;
      }
      return;
    }
    if (g === -1) {
      if (opts.forwardSpeed > -0.8 && opts.throttle > 0.2) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.1) {
          this.shift(1);
          this.reverseTimer = 0;
        }
      } else this.reverseTimer = 0;
      return;
    }
    this.reverseTimer = 0;
    if (g === 0) {
      this.shift(1);
      return;
    }
    const rpmFromWheels = opts.wheelRpm;
    const upAt = s.redlineRpm * 0.96;
    if (g < this.gearCount && opts.throttle > 0.3) {
      const wantUp = this.rpm > upAt && rpmFromWheels > upAt * 0.92;
      if (wantUp && (!opts.sliding || this.limiterHold > 0.4)) {
        this.shift(g + 1);
        return;
      }
    }
    // never kick down while the rears are locked by the handbrake or the car is sliding,
    // the wheel speed says nothing about road speed then
    const holdGear = opts.handbrake > 0.1 || (opts.sliding && this.rpm > s.redlineRpm * 0.3);
    if (g > 1 && !holdGear) {
      const lowerRpm = (rpmFromWheels * this.ratio(g - 1)) / this.ratio(g);
      const downAt = opts.throttle > 0.5 ? s.redlineRpm * 0.5 : s.redlineRpm * 0.32;
      if (rpmFromWheels < downAt && lowerRpm < s.redlineRpm * 0.88) this.shift(g - 1);
    }
  }
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
