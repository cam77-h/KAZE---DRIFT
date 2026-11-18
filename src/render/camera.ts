import * as THREE from 'three';

export const CAMERA_NAMES = ['Chase', 'Far chase', 'Hood', 'Bumper'];

/**
 * Spring-based chase camera with weight: it lags behind on acceleration, swings out and
 * looks into the drift, widens the FOV with speed and shakes on impacts.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode = 0;
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private look = new THREE.Vector3();
  private shake = 0;
  private initialized = false;
  private heading = new THREE.Vector3(0, 0, 1);
  shakeScale = 1;
  lookBack = false;
  private tmp = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.08, 6000);
  }

  cycle(): string {
    this.mode = (this.mode + 1) % CAMERA_NAMES.length;
    this.initialized = false;
    return CAMERA_NAMES[this.mode];
  }

  bump(strength: number): void {
    this.shake = Math.min(1.5, this.shake + strength);
  }

  snap(): void {
    this.initialized = false;
  }

  update(dt: number, carPos: THREE.Vector3, carQuat: THREE.Quaternion, velocity: THREE.Vector3, speed: number): void {
    const cam = this.camera;
    const fwd = this.fwd.set(0, 0, 1).applyQuaternion(carQuat);
    const up = this.up.set(0, 1, 0).applyQuaternion(carQuat);
    // blend car heading with direction of travel → camera swings out in a drift
    const flatFwd = this.tmp.set(fwd.x, 0, fwd.z).normalize();
    const target = new THREE.Vector3().copy(flatFwd);
    if (speed > 3) {
      const vdir = new THREE.Vector3(velocity.x, 0, velocity.z).normalize();
      if (vdir.dot(flatFwd) > -0.2) target.lerp(vdir, 0.5).normalize();
    }
    const k = 1 - Math.exp(-dt * (this.mode >= 2 ? 30 : 4.5));
    this.heading.lerp(target, k).normalize();
    let h = this.heading;
    if (this.lookBack) h = h.clone().negate();

    if (this.mode >= 2) {
      // hood / bumper: rigid to the car
      const off = this.mode === 2 ? new THREE.Vector3(0, 0.62, 0.35) : new THREE.Vector3(0, 0.05, 2.25);
      const p = off.applyQuaternion(carQuat).add(carPos);
      const dir = this.lookBack ? fwd.clone().negate() : fwd;
      cam.position.copy(p);
      this.look.copy(p).addScaledVector(dir, 20).addScaledVector(up, this.mode === 2 ? 0.1 : 0.3);
      cam.up.copy(up);
      cam.lookAt(this.look);
      this.initialized = false;
    } else {
      const far = this.mode === 1;
      const dist = (far ? 9.5 : 6.2) + Math.min(speed, 50) * 0.025;
      const height = far ? 3.3 : 2.05;
      const desired = new THREE.Vector3().copy(carPos).addScaledVector(h, -dist);
      desired.y = carPos.y + height;
      if (!this.initialized) {
        this.pos.copy(desired);
        this.vel.set(0, 0, 0);
        this.look.copy(carPos);
        this.initialized = true;
      }
      // critically damped spring, solved in closed form so it is stable at any frame time
      const w = far ? 5.5 : 7;
      const x = w * dt;
      const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const change = this.pos.clone().sub(desired);
      const temp = this.vel.clone().addScaledVector(change, w).multiplyScalar(dt);
      this.vel.addScaledVector(temp, -w).multiplyScalar(decay);
      this.pos.copy(desired).add(change.add(temp).multiplyScalar(decay));
      // don't let the camera fall below the car's ground
      if (this.pos.y < carPos.y + 0.5) this.pos.y = carPos.y + 0.5;
      const lookTarget = new THREE.Vector3().copy(carPos).addScaledVector(h, far ? 3 : 2.2);
      lookTarget.y = carPos.y + (far ? 0.6 : 0.75);
      this.look.lerp(lookTarget, 1 - Math.exp(-dt * 10));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
    }

    // shake: impacts + a little road rumble at speed
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const rumble = Math.min(1, speed / 60) * 0.004;
    const s = (this.shake * 0.08 + rumble) * this.shakeScale;
    if (s > 0) {
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }

    const baseFov = this.mode === 3 ? 72 : this.mode === 2 ? 66 : 58;
    const fov = baseFov + Math.min(speed, 70) * 0.2;
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
  }
}
