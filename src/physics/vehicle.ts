import { Quaternion, Vector3 } from 'three';
import tiresJson from '../data/tires.json';
import { Engine, RADS_TO_RPM, RPM_TO_RADS } from './drivetrain';
import { makeSample, type GroundSample, type PhysicsWorld, type WallHit } from './collision';
import { SURFACES, surfaceGrip } from './surfaces';
import { makeCurve, tireForces, type TireCurve, type TireResult } from './tire';
import { makeTireState, relax, simForces, simFromClassic, thermal, type SimCompound, type SimTireState } from './simTire';
import { defaultAlignment } from './types';
import type { AlignmentSpec, AssistSettings, CarPhysicsSpec, DiffSpec, DriverInput, EngineSpec, SurfaceId, TireCompound } from './types';
import { defaultAssists } from './types';

const TIRES = tiresJson as Record<string, TireCompound>;
export function getTire(id: string): TireCompound {
  return TIRES[id] ?? TIRES.sport;
}
export function tireIds(): string[] {
  return Object.keys(TIRES);
}

const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;

export interface Wheel {
  index: number;
  front: boolean;
  left: boolean;
  /** suspension top mount in body space */
  mount: Vector3;
  radius: number;
  travel: number;
  compression: number;
  prevCompression: number;
  onGround: boolean;
  /** world-space contact point and normal */
  contact: Vector3;
  normal: Vector3;
  surface: SurfaceId;
  load: number;
  omega: number;
  /** accumulated spin angle for rendering */
  spin: number;
  steer: number;
  driven: boolean;
  /** share of drive torque this wheel receives */
  driveShare: number;
  tire: TireCompound;
  curve: TireCurve;
  grip: number;
  spring: number;
  bump: number;
  rebound: number;
  arb: number;
  brakeShare: number;
  result: TireResult;
  /** contact-patch velocities (m/s) */
  vx: number;
  vy: number;
  /** slide intensity 0..1 for smoke / marks / squeal */
  slide: number;
  absFactor: number;
  /** Update 5 sim tire: compound data and persistent state */
  sim: SimCompound;
  st: SimTireState;
  /** static camber (deg) and toe (deg, + = toe-in) from the alignment */
  camberStatic: number;
  toe: number;
  restCompression: number;
}

export type PhysicsModel = 'classic' | 'sim';

export interface ImpactEvent {
  speed: number;
  x: number;
  y: number;
  z: number;
  kind: 'wall' | 'ground';
  material: string;
}

export interface VehicleTelemetry {
  speed: number;
  forwardSpeed: number;
  lateralSpeed: number;
  /** signed angle between heading and velocity (rad). + = sliding to the right */
  driftAngle: number;
  yawRate: number;
  rpm: number;
  gear: number;
  boost: number;
  throttle: number;
  brake: number;
  steer: number;
  rearSlip: number;
  airborne: boolean;
}

/** Engine speed the launch clutch holds at full throttle: on boost for turbo engines, near peak torque otherwise. */
export function launchTargetRpm(e: EngineSpec): number {
  if (e.turbo) return Math.min(e.redlineRpm * 0.75, Math.max(e.turbo.fullBoostRpm * 0.95, e.redlineRpm * 0.55));
  return e.redlineRpm * 0.6;
}

/** Four-wheel rigid-body vehicle with raycast suspension. Fixed-step; call step() at 120 Hz. */
export class Vehicle {
  spec: CarPhysicsSpec;
  assists: AssistSettings;
  engine: Engine;

  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly quaternion = new Quaternion();
  readonly angularVelocity = new Vector3();
  /** previous-step pose for render interpolation */
  readonly prevPosition = new Vector3();
  readonly prevQuaternion = new Quaternion();

  wheels: Wheel[] = [];
  private inertiaBody = new Vector3();
  private invInertiaBody = new Vector3();

  steerAngle = 0;
  private tcsFactor = 1;
  private launching = false;
  private launchFactor = 1;
  private launchClutchPhase = false;
  /** launch control is metering the clutch right now (HUD light) */
  get launchActive(): boolean {
    return this.launchClutchPhase;
  }
  private launchTraction = 0;
  /** staged launch: stopped, brake and throttle held, clutch out, revs held at launch rpm */
  launchStaged = false;
  /** set when a launch gets going (1 after a staged launch, 0.6 otherwise); consumed by the camera */
  launchEvent = 0;
  private launchKicked = false;
  private launchWasStaged = false;
  impacts: ImpactEvent[] = [];
  telemetry: VehicleTelemetry = {
    speed: 0, forwardSpeed: 0, lateralSpeed: 0, driftAngle: 0, yawRate: 0, rpm: 0, gear: 1,
    boost: 0, throttle: 0, brake: 0, steer: 0, rearSlip: 0, airborne: false,
  };
  /** time spent in the current physics session (s) */
  time = 0;
  /** true once the body is in contact with the ground at the roof/sides */
  bodyContact = false;

  // scratch
  private fwd = new Vector3();
  private up = new Vector3();
  private left = new Vector3();
  private force = new Vector3();
  private torque = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private tmp3 = new Vector3();
  private sample: GroundSample = makeSample();
  private hit: WallHit = { depth: 0, nx: 0, nz: 0, px: 0, pz: 0, wall: null as never };
  private probe: TireResult = { fx: 0, fy: 0, slip: 0, slipRatio: 0, slipAngle: 0 };

  /** 'classic' = the Update 1–4 model; 'sim' = Update 5 (360 Hz, sim tires, relaxation, thermal) */
  readonly model: PhysicsModel;
  /** last known-good state for the NaN guard */
  private safe = { p: new Vector3(), q: new Quaternion(), t: -1 };
  nanResets = 0;
  /** clutch temperature (°C), sim only */
  clutchTemp = 60;

  constructor(spec: CarPhysicsSpec, assists: AssistSettings = defaultAssists(), model: PhysicsModel = 'classic') {
    this.spec = spec;
    this.assists = assists;
    this.model = model;
    this.engine = new Engine(spec.engine, spec.gearbox);
    this.rebuild();
  }

  /** Recompute everything derived from the spec (call after parts/tune change). */
  rebuild(): void {
    const s = this.spec;
    this.engine.spec = s.engine;
    this.engine.box = s.gearbox;
    const L = s.length, W = s.width, H = s.height, m = s.mass, k = s.inertiaScale;
    // body axes: x = left (pitch axis), y = up (yaw axis), z = forward (roll axis)
    this.inertiaBody.set((m / 12) * (L * L + H * H) * k, (m / 12) * (L * L + W * W) * k, (m / 12) * (W * W + H * H) * k);
    this.invInertiaBody.set(1 / this.inertiaBody.x, 1 / this.inertiaBody.y, 1 / this.inertiaBody.z);

    const sus = s.suspension;
    const prevOmega = this.wheels.map((w) => w.omega);
    this.wheels = [];
    const axleLoadF = (m * GRAVITY * s.cgToRear) / (s.cgToFront + s.cgToRear) / 2;
    const axleLoadR = (m * GRAVITY * s.cgToFront) / (s.cgToFront + s.cgToRear) / 2;
    const rest = sus.travel;
    const al: AlignmentSpec = { ...defaultAlignment(), ...(s.alignment ?? {}) };
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const left = i % 2 === 0;
      const track = front ? s.trackFront : s.trackRear;
      const spring = front ? sus.springFront : sus.springRear;
      const cornerLoad = front ? axleLoadF : axleLoadR;
      const sag = cornerLoad / spring;
      // mount height so the CG sits at cgHeight above flat ground at rest
      const mountY = -sus.cgHeight + rest - sag + s.wheelRadius;
      const tire = getTire(front ? s.tireFront : s.tireRear);
      const falloff = tire.falloff * (front ? s.falloffFront : s.falloffRear);
      const driven = s.layout === 'AWD' || (s.layout === 'RWD' ? !front : front);
      let share = 0;
      if (driven) share = s.layout === 'AWD' ? (front ? s.frontTorqueShare : 1 - s.frontTorqueShare) / 2 : 0.5;
      this.wheels.push({
        index: i, front, left,
        mount: new Vector3((left ? 1 : -1) * track * 0.5, mountY, front ? s.cgToFront : -s.cgToRear),
        radius: s.wheelRadius,
        travel: rest,
        compression: sag,
        prevCompression: sag,
        onGround: false,
        contact: new Vector3(),
        normal: new Vector3(0, 1, 0),
        surface: 'asphalt',
        load: cornerLoad,
        omega: prevOmega[i] ?? 0,
        spin: 0,
        steer: 0,
        driven,
        driveShare: share,
        tire,
        curve: makeCurve(falloff, tire.shapeE),
        grip: front ? s.gripFront : s.gripRear,
        spring,
        bump: front ? sus.bumpFront : sus.bumpRear,
        rebound: front ? sus.reboundFront : sus.reboundRear,
        arb: front ? sus.arbFront : sus.arbRear,
        brakeShare: (front ? s.brakeBias : 1 - s.brakeBias) / 2,
        result: { fx: 0, fy: 0, slip: 0, slipRatio: 0, slipAngle: 0 },
        vx: 0, vy: 0, slide: 0, absFactor: 1,
        sim: tire.sim ?? simFromClassic(tire),
        st: makeTireState(tire.sim ?? simFromClassic(tire), front ? al.pressureFront : al.pressureRear),
        camberStatic: front ? al.camberFront : al.camberRear,
        toe: front ? al.toeFront : al.toeRear,
        restCompression: sag,
      });
    }
  }

  /** Place the car at rest on the ground at (x, z) facing `yaw` (0 = +Z). */
  reset(world: PhysicsWorld, x: number, z: number, yaw: number): void {
    world.sampleGround(x, z, this.sample);
    this.position.set(x, this.sample.height + this.spec.suspension.cgHeight + 0.02, z);
    this.quaternion.setFromAxisAngle(this.tmp.set(0, 1, 0), yaw);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);
    this.steerAngle = 0;
    this.engine.shift(1);
    this.engine.shiftTimer = 0;
    this.engine.omega = this.spec.engine.idleRpm * (Math.PI / 30);
    this.engine.boost = 0;
    for (const w of this.wheels) {
      w.omega = 0;
      w.compression = w.prevCompression = this.wheels.length ? w.load / w.spring : 0;
    }
  }

  /** Set the car moving straight ahead at `speed` m/s (tests, spawning into events). */
  launch(speed: number): void {
    this.fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.velocity.copy(this.fwd).multiplyScalar(speed);
    for (const w of this.wheels) w.omega = speed / w.radius;
    // pick a sensible gear for the speed
    for (let g = 1; g <= this.engine.gearCount; g++) {
      const rpm = (speed / this.spec.wheelRadius) * this.engine.ratio(g) * RADS_TO_RPM;
      if (rpm < this.spec.engine.redlineRpm * 0.8) {
        this.engine.gear = g;
        break;
      }
    }
    this.engine.omega = Math.max((speed / this.spec.wheelRadius) * this.engine.ratio(), this.spec.engine.idleRpm * (Math.PI / 30));
    this.engine.clutchLocked = true;
  }

  /**
   * Camber relative to the road: static alignment, minus camber gain in bump, plus body roll
   * (rolling toward a wheel tips its top outward). Negative = top toward the car.
   */
  private updateCamber(w: Wheel, left: Vector3): void {
    const travel = w.compression - w.restCompression;
    const gain = ({ ...defaultAlignment(), ...(this.spec.alignment ?? {}) }).camberGain;
    // roll: + when the car's left side drops
    const rollDeg = (Math.asin(Math.max(-1, Math.min(1, left.y))) * -180) / Math.PI;
    const side = w.left ? 1 : -1;
    let camber = w.camberStatic - gain * travel + side * rollDeg;
    // caster: steering tilts the outside front wheel's top inward (more negative camber)
    if (w.front) camber -= side * ({ ...defaultAlignment(), ...(this.spec.alignment ?? {}) }).caster * Math.sin(w.steer);
    w.st.camberDeg = camber;
    // a left wheel with negative camber leans its top to the right (toward the car)
    w.st.leanRight = (side * -camber * Math.PI) / 180;
  }

  /** last computed free-steering angle (rad, + = right), for the telemetry overlay */
  freeSteerAngle = 0;

  /** steer angle that points the front wheels along the front axle's velocity (rad, + = right) */
  private freeSteer(fwd: Vector3, left: Vector3, up: Vector3): number {
    const yaw = this.angularVelocity.dot(up);
    // front axle velocity = body velocity + yaw × r (r = forward × cgToFront): yaw left (+) moves the nose left
    const vf = this.velocity.dot(fwd);
    const vl = this.velocity.dot(left) + yaw * this.spec.cgToFront;
    return Math.atan2(-vl, Math.max(0.5, vf));
  }

  /** 0..1: how much the rear is sliding (rear slip angle 6° → 10°) */
  private slideBlend(fwd: Vector3, left: Vector3, up: Vector3, speed: number): number {
    if (speed < 3) return 0;
    const yaw = this.angularVelocity.dot(up);
    const vf = this.velocity.dot(fwd);
    const vl = this.velocity.dot(left) - yaw * this.spec.cgToRear;
    const rearSlip = Math.abs(Math.atan2(vl, Math.max(0.5, Math.abs(vf))));
    return Math.max(0, Math.min(1, (rearSlip - 0.105) / 0.07));
  }

  get yaw(): number {
    this.fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    return Math.atan2(this.fwd.x, this.fwd.z);
  }

  step(dt: number, rawInput: DriverInput, world: PhysicsWorld): void {
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);
    if (this.model === 'classic') return this.stepOnce(dt, rawInput, world);
    // Update 5 §1: the sim model runs at 360 Hz (3 sub-steps per 120 Hz tick)
    const n = this.substeps;
    const shiftUp = rawInput.shiftUp, shiftDown = rawInput.shiftDown;
    for (let i = 0; i < n; i++) {
      this.stepOnce(dt / n, rawInput, world);
      rawInput.shiftUp = rawInput.shiftDown = false;
      if (!this.guard()) break;
    }
    rawInput.shiftUp = shiftUp;
    rawInput.shiftDown = shiftDown;
  }

  /** sub-steps per call in sim mode (3 → 360 Hz at a 120 Hz tick; 2 on the Low preset) */
  substeps = 3;

  /** NaN/infinity guard: restore the last safe pose and stop the car instead of exploding. */
  private guard(): boolean {
    const ok = Number.isFinite(this.position.x + this.position.y + this.position.z + this.velocity.x + this.velocity.y + this.velocity.z + this.angularVelocity.x + this.angularVelocity.y + this.angularVelocity.z + this.quaternion.w + this.engine.omega)
      && this.wheels.every((w) => Number.isFinite(w.omega + w.st.alpha + w.st.tSurf));
    if (ok) {
      if (this.time - this.safe.t > 0.25) {
        this.safe.p.copy(this.position);
        this.safe.q.copy(this.quaternion);
        this.safe.t = this.time;
      }
      return true;
    }
    this.nanResets++;
    console.warn(`[physics] non-finite state at t=${this.time.toFixed(2)}s, restoring the last safe pose`);
    this.position.copy(this.safe.p);
    this.quaternion.copy(this.safe.q);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.engine.omega = this.spec.engine.idleRpm * (Math.PI / 30);
    for (const w of this.wheels) {
      w.omega = 0;
      w.st.alpha = 0;
      if (!Number.isFinite(w.st.tSurf)) w.st.tSurf = w.st.tCore = 40;
    }
    return false;
  }

  private stepOnce(dt: number, rawInput: DriverInput, world: PhysicsWorld): void {
    const s = this.spec;
    const a = this.assists;
    const eng = this.engine;
    const sim = this.model === 'sim';
    this.time += dt;

    const fwd = this.fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    const up = this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    const left = this.left.set(1, 0, 0).applyQuaternion(this.quaternion);

    const vF = this.velocity.dot(fwd);
    const vL = this.velocity.dot(left);
    const speed = this.velocity.length();
    const vRight = -vL;
    const driftAngle = speed > 2 ? Math.atan2(vRight, Math.abs(vF)) : 0;
    const yawRate = this.angularVelocity.dot(up);

    // ---- pedals, gear logic ----
    let throttle = clamp01(rawInput.throttle);
    let brake = clamp01(rawInput.brake);
    const reverseSwap = a.transmission === 'auto' && eng.gear === -1;
    if (reverseSwap) {
      const t = throttle;
      throttle = brake;
      brake = t;
    }
    let rearSlipAngle = 0;
    for (const w of this.wheels) if (!w.front) rearSlipAngle = Math.max(rearSlipAngle, Math.abs(w.result.slipAngle));
    const sliding = rearSlipAngle > 0.22 && speed > 5;

    // driven wheel speed → rpm the engine would see with the clutch locked
    let drivenOmega = 0;
    let shareSum = 0;
    for (const w of this.wheels) if (w.driven) { drivenOmega += w.omega * w.driveShare; shareSum += w.driveShare; }
    drivenOmega = shareSum > 0 ? drivenOmega / shareSum : 0;
    const wheelRpm = Math.abs(drivenOmega * eng.ratio()) * RADS_TO_RPM;

    const roadRpm = (Math.abs(vF) / s.wheelRadius) * Math.abs(eng.ratio()) * RADS_TO_RPM;
    if (a.transmission === 'auto') {
      eng.autoShift(dt, { throttle: rawInput.throttle, brake: rawInput.brake, handbrake: rawInput.handbrake, speed, forwardSpeed: vF, sliding, wheelRpm, roadRpm });
    } else {
      if (rawInput.shiftUp) eng.shift(eng.gear === -1 ? 1 : eng.gear + 1);
      if (rawInput.shiftDown) {
        if (eng.gear > 1) eng.shift(eng.gear - 1);
        else if (eng.gear === 1 && vF < 2) eng.shift(-1);
      }
    }

    // traction control
    // TCS steps aside while drifting or with drift assist on, so it never chokes a slide
    if (a.tcs && a.driftAssist === 0 && !sliding) {
      let maxSlip = 0;
      for (const w of this.wheels) if (w.driven && w.onGround) maxSlip = Math.max(maxSlip, w.result.slipRatio);
      if (maxSlip > 0.16 && speed > 1.5) this.tcsFactor = Math.max(0.1, this.tcsFactor - dt * 6);
      else this.tcsFactor = Math.min(1, this.tcsFactor + dt * 3);
      throttle *= this.tcsFactor;
    }
    // launch control: from a standstill at full throttle the clutch, not the throttle, meters the
    // drive: the engine sits on its launch rpm (on boost) and the clutch passes only what the driven
    // tires can take. Once the clutch is in, a wheelspin limiter carries on through the first two
    // gears. Steering, the handbrake, lifting or a slide hand control back to the driver.
    if (speed < 0.5 && throttle > 0.9 && eng.gear === 1 && (a.tcs || a.driftAssist > 0)) {
      if (!this.launching) { this.launchKicked = false; this.launchWasStaged = false; }
      this.launching = true;
      this.launchFactor = 0.85;
      this.launchTraction = 0;
    }
    if (this.launching && (speed > 30 || eng.gear > 2 || eng.gear < 1 || Math.abs(rawInput.steer) > 0.25 || rawInput.handbrake > 0.1 || sliding || throttle < 0.5)) this.launching = false;
    this.launchClutchPhase = this.launching && eng.gear === 1 && !(roadRpm > launchTargetRpm(s.engine) * 0.7 && wheelRpm > eng.rpm - 120);
    if (this.launching) {
      let maxSlip = 0;
      for (const w of this.wheels) if (w.driven && w.onGround) maxSlip = Math.max(maxSlip, w.result.slipRatio);
      if (this.launchClutchPhase) {
        if (maxSlip > 0.13) this.launchFactor = Math.max(0.55, this.launchFactor - dt * 4);
        else if (maxSlip < 0.08) this.launchFactor = Math.min(0.95, this.launchFactor + dt * 0.3);
      } else {
        if (maxSlip > 0.15) this.tcsFactor = Math.max(0.45, this.tcsFactor - dt * 4);
        else this.tcsFactor = Math.min(1, this.tcsFactor + dt * 3);
        throttle *= this.tcsFactor;
      }
    } else this.launchFactor = 1;
    // stability control: cut throttle when the slide gets big
    if (a.stability && Math.abs(driftAngle) > 0.15 && speed > 6) throttle *= 0.3;

    // ---- steering ----
    let steerIn = Math.max(-1, Math.min(1, rawInput.steer));
    let lockFactor = 1;
    if (a.steeringAssist) {
      const counter = Math.sign(steerIn) === Math.sign(driftAngle) && Math.abs(driftAngle) > 0.08;
      if (!counter) lockFactor = 1 - Math.min(speed, 60) / 160;
    }
    let steerTarget = steerIn * s.steerLock * lockFactor;
    if (sim) {
      // §5.3 countersteer assist: the "free steering" angle points the front wheels along the front
      // axle's velocity (zero front slip), like a wheel spinning freely through the driver's hands.
      // Stick centred = the car holds its slide; the stick adds or removes angle from there.
      const k = (a.countersteer ?? 0) * this.slideBlend(fwd, left, up, speed);
      if (k > 0 && vF > 0) {
        const lock = s.steerLock;
        const free = Math.max(-lock, Math.min(lock, this.freeSteer(fwd, left, up)));
        const toward = steerIn >= 0 ? lock - free : lock + free;
        const assisted = free + steerIn * toward;
        steerTarget = steerIn * lock * (1 - k) + assisted * k;
      }
      this.freeSteerAngle = this.freeSteer(fwd, left, up);
    } else if (a.driftAssist > 0 && speed > 4 && vF > 0) {
      // counter-steer help: point the front wheels along the direction of travel
      const help = a.driftAssist * 0.75 * driftAngle;
      steerTarget = Math.max(-s.steerLock, Math.min(s.steerLock, steerTarget + help * (1 - Math.abs(steerIn) * 0.5)));
    }
    const steerRate = sim ? 9.0 : 5.0;
    this.steerAngle += clamp(steerTarget - this.steerAngle, -steerRate * dt, steerRate * dt);
    if (sim) {
      // adjustable Ackermann: 0 = parallel, 1 = full geometric Ackermann for the wheelbase and track
      const ackSet = ({ ...defaultAlignment(), ...(s.alignment ?? {}) }).ackermann;
      const L = s.cgToFront + s.cgToRear, d = this.steerAngle;
      const R = Math.abs(d) > 1e-4 ? L / Math.tan(Math.abs(d)) : 1e9;
      for (const w of this.wheels) {
        if (!w.front) { w.steer = 0; continue; }
        const inner = (d > 0 && !w.left) || (d < 0 && w.left);
        const geo = Math.atan(L / Math.max(0.5, R + (inner ? -1 : 1) * s.trackFront * 0.5));
        w.steer = Math.sign(d) * (Math.abs(d) * (1 - ackSet) + geo * ackSet);
      }
    } else {
      // Ackermann: inner wheel turns a little more
      const ack = 0.12;
      for (const w of this.wheels) {
        if (!w.front) { w.steer = 0; continue; }
        const inner = (this.steerAngle > 0 && !w.left) || (this.steerAngle < 0 && w.left);
        w.steer = this.steerAngle * (inner ? 1 + ack : 1 - ack * 0.5);
      }
    }
    if (sim) {
      // static toe: + = toe-in (front of the wheel points toward the car's centre line)
      for (const w of this.wheels) w.steer += ((w.left ? -1 : 1) * w.toe * Math.PI) / 180;
    }

    // ---- clutch / drive torque ----
    const G = eng.ratio();
    const idle = s.engine.idleRpm;
    const target = launchTargetRpm(s.engine);
    // staged launch (auto box): stopped with brake and throttle both held → clutch out, revs held at
    // the launch rpm so turbo cars build boost. Releasing the brake drops the clutch.
    this.launchStaged = a.transmission === 'auto' && eng.gear >= 1 && speed < 0.6 && rawInput.brake > 0.5 && rawInput.throttle > 0.5;
    eng.antiLag = this.launchStaged;
    if (this.launchStaged) {
      throttle = clamp01(1 - (eng.rpm - target) / 400);
      this.launchWasStaged = true;
    }
    if (this.launching && !this.launchKicked && !this.launchStaged && speed > 0.3) {
      this.launchKicked = true;
      this.launchEvent = this.launchWasStaged ? 1 : 0.6;
    }
    const launchRpm = idle + 700 + throttle * Math.max(0, target - idle - 700);
    // automatic launch clutch: slips to hold the engine near launchRpm until the wheels catch up
    const rpmTerm = clamp01((eng.rpm - idle) / (launchRpm - idle));
    const wheelStart = idle * 1.1 + Math.max(0, launchRpm - idle * 1.1 - 1500) * throttle;
    const autoClutch = Math.max(smooth01((wheelRpm - wheelStart) / 1500), rpmTerm * rpmTerm * rpmTerm);
    let engagement = (1 - clamp01(rawInput.clutch)) * autoClutch;
    if (eng.shifting || G === 0 || this.launchStaged) engagement = 0;
    // sim: a slipping clutch heats up and fades above ~250 °C
    const clutchFade = sim ? Math.max(0.6, 1 - Math.max(0, this.clutchTemp - 250) / 400) : 1;
    let capacity = engagement * s.clutchTorque * clutchFade;
    const launchClutch = this.launchClutchPhase && !this.launchStaged && G !== 0 && !eng.shifting;
    // soft two-step limiter: full throttle up to the launch rpm, fading out over the next 400 rpm
    if (launchClutch) throttle = clamp01(1 - (eng.rpm - target) / 400);
    const Te = eng.produceTorque(throttle, dt);
    if (launchClutch) {
      // traction-limited clutch: what the driven tires can push, fed back through the gearing,
      // and never more than holds the engine on its launch rpm
      let traction = 0;
      for (const w of this.wheels) if (w.driven && w.onGround) traction += w.tire.mu * w.tire.longRatio * w.grip * surfaceGrip(w.surface, world.wetness) * w.load;
      this.launchTraction = this.launchTraction > 0 ? this.launchTraction + (traction - this.launchTraction) * Math.min(1, dt / 0.25) : traction;
      const limit = (this.launchTraction * s.wheelRadius * this.launchFactor) / (Math.abs(G) * s.gearbox.efficiency);
      const hold = Math.max(0, Te + ((eng.omega - target * RPM_TO_RADS) * s.engine.inertia) / 0.05);
      capacity = Math.min(s.clutchTorque, limit, hold);
    }
    const Ie = s.engine.inertia;
    const eff = s.gearbox.efficiency;

    let mode: 'free' | 'locked' | 'slip' = 'free';
    let clutchTorque = 0;
    if (capacity > 1 && G !== 0) {
      if (eng.clutchLocked && Math.abs(Te) <= capacity * 1.02 && !launchClutch) mode = 'locked';
      else {
        mode = 'slip';
        const slipW = eng.omega - drivenOmega * G;
        clutchTorque = capacity * clamp(slipW / 3, -1, 1);
      }
    } else eng.clutchLocked = false;

    // ---- suspension ----
    let groundedWheels = 0;
    for (const w of this.wheels) {
      const mountW = this.tmp.copy(w.mount).applyQuaternion(this.quaternion).add(this.position);
      // ray along -up from the mount
      const dx = -up.x, dy = -up.y, dz = -up.z;
      const maxLen = w.travel + w.radius;
      let t = 0;
      let px = mountW.x, pz = mountW.z;
      let hitOk = false;
      for (let it = 0; it < 3; it++) {
        world.sampleGround(px, pz, this.sample);
        const n = this.sample;
        // ray/plane through the sampled point with the sampled normal
        const denom = n.nx * dx + n.ny * dy + n.nz * dz;
        if (denom > -0.2) break;
        const qx = px, qy = n.height, qz = pz;
        t = (n.nx * (qx - mountW.x) + n.ny * (qy - mountW.y) + n.nz * (qz - mountW.z)) / denom;
        px = mountW.x + dx * t;
        pz = mountW.z + dz * t;
        hitOk = true;
      }
      w.prevCompression = w.compression;
      if (hitOk && t < maxLen && t > -0.5) {
        w.onGround = true;
        groundedWheels++;
        w.compression = Math.min(w.travel + 0.05, w.travel - (t - w.radius));
        w.contact.set(mountW.x + dx * t, mountW.y + dy * t, mountW.z + dz * t);
        w.normal.set(this.sample.nx, this.sample.ny, this.sample.nz);
        w.surface = this.sample.surface;
        const bump = SURFACES[w.surface].bump;
        if (bump > 0 && speed > 1) w.compression += bump * Math.sin(this.time * 61 + w.index * 1.7) * Math.min(1, speed / 15);
      } else {
        w.onGround = false;
        w.compression = Math.max(0, w.compression - dt * 2);
        w.contact.set(mountW.x + dx * maxLen, mountW.y + dy * maxLen, mountW.z + dz * maxLen);
      }
    }
    // spring + damper + anti-roll bars
    const loads = LOADS;
    for (const w of this.wheels) {
      if (!w.onGround) { loads[w.index] = 0; continue; }
      const c = Math.max(0, w.compression);
      const cv = (w.compression - w.prevCompression) / dt;
      let f = w.spring * c + (cv > 0 ? w.bump : w.rebound) * cv;
      const stop = w.travel * 0.9;
      if (c > stop) f += w.spring * 8 * (c - stop) + w.bump * 2 * Math.max(0, cv);
      loads[w.index] = f;
    }
    for (let axle = 0; axle < 2; axle++) {
      const l = this.wheels[axle * 2];
      const r = this.wheels[axle * 2 + 1];
      const diff = (l.onGround ? l.compression : 0) - (r.onGround ? r.compression : 0);
      const f = l.arb * diff;
      if (l.onGround) loads[l.index] += f;
      if (r.onGround) loads[r.index] -= f;
    }

    this.force.set(0, -s.mass * GRAVITY, 0);
    this.torque.set(0, 0, 0);

    // ---- tires (implicit wheel spin) ----
    const wet = world.wetness;
    const rearDrive: Wheel[] = [];
    const frontDrive: Wheel[] = [];
    for (const w of this.wheels) {
      const load = Math.max(0, loads[w.index]);
      w.load = load;
      // wheel heading on the ground plane
      const sinS = Math.sin(w.steer), cosS = Math.cos(w.steer);
      // body-space wheel forward: steering right (+) rotates the nose toward -X (right)
      const wf = this.tmp.set(-sinS, 0, cosS).applyQuaternion(this.quaternion);
      const n = w.normal;
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const wr = this.tmp2.crossVectors(wf, n); // right
      // contact velocity
      const rx = w.contact.x - this.position.x, ry = w.contact.y - this.position.y, rz = w.contact.z - this.position.z;
      const av = this.angularVelocity;
      const cvx = this.velocity.x + (av.y * rz - av.z * ry);
      const cvy = this.velocity.y + (av.z * rx - av.x * rz);
      const cvz = this.velocity.z + (av.x * ry - av.y * rx);
      w.vx = cvx * wf.x + cvy * wf.y + cvz * wf.z;
      w.vy = cvx * wr.x + cvy * wr.y + cvz * wr.z;

      const grip = surfaceGrip(w.surface, wet) * w.grip;
      // drive torque & effective inertia
      let Td = 0;
      let I = s.wheelInertia;
      if (w.driven && G !== 0) {
        if (mode === 'locked') {
          Td = Te * G * eff * w.driveShare;
          I += Ie * G * G * w.driveShare;
        } else if (mode === 'slip') {
          Td = clutchTorque * G * eff * w.driveShare;
        }
      }
      // brakes (+ ABS)
      let Tb = brake * s.brakeTorque * w.brakeShare;
      if (a.abs && w.onGround && Math.abs(w.vx) > 2.5) {
        if (w.result.slipRatio < -0.13) w.absFactor = Math.max(0.25, w.absFactor - dt * 18);
        else w.absFactor = Math.min(1, w.absFactor + dt * 10);
        Tb *= w.absFactor;
      } else w.absFactor = 1;
      if (!w.front) Tb += clamp01(rawInput.handbrake) * s.handbrakeTorque * 0.5;

      const r = w.radius;
      let omega = w.omega;
      if (w.onGround && load > 0) {
        const eps = 0.05;
        if (sim) {
          relax(w.sim, w.st, w.vx, w.vy, load, dt);
          this.updateCamber(w, left);
          simForces(w.sim, w.st, w.vx, w.vy, omega * r, load, grip, w.result);
          simForces(w.sim, w.st, w.vx, w.vy, (omega + eps) * r, load, grip, this.probe);
        } else {
          tireForces(w.tire, w.curve, w.vx, w.vy, omega * r, load, grip, w.result);
          tireForces(w.tire, w.curve, w.vx, w.vy, (omega + eps) * r, load, grip, this.probe);
        }
        const slope = Math.max(0, (this.probe.fx - w.result.fx) / eps);
        const denom = I + dt * r * slope;
        omega = omega + (dt * (Td - r * w.result.fx)) / denom;
        const db = (dt * Tb) / denom;
        if (Math.abs(omega) <= db) omega = 0;
        else omega -= Math.sign(omega) * db;
      } else {
        omega += (dt * Td) / I;
        const db = (dt * Tb) / I;
        if (Math.abs(omega) <= db) omega = 0;
        else omega -= Math.sign(omega) * db;
        omega *= 1 - dt * 0.3;
      }
      w.omega = omega;
      if (w.driven) (w.front ? frontDrive : rearDrive).push(w);
    }

    // differentials: transfer torque from the faster to the slower wheel of each driven axle
    const tin = mode === 'locked' ? Te * G : mode === 'slip' ? clutchTorque * G : 0;
    if (rearDrive.length === 2) this.applyDiff(rearDrive[0], rearDrive[1], s.diff, tin, dt, mode === 'locked' ? Ie * G * G * 0.5 : 0);
    if (frontDrive.length === 2) this.applyDiff(frontDrive[0], frontDrive[1], s.frontDiff ?? { type: 'open', preload: 0, accelLock: 0, decelLock: 0 }, tin, dt, mode === 'locked' ? Ie * G * G * 0.5 : 0);

    // engine speed
    let newDriven = 0;
    for (const w of this.wheels) if (w.driven) newDriven += w.omega * w.driveShare;
    newDriven = shareSum > 0 ? newDriven / shareSum : 0;
    const prevOmega = eng.omega;
    if (mode === 'locked') {
      eng.omega = newDriven * G;
      const need = Te - (Ie * (eng.omega - prevOmega)) / dt;
      if (Math.abs(need) > capacity * 1.05) eng.clutchLocked = false;
    } else if (mode === 'slip') {
      if (sim) this.clutchTemp += (Math.abs(clutchTorque * (eng.omega - drivenOmega * G)) * dt) / 2500;
      const before = eng.omega - drivenOmega * G;
      eng.omega += ((Te - clutchTorque) / Ie) * dt;
      const after = eng.omega - newDriven * G;
      if ((Math.sign(before) !== Math.sign(after) || Math.abs(after) < 1.5) && Math.abs(Te) < capacity && !launchClutch) {
        eng.clutchLocked = true;
        eng.omega = newDriven * G;
      }
    } else {
      eng.omega += (Te / Ie) * dt;
    }
    // the gearbox synchronises while a shift is in progress: revs fall (or blip up) to the new gear
    if (eng.shifting && G !== 0 && mode === 'free') {
      const sync = Math.abs(newDriven * G);
      eng.omega += (sync - eng.omega) * Math.min(1, dt / Math.max(0.02, s.gearbox.shiftTime * 0.4));
    }
    eng.omega = Math.max(eng.omega, 300 * (Math.PI / 30));
    if (sim) this.clutchTemp += (60 - this.clutchTemp) * Math.min(1, dt * 0.05);

    // ---- final tire forces with the updated wheel speeds ----
    let rearSlide = 0;
    for (const w of this.wheels) {
      w.spin += w.omega * dt;
      if (!w.onGround || w.load <= 0) { w.result.fx = 0; w.result.fy = 0; w.slide = 0; continue; }
      const grip = surfaceGrip(w.surface, wet) * w.grip;
      if (sim) {
        simForces(w.sim, w.st, w.vx, w.vy, w.omega * w.radius, w.load, grip, w.result);
        // sliding power heats the tread: |slip velocity| × |force|
        const svx = w.omega * w.radius - w.vx, svy = w.vy;
        thermal(w.sim, w.st, Math.hypot(svx * w.result.fx, svy * w.result.fy), Math.abs(w.vx), w.load, dt);
      } else tireForces(w.tire, w.curve, w.vx, w.vy, w.omega * w.radius, w.load, grip, w.result);
      // rolling resistance + surface drag (sand, grass)
      const roll = (w.tire.rolling + SURFACES[w.surface].drag) * w.load * Math.tanh(w.vx / 0.6);
      const fx = w.result.fx - roll;
      const fy = w.result.fy;
      const sinS = Math.sin(w.steer), cosS = Math.cos(w.steer);
      const wf = this.tmp.set(-sinS, 0, cosS).applyQuaternion(this.quaternion);
      wf.addScaledVector(w.normal, -wf.dot(w.normal)).normalize();
      const wr = this.tmp2.crossVectors(wf, w.normal);
      // total contact force: suspension along the normal + tire forces in the plane
      const F = this.tmp3.set(0, 0, 0)
        .addScaledVector(up, w.load)
        .addScaledVector(wf, fx)
        .addScaledVector(wr, fy);
      this.force.add(F);
      // apply tire forces slightly above the contact patch (roll centre) to tame rollovers
      const ax = w.contact.x + up.x * 0.12 - this.position.x;
      const ay = w.contact.y + up.y * 0.12 - this.position.y;
      const az = w.contact.z + up.z * 0.12 - this.position.z;
      this.torque.x += ay * F.z - az * F.y;
      this.torque.y += az * F.x - ax * F.z;
      this.torque.z += ax * F.y - ay * F.x;
      const sl = Math.max(0, Math.min(1, (w.result.slip - 1.1) / 2.5));
      const spinSl = Math.max(0, Math.min(1, (Math.abs(w.result.slipRatio) - 0.25) / 0.8));
      w.slide = Math.max(sl, spinSl) * Math.min(1, speed / 3 + Math.abs(w.omega * w.radius) / 6);
      if (!w.front) rearSlide = Math.max(rearSlide, w.slide);
    }

    // ---- aero ----
    const q = 0.5 * AIR_DENSITY * speed;
    this.force.addScaledVector(this.velocity, -q * s.dragArea);
    const v2 = 0.5 * AIR_DENSITY * speed * speed;
    if (groundedWheels > 0) {
      // sim: a car without aero makes a little lift at speed
      const lift = sim ? Math.max(0, 0.12 - (s.downforceFront + s.downforceRear)) * 0.5 : 0;
      const dfF = v2 * (s.downforceFront - lift);
      const dfR = v2 * (s.downforceRear - lift);
      this.force.addScaledVector(up, -(dfF + dfR));
      // pitch moment from the front/rear split
      this.tmp.copy(left).multiplyScalar(dfF * s.cgToFront - dfR * s.cgToRear);
      this.torque.add(this.tmp);
    }

    // ---- drift assist yaw damping (ported from the prototype) ----
    if (a.driftAssist > 0 && groundedWheels >= 3) {
      const slideAmt = Math.min(1, rearSlipAngle / 0.4);
      const Iyaw = this.inertiaBody.y;
      this.torque.addScaledVector(up, -yawRate * Iyaw * a.driftAssist * 2.2 * slideAmt);
    }
    if (a.stability && groundedWheels >= 3 && Math.abs(driftAngle) > 0.12 && speed > 6) {
      this.torque.addScaledVector(up, -yawRate * this.inertiaBody.y * 1.6);
    }

    // ---- integrate ----
    this.velocity.addScaledVector(this.force, dt / s.mass);
    // world inverse inertia: R * diag(invI) * R^T applied to torque
    const tb = this.tmp.copy(this.torque).applyQuaternion(INV.copy(this.quaternion).invert());
    tb.x *= this.invInertiaBody.x;
    tb.y *= this.invInertiaBody.y;
    tb.z *= this.invInertiaBody.z;
    tb.applyQuaternion(this.quaternion);
    this.angularVelocity.addScaledVector(tb, dt);
    // gentle angular damping (air, bushings)
    this.angularVelocity.multiplyScalar(1 - dt * 0.15);

    // low-speed settle: stop creeping when stationary and nothing is pushing
    if (speed < 0.25 && throttle < 0.02 && groundedWheels === 4 && (brake > 0.1 || rawInput.handbrake > 0.1 || eng.gear !== -1)) {
      this.velocity.x *= 0.9;
      this.velocity.z *= 0.9;
    }

    this.position.addScaledVector(this.velocity, dt);
    const w = this.angularVelocity;
    DQ.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(this.quaternion);
    this.quaternion.set(
      this.quaternion.x + DQ.x,
      this.quaternion.y + DQ.y,
      this.quaternion.z + DQ.z,
      this.quaternion.w + DQ.w,
    ).normalize();

    // ---- collisions ----
    this.collideBody(world);
    this.collideWalls(world);

    // ---- safety: never let NaN escape ----
    if (!isFinite(this.position.x + this.position.y + this.position.z + this.velocity.x + this.velocity.y + this.velocity.z + this.angularVelocity.x + this.angularVelocity.y + this.angularVelocity.z + this.quaternion.w)) {
      this.position.copy(this.prevPosition);
      this.quaternion.copy(this.prevQuaternion);
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      for (const wh of this.wheels) wh.omega = 0;
      eng.omega = s.engine.idleRpm * (Math.PI / 30);
    }

    // ---- telemetry ----
    const t = this.telemetry;
    const f2 = this.fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    const l2 = this.left.set(1, 0, 0).applyQuaternion(this.quaternion);
    t.speed = this.velocity.length();
    t.forwardSpeed = this.velocity.dot(f2);
    t.lateralSpeed = -this.velocity.dot(l2);
    t.driftAngle = t.speed > 2 ? Math.atan2(t.lateralSpeed, Math.abs(t.forwardSpeed)) : 0;
    t.yawRate = this.angularVelocity.dot(this.up.set(0, 1, 0).applyQuaternion(this.quaternion));
    t.rpm = eng.rpm;
    t.gear = eng.gear;
    t.boost = eng.boost;
    t.throttle = throttle;
    t.brake = brake;
    t.steer = this.steerAngle / s.steerLock;
    t.rearSlip = rearSlide;
    t.airborne = groundedWheels === 0;
  }

  private applyDiff(a: Wheel, b: Wheel, d: DiffSpec, torqueIn: number, dt: number, extraI: number): void {
    const Ia = this.spec.wheelInertia + extraI;
    const Ib = Ia;
    const delta = a.omega - b.omega;
    let limit: number;
    if (this.model === 'sim' && d.type !== 'open' && d.type !== 'welded') {
      // clutch-type LSD: preload + power lock % on throttle, coast lock % off it; 100% = locked
      const lock = torqueIn >= 0 ? d.accelLock : d.decelLock;
      limit = lock >= 0.999 ? Infinity : d.preload + Math.abs(torqueIn) * lock;
      const Ired = (Ia * Ib) / (Ia + Ib);
      const tq = Math.max(-limit, Math.min(limit, (delta * Ired) / dt));
      a.omega -= (tq * dt) / Ia;
      b.omega += (tq * dt) / Ib;
      return;
    }
    switch (d.type) {
      case 'welded':
        limit = Infinity;
        break;
      case 'open':
        limit = 5;
        break;
      case 'lsd2':
        limit = d.preload + Math.abs(torqueIn) * (torqueIn >= 0 ? d.accelLock : d.accelLock);
        break;
      default:
        limit = d.preload + Math.abs(torqueIn) * (torqueIn >= 0 ? d.accelLock : d.decelLock);
    }
    const Ired = (Ia * Ib) / (Ia + Ib);
    const need = (delta * Ired) / dt;
    const tq = Math.max(-limit, Math.min(limit, need));
    a.omega -= (tq * dt) / Ia;
    b.omega += (tq * dt) / Ib;
  }

  /** Body box corners against the ground (rollovers, big landings). */
  private collideBody(world: PhysicsWorld): void {
    const s = this.spec;
    const hx = s.width * 0.48, hz = s.length * 0.48;
    const yLo = -s.suspension.cgHeight + 0.18, yHi = s.height - s.suspension.cgHeight - 0.05;
    this.bodyContact = false;
    for (let i = 0; i < 8; i++) {
      const p = this.tmp.set(i & 1 ? hx : -hx, i & 2 ? yHi : yLo, i & 4 ? hz : -hz).applyQuaternion(this.quaternion).add(this.position);
      world.sampleGround(p.x, p.z, this.sample);
      const pen = this.sample.height - p.y;
      if (pen <= 0) continue;
      this.bodyContact = true;
      const n = this.tmp2.set(this.sample.nx, this.sample.ny, this.sample.nz);
      this.position.addScaledVector(n, pen * 0.8);
      const rel = this.tmp3.copy(p).sub(this.position);
      const impact = this.resolveImpulse(rel, n, 0.15, 0.6);
      if (impact > 3) this.impacts.push({ speed: impact, x: p.x, y: p.y, z: p.z, kind: 'ground', material: 'ground' });
    }
  }

  /** Perimeter points of the body against wall capsules. */
  private collideWalls(world: PhysicsWorld): void {
    const s = this.spec;
    const hx = s.width * 0.5, hz = s.length * 0.5;
    const y = 0.05;
    let maxImpact = 0;
    let impactAt: WallHit | null = null;
    for (let i = 0; i < PERIM.length; i++) {
      const [px, pz] = PERIM[i];
      const p = this.tmp.set(px * hx, y, pz * hz).applyQuaternion(this.quaternion).add(this.position);
      const hit = world.walls.query(p.x, p.y, p.z, this.hit);
      if (!hit) continue;
      this.position.x += hit.nx * hit.depth;
      this.position.z += hit.nz * hit.depth;
      const rel = this.tmp3.set(p.x - this.position.x, 0, p.z - this.position.z);
      const n = this.tmp2.set(hit.nx, 0, hit.nz);
      const friction = hit.wall.material === 'tire' ? 0.5 : hit.wall.material === 'guardrail' ? 0.25 : 0.35;
      const restitution = hit.wall.material === 'tire' ? 0.35 : 0.18;
      const imp = this.resolveImpulse(rel, n, restitution, friction);
      if (imp > maxImpact) {
        maxImpact = imp;
        impactAt = { ...hit };
        impactAt.px = p.x;
        impactAt.pz = p.z;
      }
    }
    if (impactAt && maxImpact > 1.0) {
      this.impacts.push({ speed: maxImpact, x: impactAt.px, y: this.position.y, z: impactAt.pz, kind: 'wall', material: impactAt.wall.material });
    }
  }

  /**
   * Collide the car body with a moving box (traffic). Box: centre (cx, cz), heading yaw,
   * half length hl, half width hw, velocity (vx, vz). Returns the impact speed (0 = no contact).
   */
  collideBox(cx: number, cy: number, cz: number, yaw: number, hl: number, hw: number, vx: number, vz: number): number {
    const s = this.spec;
    const sx = s.width * 0.5, sz = s.length * 0.5;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    if (Math.abs(this.position.y - cy) > 2.5) return 0;
    let impact = 0;
    for (const [px, pz] of PERIM) {
      const p = this.tmp.set(px * sx, 0, pz * sz).applyQuaternion(this.quaternion).add(this.position);
      const dx = p.x - cx, dz = p.z - cz;
      // box-local: forward = (sin yaw, cos yaw), left = (cos yaw, -sin yaw)
      const lz = dx * sn + dz * c, lx = dx * c - dz * sn;
      const ox = hw - Math.abs(lx), oz = hl - Math.abs(lz);
      if (ox <= 0 || oz <= 0) continue;
      let nx: number, nz: number, depth: number;
      if (ox < oz) {
        const sg = Math.sign(lx) || 1;
        nx = c * sg;
        nz = -sn * sg;
        depth = ox;
      } else {
        const sg = Math.sign(lz) || 1;
        nx = sn * sg;
        nz = c * sg;
        depth = oz;
      }
      this.position.x += nx * depth;
      this.position.z += nz * depth;
      // resolve in the box's frame so a moving car hits harder
      this.velocity.x -= vx;
      this.velocity.z -= vz;
      const rel = this.tmp3.set(p.x - this.position.x, 0, p.z - this.position.z);
      const imp = this.resolveImpulse(rel, this.tmp2.set(nx, 0, nz), 0.25, 0.4);
      this.velocity.x += vx;
      this.velocity.z += vz;
      impact = Math.max(impact, imp);
    }
    return impact;
  }

  /** Impulse at body-relative point `rel` along normal n. Returns closing speed. */
  private resolveImpulse(rel: Vector3, n: Vector3, restitution: number, friction: number): number {
    const av = this.angularVelocity;
    const vx = this.velocity.x + (av.y * rel.z - av.z * rel.y);
    const vy = this.velocity.y + (av.z * rel.x - av.x * rel.z);
    const vz = this.velocity.z + (av.x * rel.y - av.y * rel.x);
    const vn = vx * n.x + vy * n.y + vz * n.z;
    if (vn >= 0) return 0;
    const m = this.spec.mass;
    // effective mass along n including rotation
    const rxn = CROSS.crossVectors(rel, n);
    const angTerm = this.applyInvInertia(rxn.clone()).cross(rel).dot(n);
    const j = (-(1 + restitution) * vn) / (1 / m + angTerm);
    const J = IMP.copy(n).multiplyScalar(j);
    // friction impulse opposing tangential velocity
    const vt = TAN.set(vx - vn * n.x, vy - vn * n.y, vz - vn * n.z);
    const vtl = vt.length();
    if (vtl > 1e-4) {
      const jt = Math.min(friction * j, vtl * m * 0.5);
      J.addScaledVector(vt, -jt / vtl);
    }
    this.velocity.addScaledVector(J, 1 / m);
    const dL = CROSS.crossVectors(rel, J);
    this.angularVelocity.add(this.applyInvInertia(dL));
    return -vn;
  }

  private applyInvInertia(v: Vector3): Vector3 {
    v.applyQuaternion(INV.copy(this.quaternion).invert());
    v.x *= this.invInertiaBody.x;
    v.y *= this.invInertiaBody.y;
    v.z *= this.invInertiaBody.z;
    return v.applyQuaternion(this.quaternion);
  }

  /** Wheel centre in world space for rendering. */
  wheelCenter(w: Wheel, out: Vector3, pos = this.position, quat = this.quaternion): Vector3 {
    const drop = w.travel - Math.max(-0.05, Math.min(w.travel, w.compression));
    out.set(w.mount.x, w.mount.y - drop, w.mount.z).applyQuaternion(quat).add(pos);
    return out;
  }

  /** Local (body-space) wheel centre offset, for rendering inside the car group. */
  wheelLocal(w: Wheel, out: Vector3): Vector3 {
    const drop = w.travel - Math.max(-0.05, Math.min(w.travel, w.compression));
    return out.set(w.mount.x, w.mount.y - drop, w.mount.z);
  }
}

const INV = new Quaternion();
const DQ = new Quaternion();
const CROSS = new Vector3();
const IMP = new Vector3();
const TAN = new Vector3();
const LOADS = [0, 0, 0, 0];
const PERIM: [number, number][] = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [0, 1], [0, -1], [1, 0.5], [-1, 0.5], [1, -0.5], [-1, -0.5], [1, 0], [-1, 0],
  [0.5, 1], [-0.5, 1], [0.5, -1], [-0.5, -1],
];

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smooth01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}
