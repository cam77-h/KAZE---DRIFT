// Update 5 §5.2: the steering input pipeline, the way sim controller settings work:
// raw → deadzone → gamma → steering speed (rate limit) → filter (smoothing) → speed sensitivity.
// Pure and allocation-free so it is unit-testable.

export type SteerDevice = 'keyboard' | 'gamepad' | 'touch' | 'wheel';
export type ProfileId = 'gamepadGrip' | 'gamepadDrift' | 'keyboard' | 'touch' | 'wheel';

export interface SteerProfile {
  /** 0..0.5 of the axis ignored around centre */
  deadzone: number;
  /** response curve exponent (1 = linear, 2 = gentle centre) */
  gamma: number;
  /** 0..1: how fast the virtual steering wheel may turn toward the input */
  speed: number;
  /** 0..1: how fast it returns when the input is released or reversed (keyboard) */
  returnSpeed: number;
  /** 0..1: smoothing (0 = raw) */
  filter: number;
  /** 0..1: how much max steering is reduced at high speed */
  speedSens: number;
  /** drift profiles: no speed reduction while the car is sliding (full lock for countersteer) */
  fullLockWhenSliding: boolean;
  /** countersteer assist strength 0..1 (§5.3) */
  assist: number;
}

export const DEFAULT_PROFILES: Record<ProfileId, SteerProfile> = {
  gamepadGrip: { deadzone: 0.03, gamma: 2.0, speed: 0.6, returnSpeed: 0.6, filter: 0.5, speedSens: 0.6, fullLockWhenSliding: false, assist: 0.7 },
  gamepadDrift: { deadzone: 0.03, gamma: 1.4, speed: 0.85, returnSpeed: 0.85, filter: 0.2, speedSens: 0.6, fullLockWhenSliding: true, assist: 0.7 },
  keyboard: { deadzone: 0, gamma: 1, speed: 0.7, returnSpeed: 0.9, filter: 0, speedSens: 0.5, fullLockWhenSliding: true, assist: 0.85 },
  touch: { deadzone: 0.04, gamma: 1.3, speed: 0.75, returnSpeed: 0.9, filter: 0.25, speedSens: 0.5, fullLockWhenSliding: true, assist: 0.9 },
  wheel: { deadzone: 0, gamma: 1, speed: 1, returnSpeed: 1, filter: 0, speedSens: 0, fullLockWhenSliding: false, assist: 0 },
};

export function profileFor(device: SteerDevice, driftMode: boolean): ProfileId {
  if (device === 'gamepad') return driftMode ? 'gamepadDrift' : 'gamepadGrip';
  return device;
}

/** deadzone (rescaled so the output still reaches 1) then a gamma curve */
export function shape(x: number, deadzone: number, gamma: number): number {
  const a = Math.abs(x);
  if (a <= deadzone) return 0;
  const n = Math.min(1, (a - deadzone) / (1 - deadzone));
  return Math.sign(x) * Math.pow(n, gamma);
}

/** steering speed 0..1 → max change of the -1..1 steer value per second (lock-to-lock ≈ 2) */
export function rateFor(speed: number): number {
  return 1.5 + speed * 10.5;
}

export class SteerPipeline {
  /** rate-limited "virtual steering wheel" */
  private wheel = 0;
  /** smoothed output */
  value = 0;

  reset(): void {
    this.wheel = 0;
    this.value = 0;
  }

  /**
   * @param raw -1..1 from the device (wheels already map rotation to lock, see wheelSteer)
   * @param speed car speed m/s, @param sliding rear sliding (drift)
   */
  update(raw: number, dt: number, p: SteerProfile, speed: number, sliding: boolean): number {
    const target = shape(raw, p.deadzone, p.gamma);
    const releasing = Math.abs(target) < Math.abs(this.wheel) || Math.sign(target) !== Math.sign(this.wheel);
    const rate = rateFor(releasing ? p.returnSpeed : p.speed);
    this.wheel += Math.max(-rate * dt, Math.min(rate * dt, target - this.wheel));
    const tau = p.filter * 0.12;
    this.value += tau > 0 ? (this.wheel - this.value) * Math.min(1, dt / tau) : this.wheel - this.value;
    // speed sensitivity: less max steering at speed (never below 35%), off while sliding in drift profiles
    const sens = p.fullLockWhenSliding && sliding ? 0 : p.speedSens;
    const max = 1 - sens * 0.65 * Math.min(1, Math.max(0, (speed - 8) / 35));
    return Math.max(-max, Math.min(max, this.value));
  }
}

// ---------------- §5.2 steering wheels (Gamepad API) ----------------

export interface PedalAxis {
  axis: number;
  /** raw value at rest and fully pressed (calibration) */
  rest: number;
  full: number;
}

export interface WheelConfig {
  /** physical wheel rotation lock-to-lock (deg) */
  rotation: number;
  steerAxis: number;
  invertSteer: boolean;
  throttle: PedalAxis;
  brake: PedalAxis;
  clutch: PedalAxis;
}

export function defaultWheel(): WheelConfig {
  // most wheels report pedals as -1..1 with +1 released
  return { rotation: 900, steerAxis: 0, invertSteer: false, throttle: { axis: 2, rest: 1, full: -1 }, brake: { axis: 3, rest: 1, full: -1 }, clutch: { axis: 1, rest: 1, full: -1 } };
}

/** Ids that browsers report for common wheels */
export function looksLikeWheel(id: string): boolean {
  return /wheel|racing|g2[79]|g9[02]0|t[1-5]00|t-gt|tmx|fanatec|csl|dfgt|driving force|simucube|moza|thrustmaster/i.test(id);
}

/**
 * Map the wheel's steering axis to -1..1 of the car's lock: the car's steering-wheel rotation is
 * lockDeg × steering ratio, so 1:1 rotation is kept when the physical wheel turns further.
 */
export function wheelSteer(axisValue: number, cfg: WheelConfig, carLockDeg: number, steerRatio: number): number {
  const v = (cfg.invertSteer ? -1 : 1) * Math.max(-1, Math.min(1, axisValue));
  const wheelDeg = v * (cfg.rotation / 2);
  const carWheelDeg = Math.max(1, carLockDeg * steerRatio);
  return Math.max(-1, Math.min(1, wheelDeg / carWheelDeg));
}

export function pedal(axes: readonly number[], p: PedalAxis): number {
  const raw = axes[p.axis];
  if (raw === undefined) return 0;
  const span = p.full - p.rest;
  if (Math.abs(span) < 1e-6) return 0;
  return Math.max(0, Math.min(1, (raw - p.rest) / span));
}
