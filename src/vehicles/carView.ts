import * as THREE from 'three';
import type { Vehicle } from '../physics/vehicle';
import type { CarVisual } from './carVisual';
import type { PaintFinish } from './paint';

// Binds a physics Vehicle to its 3D model (imported or procedural): interpolated pose, wheel
// spin/steer/suspension travel, brake/reverse lamps and night headlights.

export class CarView {
  readonly group = new THREE.Group();
  /** body pivot (adds a little visual roll/pitch); the model hangs off this */
  readonly body = new THREE.Group();
  private headSpots: THREE.SpotLight[] = [];
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private lastVel = new THREE.Vector3();
  private bodyRoll = 0;
  private bodyPitch = 0;
  headlightsOn = false;
  night = false;
  /** extra visual ride-height offset (stance), metres */
  stance = 0;

  constructor(
    public vehicle: Vehicle,
    public visual: CarVisual,
  ) {
    const p = vehicle.spec;
    // physics origin is the CG; model space has the ground at y = 0
    this.group.add(this.body);
    this.body.add(visual.root);
    this.alignModel();
    for (const w of visual.wheels) this.group.add(w.pivot);

    for (const a of visual.headAnchors) {
      const s = new THREE.SpotLight(0xfff1d8, 0, 75, 0.42, 0.55, 1.4);
      s.position.copy(a);
      s.target.position.set(a.x * 0.6, -0.6, a.z + 18);
      s.castShadow = false;
      visual.root.add(s, s.target);
      this.headSpots.push(s);
    }
    void p;
  }

  /** Put the model's front axle on the physics front axle, ground under the CG. */
  alignModel(): void {
    const p = this.vehicle.spec;
    this.visual.root.position.set(0, -p.suspension.cgHeight - this.stance, p.cgToFront - this.visual.frontAxleZ);
  }

  setPaint(color: string, finish: PaintFinish = 'metallic'): void {
    this.visual.setPaint(color, finish);
  }

  setHeadlights(on: boolean): void {
    this.headlightsOn = on;
    this.night = on;
    for (const s of this.headSpots) s.intensity = on ? 60 : 0;
    this.visual.setHeadlights(on);
  }

  /** Update the visual from the physics state. alpha interpolates prev → current pose. */
  update(alpha: number, dt: number): void {
    const v = this.vehicle;
    this.group.position.lerpVectors(v.prevPosition, v.position, alpha);
    this.group.quaternion.slerpQuaternions(v.prevQuaternion, v.quaternion, alpha);

    if (dt > 0) {
      const acc = this.tmpV.copy(v.velocity).sub(this.lastVel).divideScalar(Math.max(dt, 1e-3));
      this.lastVel.copy(v.velocity);
      acc.applyQuaternion(this.tmpQ.copy(v.quaternion).invert());
      const targetRoll = THREE.MathUtils.clamp(acc.x * 0.004, -0.04, 0.04);
      const targetPitch = THREE.MathUtils.clamp(-acc.z * 0.003, -0.03, 0.03);
      const k = 1 - Math.exp(-dt * 6);
      this.bodyRoll += (targetRoll - this.bodyRoll) * k;
      this.bodyPitch += (targetPitch - this.bodyPitch) * k;
      this.body.rotation.set(this.bodyPitch, 0, this.bodyRoll);
    }

    const W = this.visual.wheels;
    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i];
      const wm = W[i];
      if (wm.shared) continue;
      const pos = v.wheelLocal(w, wm.pivot.position);
      // a shared rear axle node sits between the two rear wheels
      if (i === 2 && W[3]?.shared) {
        const other = v.wheelLocal(v.wheels[3], this.tmpV2);
        pos.add(other).multiplyScalar(0.5);
      }
      wm.pivot.rotation.y = -w.steer;
      wm.spin.rotation.x = w.spin * wm.spinSign;
    }

    const t = v.telemetry;
    const braking = t.brake > 0.05 || (t.forwardSpeed < -0.5 && t.throttle > 0.05);
    this.visual.setBrake(braking ? 1 : 0, this.night);
    this.visual.setReverse(v.engine.gear === -1);
    if (this.visual.steeringWheel) this.visual.steeringWheel.rotation.z = -v.steerAngle * 6;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }
}
