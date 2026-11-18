import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

// Physically based sky + sun/moon, with the environment map regenerated (PMREM) whenever
// the time of day changes, so car paint and glass always reflect the actual sky.

export interface TimeOfDayLook {
  sunElevation: number; // degrees
  sunAzimuth: number; // degrees
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fog: THREE.Color;
  turbidity: number;
  rayleigh: number;
  exposure: number;
  night: number; // 0 day .. 1 night
}

const C = (h: number) => new THREE.Color(h);

/** Look for an hour of the day (0..24). */
export function lookForHour(hour: number): TimeOfDayLook {
  // sun path: rises at 6, sets at 18.5
  const dayT = (hour - 6) / 12.5;
  const elev = Math.sin(dayT * Math.PI) * 58;
  const az = 100 + dayT * 160;
  const night = THREE.MathUtils.smoothstep(-elev, -2, 8);
  const golden = THREE.MathUtils.smoothstep(18 - Math.abs(elev - 6) * 1.2, 0, 18) * (1 - night);
  const sunColor = C(0xfff3e2).lerp(C(0xffa25a), golden * 0.85);
  const fog = C(0xb9cfe0).lerp(C(0xe9b98e), golden * 0.7).lerp(C(0x0b1424), night);
  return {
    sunElevation: elev,
    sunAzimuth: az,
    sunColor: night > 0.5 ? C(0x9fb6ff) : sunColor,
    sunIntensity: THREE.MathUtils.lerp(Math.max(0.25, Math.min(3.2, elev / 9)), 0.18, night),
    hemiSky: C(0xcfe3ff).lerp(C(0xffd2a8), golden * 0.5).lerp(C(0x22324f), night),
    hemiGround: C(0x5a5040).lerp(C(0x0b0d12), night),
    hemiIntensity: THREE.MathUtils.lerp(0.9, 0.35, night),
    fog,
    turbidity: THREE.MathUtils.lerp(4, 9, golden),
    rayleigh: THREE.MathUtils.lerp(1.2, 2.6, golden),
    exposure: THREE.MathUtils.lerp(0.62, 0.9, night) + golden * 0.08,
    night,
  };
}

export class Environment {
  readonly sky: Sky;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly stars: THREE.Points;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envScene = new THREE.Scene();
  private envSky: Sky;
  look: TimeOfDayLook = lookForHour(16.5);
  hour = 16.5;
  readonly sunDir = new THREE.Vector3();
  shadowRange = 40;

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
  ) {
    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    scene.add(this.sky);
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    // a ground disc in the env scene so reflections have a dark lower hemisphere
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshBasicMaterial({ color: 0x3a3a38 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -10;
    this.envScene.add(ground);
    this.envGround = ground;

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 0.9);
    scene.add(this.hemi);

    // stars for night
    const n = 1500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random() * 0.9 + 0.08;
      const th = u * Math.PI * 2, ph = Math.acos(1 - v);
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * 3000;
      pos[i * 3 + 1] = Math.cos(ph) * 3000;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 3000;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    scene.add(this.stars);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    scene.fog = new THREE.Fog(0xb9cfe0, 150, 1400);
  }
  private envGround: THREE.Mesh;

  setShadowQuality(q: 0 | 1 | 2 | 3): void {
    this.sun.castShadow = q > 0;
    const size = q >= 3 ? 4096 : q === 2 ? 2048 : 1024;
    this.shadowRange = q >= 3 ? 60 : q === 2 ? 45 : 32;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    const c = this.sun.shadow.camera;
    c.left = -this.shadowRange;
    c.right = this.shadowRange;
    c.top = this.shadowRange;
    c.bottom = -this.shadowRange;
    c.near = 1;
    c.far = 400;
    c.updateProjectionMatrix();
  }

  setDrawDistance(scale: number): void {
    const f = this.scene.fog as THREE.Fog;
    f.near = 150 * scale;
    f.far = 1400 * scale;
  }

  setHour(hour: number): void {
    this.hour = ((hour % 24) + 24) % 24;
    const L = (this.look = lookForHour(this.hour));
    const phi = THREE.MathUtils.degToRad(90 - Math.max(L.sunElevation, -4));
    const theta = THREE.MathUtils.degToRad(L.sunAzimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = L.turbidity;
      u.rayleigh.value = L.rayleigh;
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.82;
      u.sunPosition.value.copy(this.sunDir);
    }
    this.sun.color.copy(L.sunColor);
    this.sun.intensity = L.sunIntensity;
    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemiIntensity;
    (this.scene.fog as THREE.Fog).color.copy(L.fog);
    (this.stars.material as THREE.PointsMaterial).opacity = L.night;
    this.sky.visible = L.night < 0.98;
    this.scene.background = L.night > 0.6 ? new THREE.Color(0x05080f).lerp(L.fog, 0.2) : null;
    (this.envGround.material as THREE.MeshBasicMaterial).color.copy(L.hemiGround).multiplyScalar(0.8);
    this.renderer.toneMappingExposure = L.exposure;
    this.rebuildEnv();
  }

  private rebuildEnv(): void {
    // night: dim the sky used for reflections and add a faint city glow
    const prevRT = this.envRT;
    if (this.look.night > 0.5) {
      const nightScene = new THREE.Scene();
      nightScene.background = new THREE.Color(0x0a1220);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(500, 16, 8), new THREE.MeshBasicMaterial({ color: 0x1b2a44, side: THREE.BackSide }));
      nightScene.add(glow);
      this.envRT = this.pmrem.fromScene(nightScene, 0.04);
    } else {
      this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    }
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.look.night > 0.5 ? 0.6 : 1;
    prevRT?.dispose();
  }

  /** Keep the shadow frustum tight around the player. */
  follow(target: THREE.Vector3): void {
    const d = this.sunDir;
    const up = Math.max(0.15, d.y);
    this.sun.position.set(target.x + d.x * 150, target.y + up * 150, target.z + d.z * 150);
    this.sun.target.position.copy(target);
    // snap to texel grid to avoid shimmering
    this.sun.target.updateMatrixWorld();
    this.stars.position.copy(target);
  }
}
