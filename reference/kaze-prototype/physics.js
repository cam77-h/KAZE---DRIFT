// ===== Car physics (2D top-down, bicycle model with weight transfer) =====
// World: x/y plane (y maps to three.js z). heading 0 = facing +x. Positive steer = turn right.
const TUNE_DEFAULTS = {
  power: 12500,       // engine force (N)
  steerLock: 0.62,    // max steering angle (rad) - angle kit raises this
  frontGrip: 2.0,     // front tire grip (x weight)
  rearGrip: 2.15,     // rear tire grip (x weight)
  powerSlide: 0.38,   // how much throttle breaks rear traction
  handbrake: 0.42,    // rear grip left while handbrake held (lower = more slide)
  stability: 0.55,    // drift assist: yaw damping while sliding
  weightTransfer: 0.25
};

function makeCar(tune) {
  return {
    tune: Object.assign({}, TUNE_DEFAULTS, tune || {}),
    mass: 1250, cgToFront: 1.25, cgToRear: 1.35, cgHeight: 0.5, halfWidth: 0.85,
    brakeForce: 13000, airResist: 2.2, rollResist: 6.0,
    cornerFront: 5.0, cornerRear: 5.4, gravity: 9.81,
    x: 0, y: 0, heading: 0, vx: 0, vy: 0, yawRate: 0,
    steer: 0, accelLocalX: 0, accelLocalY: 0,
    // outputs
    speed: 0, fwdSpeed: 0, latSpeed: 0, driftAngle: 0, rearSlip: 0, frontSlip: 0, wheelspin: 0
  };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Tire lateral force curve: linear up to grip, then gentle falloff (makes slides holdable)
function tireForce(slip, stiffness, grip, falloff) {
  const raw = -stiffness * slip;
  const a = Math.abs(raw);
  if (a <= grip) return raw;
  const over = Math.min(1, (a - grip) / (grip * 1.5));
  return Math.sign(raw) * grip * (1 - falloff * over);
}

// input: {throttle 0..1, brake 0..1, steer -1..1, handbrake 0/1}
function stepCar(c, input, dt) {
  const t = c.tune;
  const cs = Math.cos(c.heading), sn = Math.sin(c.heading);
  const wheelBase = c.cgToFront + c.cgToRear;
  const fwd = cs * c.vx + sn * c.vy;    // local forward velocity
  const lat = cs * c.vy - sn * c.vx;    // local lateral velocity (+ = right)
  const speed = Math.hypot(c.vx, c.vy);

  // Smooth steering, slightly reduced at high speed (but keep plenty of lock for countersteer)
  const steerTarget = input.steer * t.steerLock * (1 - Math.min(speed, 60) / 160);
  const steerRate = 4.5;
  c.steer += clamp(steerTarget - c.steer, -steerRate * dt, steerRate * dt);

  // Reverse when stopped and holding brake
  let throttle = input.throttle, brake = input.brake, reverse = false;
  if (brake > 0 && fwd < 1.0 && throttle === 0) { reverse = true; brake = 0; }

  // Weight transfer
  const wf = c.cgToRear / wheelBase, wr = c.cgToFront / wheelBase;
  const axleFront = c.mass * (wf * c.gravity - t.weightTransfer * c.accelLocalX * c.cgHeight / wheelBase);
  const axleRear = c.mass * (wr * c.gravity + t.weightTransfer * c.accelLocalX * c.cgHeight / wheelBase);

  const absF = Math.max(Math.abs(fwd), 0.5);
  const slipF = Math.atan2(lat + c.cgToFront * c.yawRate, absF) - Math.sign(fwd || 1) * c.steer;
  const slipR = Math.atan2(lat - c.cgToRear * c.yawRate, absF);

  // Rear grip: handbrake locks it, throttle (wheelspin) breaks it loose
  let rearGrip = t.rearGrip;
  const spinFactor = throttle * t.powerSlide * clamp(speed / 12, 0, 1);
  rearGrip *= (1 - spinFactor);
  if (input.handbrake) rearGrip *= t.handbrake;
  const frontGrip = t.frontGrip;

  const fyF = tireForce(slipF, c.cornerFront, frontGrip, 0.1) * axleFront;
  const fyR = tireForce(slipR, c.cornerRear, rearGrip, 0.2) * axleRear;

  // Longitudinal
  let traction = 0;
  if (reverse) traction = -input.brake * t.power * 0.4;
  else traction = throttle * t.power * (1 - Math.min(speed, 70) / 95) - brake * c.brakeForce * Math.sign(fwd);
  if (input.handbrake) traction -= 3500 * Math.sign(fwd) * Math.min(1, Math.abs(fwd));
  const dragX = -c.rollResist * fwd - c.airResist * fwd * Math.abs(fwd);
  const dragY = -c.rollResist * lat - c.airResist * lat * Math.abs(lat);

  const fx = dragX + traction - Math.sin(c.steer) * fyF;
  const fy = dragY + Math.cos(c.steer) * fyF + fyR;

  c.accelLocalX = fx / c.mass;
  c.accelLocalY = fy / c.mass;
  const ax = cs * c.accelLocalX - sn * c.accelLocalY;
  const ay = sn * c.accelLocalX + cs * c.accelLocalY;
  c.vx += ax * dt; c.vy += ay * dt;

  let torque = Math.cos(c.steer) * fyF * c.cgToFront - fyR * c.cgToRear;
  const inertia = c.mass * 1.3;
  // Drift assist: damp yaw a bit when sliding so spins are less sudden
  const slideAmt = clamp(Math.abs(slipR) / 0.4, 0, 1);
  torque -= c.yawRate * inertia * t.stability * 2.2 * slideAmt;

  const newSpeed = Math.hypot(c.vx, c.vy);
  if (newSpeed < 0.4 && throttle === 0 && !reverse) {
    c.vx = 0; c.vy = 0; c.yawRate *= 0.8; torque = 0;
  }
  c.yawRate += (torque / inertia) * dt;
  c.heading += c.yawRate * dt;
  c.x += c.vx * dt; c.y += c.vy * dt;

  // outputs
  c.speed = newSpeed; c.fwdSpeed = fwd; c.latSpeed = lat;
  c.driftAngle = newSpeed > 2 ? Math.atan2(lat, Math.abs(fwd)) : 0;
  c.rearSlip = Math.abs(slipR); c.frontSlip = Math.abs(slipF);
  c.wheelspin = spinFactor;
}

if (typeof module !== 'undefined') module.exports = { makeCar, stepCar, TUNE_DEFAULTS };
