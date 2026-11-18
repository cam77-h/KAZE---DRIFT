import * as THREE from 'three';
import type { Vehicle } from '../physics/vehicle';
import type { CarDef } from '../data';
import { buildCarBody, type CarModel } from './carModel';
import { buildWheel, type WheelModel } from './wheelModel';
import { s15Shape } from './shapes';
import type { BodyShape } from './profile';

// Binds a physics Vehicle to its 3D model: interpolated pose, wheel spin/steer/suspension
// travel, brake/reverse lamps and night headlights. glTF models (Phase 4) plug in here.

const SHAPES: Record<string, (f: number, r: number, wr: number) => BodyShape> = {
  s15: s15Shape,
};

export class CarView {
  readonly group = new THREE.Group();
  readonly model: CarModel;
  readonly wheels: WheelModel[] = [];
  private bodyPivot = new THREE.Group();
  private headSpots: THREE.SpotLight[] = [];
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private lastVel = new THREE.Vector3();
  private bodyRoll = 0;
  private bodyPitch = 0;
  headlightsOn = false;

  constructor(
    public vehicle: Vehicle,
    def: CarDef,
    paint: string,
  ) {
    const p = vehicle.spec;
    const shapeFn = SHAPES[def.visual.model] ?? s15Shape;
    this.model = buildCarBody(shapeFn(p.cgToFront, p.cgToRear, p.wheelRadius), paint);
    // model space has the ground at y=0 under the CG; the physics origin is the CG
    this.bodyPivot.add(this.model.root);
    this.model.root.position.y = -p.suspension.cgHeight;
    this.group.add(this.bodyPivot);

    const rimDia = def.visual.wheelDiameterIn * 0.0254;
    const shared = {
      rim: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.85, roughness: 0.28 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0xd21f2b, metalness: 0.3, roughness: 0.4 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x131315, roughness: 0.88 }),
      disc: new THREE.MeshStandardMaterial({ color: 0x5b5d61, metalness: 0.9, roughness: 0.45 }),
    };
    for (const w of vehicle.wheels) {
      const wm = buildWheel(
        { radius: p.wheelRadius, width: 0.225, rimRadius: rimDia / 2, spokes: 6, rimColor: '#c9ccd1', caliperColor: '#d21f2b', design: 'kumo6' },
        w.left ? 1 : -1,
        shared,
      );
      this.group.add(wm.pivot);
      this.wheels.push(wm);
    }

    // headlight beams for night driving (cheap: two spot lights, no shadows)
    for (const a of this.model.headlightAnchors) {
      const s = new THREE.SpotLight(0xfff1d8, 0, 70, 0.42, 0.55, 1.4);
      s.position.copy(a).add(new THREE.Vector3(0, -p.suspension.cgHeight, 0));
      s.target.position.set(a.x * 0.6, -p.suspension.cgHeight - 0.6, a.z + 18);
      s.castShadow = false;
      this.bodyPivot.add(s, s.target);
      this.headSpots.push(s);
    }
    this.group.traverse((o) => {
      o.matrixAutoUpdate = true;
    });
  }

  setPaint(color: string): void {
    this.model.materials.paint.color.set(color);
  }

  setHeadlights(on: boolean): void {
    this.headlightsOn = on;
    for (const s of this.headSpots) s.intensity = on ? 60 : 0;
    this.model.materials.headLens.emissiveIntensity = on ? 2.6 : 0;
  }

  /** Update the visual from the physics state. alpha interpolates prev → current pose. */
  update(alpha: number, dt: number): void {
    const v = this.vehicle;
    this.group.position.lerpVectors(v.prevPosition, v.position, alpha);
    this.group.quaternion.slerpQuaternions(v.prevQuaternion, v.quaternion, alpha);

    // a little visual body roll/pitch on top of the real suspension motion, for weight
    if (dt > 0) {
      const acc = this.tmpV.copy(v.velocity).sub(this.lastVel).divideScalar(Math.max(dt, 1e-3));
      this.lastVel.copy(v.velocity);
      const invQ = this.tmpQ.copy(v.quaternion).invert();
      acc.applyQuaternion(invQ);
      const targetRoll = THREE.MathUtils.clamp(acc.x * 0.004, -0.04, 0.04);
      const targetPitch = THREE.MathUtils.clamp(-acc.z * 0.003, -0.03, 0.03);
      const k = 1 - Math.exp(-dt * 6);
      this.bodyRoll += (targetRoll - this.bodyRoll) * k;
      this.bodyPitch += (targetPitch - this.bodyPitch) * k;
      this.bodyPivot.rotation.set(this.bodyPitch, 0, this.bodyRoll);
    }

    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i];
      const wm = this.wheels[i];
      v.wheelLocal(w, wm.pivot.position);
      // keep the wheels at a constant distance from the steering axis
      wm.pivot.position.x += w.left ? 0.0 : 0.0;
      wm.pivot.rotation.y = -w.steer;
      wm.spin.rotation.x = w.spin * wm.side;
    }

    // lamps
    const m = this.model.materials;
    const braking = v.telemetry.brake > 0.05 || (v.telemetry.forwardSpeed < -0.5 && v.telemetry.throttle > 0.05);
    m.tailLens.emissiveIntensity = (this.headlightsOn ? 0.9 : 0.25) + (braking ? 2.2 : 0);
    m.reverse.emissiveIntensity = v.engine.gear === -1 ? 1.6 : 0;
    const wheel = this.model.root.getObjectByName('steering-wheel');
    if (wheel) wheel.rotation.z = -v.steerAngle * 6;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
      }
    });
  }
}
