// Shared physics types. The physics layer is pure TypeScript (it only uses three's math
// classes), so it runs headless in vitest and never touches the renderer.

export type SurfaceId =
  | 'asphalt'
  | 'concrete'
  | 'paint'
  | 'kerb'
  | 'gravel'
  | 'dirt'
  | 'grass'
  | 'snow'
  | 'ice';

export type Layout = 'RWD' | 'FWD' | 'AWD';
export type DiffType = 'open' | 'lsd15' | 'lsd2' | 'welded';

export interface TurboSpec {
  /** rpm where boost starts to build */
  spoolRpm: number;
  /** rpm where the turbo can deliver full boost */
  fullBoostRpm: number;
  /** spool time constant in seconds (bigger turbo = more lag) */
  lag: number;
  /** share of peak torque that comes from boost (0..1). With no boost the engine makes (1 - this) of the curve. */
  boostTorqueShare: number;
  /** peak gauge boost in bar, only used for the HUD gauge */
  maxBoostBar: number;
}

export interface EngineSpec {
  name: string;
  idleRpm: number;
  redlineRpm: number;
  limiterRpm: number;
  /** flywheel + crank rotational inertia (kg m^2) */
  inertia: number;
  /** full-load torque curve [rpm, N m] (at full boost for turbo engines) */
  torqueCurve: [number, number][];
  /** engine braking torque at redline with throttle closed (N m) */
  engineBrake: number;
  turbo?: TurboSpec;
  /** audio profile id, see src/audio */
  sound: string;
  cylinders: number;
  /** cooling capacity (1 = stock). Long flat-out runs heat the engine and fade power a little; more cooling, less fade. */
  cooling?: number;
}

export interface GearboxSpec {
  ratios: number[];
  reverse: number;
  final: number;
  /** seconds the clutch is open during a shift */
  shiftTime: number;
  efficiency: number;
}

export interface DiffSpec {
  type: DiffType;
  /** constant locking torque (N m) */
  preload: number;
  /** extra locking torque as a fraction of the input torque, on power */
  accelLock: number;
  /** extra locking torque as a fraction of the input torque, off power */
  decelLock: number;
}

export interface SuspensionSpec {
  /** spring rate per corner (N/m) */
  springFront: number;
  springRear: number;
  /** damper rates (N s/m) */
  bumpFront: number;
  bumpRear: number;
  reboundFront: number;
  reboundRear: number;
  /** anti-roll bar rate (N/m of compression difference) */
  arbFront: number;
  arbRear: number;
  /** suspension travel (m) */
  travel: number;
  /** CG height above ground at rest (m) */
  cgHeight: number;
}

export interface TireCompound {
  id: string;
  name: string;
  /** peak friction coefficient (lateral) */
  mu: number;
  /** longitudinal peak friction relative to lateral */
  longRatio: number;
  /** slip angle at peak lateral force (rad) */
  peakSlipAngle: number;
  /** slip ratio at peak longitudinal force */
  peakSlipRatio: number;
  /** fraction of grip lost once fully sliding (0..1) */
  falloff: number;
  /** magic-formula curvature factor E */
  shapeE: number;
  /** grip loss per unit of load above nominal (load sensitivity) */
  loadSensitivity: number;
  /** rolling resistance coefficient */
  rolling: number;
  /** smoke colour (hex) */
  smoke: string;
}

export interface CarPhysicsSpec {
  id: string;
  mass: number;
  /** CG to front axle and rear axle (m) */
  cgToFront: number;
  cgToRear: number;
  trackFront: number;
  trackRear: number;
  wheelRadius: number;
  wheelInertia: number;
  /** yaw, pitch, roll inertia scale vs a uniform box of the car's size */
  inertiaScale: number;
  length: number;
  width: number;
  height: number;
  layout: Layout;
  /** AWD only: share of drive torque sent to the front axle */
  frontTorqueShare: number;
  engine: EngineSpec;
  gearbox: GearboxSpec;
  clutchTorque: number;
  diff: DiffSpec;
  /** AWD front diff */
  frontDiff?: DiffSpec;
  suspension: SuspensionSpec;
  /** max road-wheel steering angle (rad). Angle kits raise it. */
  steerLock: number;
  /** total brake torque at full pedal (N m), and the share sent to the front */
  brakeTorque: number;
  brakeBias: number;
  handbrakeTorque: number;
  /** drag area Cd*A (m^2) and lift area Cl*A (m^2, positive = downforce), split front/rear */
  dragArea: number;
  downforceFront: number;
  downforceRear: number;
  tireFront: string;
  tireRear: string;
  /** per-axle grip falloff multipliers. Ported from the prototype: front 10%, rear 20% */
  falloffFront: number;
  falloffRear: number;
  /** per-axle grip multipliers (prototype: front 2.0 / rear 2.15 → ratio 1 : 1.075) */
  gripFront: number;
  gripRear: number;
}

export interface DriverInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (full left) .. 1 (full right) */
  steer: number;
  /** 0..1 */
  handbrake: number;
  /** 0..1, 1 = pedal fully pressed (clutch open) */
  clutch: number;
  shiftUp: boolean;
  shiftDown: boolean;
}

export function emptyInput(): DriverInput {
  return { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0, shiftUp: false, shiftDown: false };
}

export interface AssistSettings {
  abs: boolean;
  tcs: boolean;
  stability: boolean;
  /** 0 = off, 1 = full. Counter-steer help + yaw damping while sliding. */
  driftAssist: number;
  /** speed-sensitive steering for keyboard/touch players */
  steeringAssist: boolean;
  /** auto-brake for racing lines (used by race modes in later phases) */
  autoBrake: boolean;
  transmission: 'auto' | 'manual';
  /** a mechanical-damage option, off by default */
  damage: boolean;
}

export function defaultAssists(): AssistSettings {
  return {
    abs: true,
    tcs: false,
    stability: false,
    driftAssist: 0.55,
    steeringAssist: true,
    autoBrake: false,
    transmission: 'auto',
    damage: false,
  };
}

export function expertAssists(): AssistSettings {
  return {
    abs: false,
    tcs: false,
    stability: false,
    driftAssist: 0,
    steeringAssist: false,
    autoBrake: false,
    transmission: 'manual',
    damage: false,
  };
}
