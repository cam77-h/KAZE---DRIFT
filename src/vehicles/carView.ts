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
  /** extra visual ride-height offset (stance), metres: the body drops, the wheels stay */
  stance = 0;
  /** visual camber (rad, positive = top of the wheel leans in), front and rear */
  camberFront = 0;
  camberRear = 0;
  private shadow: THREE.Mesh;

  constructor(
    public vehicle: Vehicle,
    public visual: CarVisual,
    opts: { stance?: number } = {},
  ) {
    const p = vehicle.spec;
    this.stance = opts.stance ?? 0;
    // soft contact shadow so the car sits on the road instead of floating over it
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.62, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 3;
    this.shadow.scale.set(visual.dims.width * 1.25, visual.dims.length * 1.18, 1);
    this.group.add(this.shadow);
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
    const mid = (p.cgToFront - p.cgToRear) / 2;
    this.shadow.position.set(0, -p.suspension.cgHeight + 0.025, mid);
  }

  setStance(drop: number, camberFront = this.camberFront, camberRear = this.camberRear): void {
    this.stance = drop;
    this.camberFront = camberFront;
    this.camberRear = camberRear;
    this.alignModel();
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

    // the sim model has real pitch and roll from the suspension: no added visual lean
    if (dt > 0 && v.model === 'sim') this.body.rotation.set(0, 0, 0);
    else if (dt > 0) {
      const acc = this.tmpV.copy(v.velocity).sub(this.lastVel).divideScalar(Math.max(dt, 1e-3));
      this.lastVel.copy(v.velocity);
      acc.applyQuaternion(this.tmpQ.copy(v.quaternion).invert());
      const targetRoll = THREE.MathUtils.clamp(acc.x * 0.004, -0.04, 0.04);
      // nose dives under braking; under hard acceleration (a launch) the rear squats a little more
      const targetPitch = THREE.MathUtils.clamp(-acc.z * (acc.z > 0 ? 0.0045 : 0.003), -0.04, 0.03);
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
      const camber = (w.front ? this.camberFront : this.camberRear) * (w.left ? 1 : -1);
      wm.pivot.rotation.set(0, -w.steer, camber, 'YZX');
      wm.spin.rotation.x = w.spin * wm.spinSign;
    }
    // the shadow fades as the car leaves the ground
    const grounded = v.wheels.reduce((n, w) => n + (w.onGround ? 1 : 0), 0);
    const m = this.shadow.material as THREE.MeshBasicMaterial;
    m.opacity += ((grounded >= 2 ? 0.62 : 0.15) - m.opacity) * Math.min(1, dt * 8);

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

let shadowTex: THREE.Texture | null = null;
/** Blurred rounded-rectangle shadow, darkest under the middle of the car. */
function contactShadowTexture(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.filter = 'blur(14px)';
  g.fillStyle = 'rgba(0,0,0,0.85)';
  const r = 26;
  g.beginPath();
  g.roundRect(26, 30, 76, 196, r);
  g.fill();
  g.filter = 'blur(6px)';
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(40, 55, 48, 146);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}
