import * as THREE from 'three';
import { smokeTexture } from './textures';
import type { Track } from '../world/track';

// ------------------------------------------------------------------ tire smoke

const SMOKE_VERT = /* glsl */ `
attribute vec4 iPos;      // xyz, size
attribute vec4 iData;     // alpha, rotation, shade, unused
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
varying float vFog;
uniform float fogNear;
uniform float fogFar;
void main() {
  vUv = uv;
  vAlpha = iData.x;
  vShade = iData.z;
  vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
  float c = cos(iData.y), s = sin(iData.y);
  vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  mv.xy += corner * iPos.w;
  vFog = smoothstep(fogNear, fogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const SMOKE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 lightColor;
uniform vec3 ambient;
uniform vec3 fogColor;
uniform vec3 tint;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
varying float vFog;
void main() {
  vec4 t = texture2D(map, vUv);
  // fake self-shadowing: darker at the bottom of each puff
  float lit = mix(0.55, 1.0, vUv.y) * vShade;
  vec3 col = tint * (ambient + lightColor * lit * 0.6);
  col = mix(col, fogColor, vFog);
  gl_FragColor = vec4(col, t.a * vAlpha);
  if (gl_FragColor.a < 0.004) discard;
}`;

interface Puff {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number; life: number; size: number; grow: number; alpha: number; rot: number; spin: number; shade: number;
  alive: boolean;
}

export class SmokeSystem {
  readonly mesh: THREE.Mesh;
  private puffs: Puff[] = [];
  private iPos: THREE.InstancedBufferAttribute;
  private iData: THREE.InstancedBufferAttribute;
  private next = 0;
  private geo: THREE.InstancedBufferGeometry;
  readonly material: THREE.ShaderMaterial;
  wind = new THREE.Vector3(0.8, 0, 0.4);

  constructor(public capacity: number) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.iPos.setUsage(THREE.DynamicDrawUsage);
    this.iData.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iData', this.iData);
    this.geo.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: {
        map: { value: smokeTexture() },
        lightColor: { value: new THREE.Color(1, 1, 1) },
        ambient: { value: new THREE.Color(0.6, 0.62, 0.66) },
        fogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
        fogNear: { value: 150 },
        fogFar: { value: 1400 },
        tint: { value: new THREE.Color(0.92, 0.92, 0.92) },
      },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    for (let i = 0; i < capacity; i++) this.puffs.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 0, size: 1, grow: 1, alpha: 0, rot: 0, spin: 0, shade: 1, alive: false });
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, amount: number, kind: 'smoke' | 'dust' | 'grass' = 'smoke'): void {
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % this.capacity;
    p.x = x + (Math.random() - 0.5) * 0.3;
    p.y = y + 0.15;
    p.z = z + (Math.random() - 0.5) * 0.3;
    p.vx = vx * 0.18 + (Math.random() - 0.5) * 1.6;
    p.vy = 0.5 + Math.random() * 0.8;
    p.vz = vz * 0.18 + (Math.random() - 0.5) * 1.6;
    p.age = 0;
    p.life = (kind === 'smoke' ? 2.4 + Math.random() * 2.2 : 1.2 + Math.random()) * (0.6 + amount * 0.6);
    p.size = 0.7 + Math.random() * 0.5;
    p.grow = kind === 'smoke' ? 2.4 + Math.random() * 1.6 : 1.4;
    p.alpha = (kind === 'smoke' ? 0.42 : 0.5) * Math.min(1, amount);
    p.rot = Math.random() * Math.PI * 2;
    p.spin = (Math.random() - 0.5) * 0.8;
    p.shade = kind === 'dust' ? 0.75 : kind === 'grass' ? 0.6 : 1;
    p.alive = true;
  }

  update(dt: number): void {
    let n = 0;
    const P = this.iPos.array as Float32Array, D = this.iData.array as Float32Array;
    for (const p of this.puffs) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      const k = p.age / p.life;
      const drag = Math.exp(-dt * 1.4);
      p.vx = p.vx * drag + this.wind.x * dt * 0.8;
      p.vz = p.vz * drag + this.wind.z * dt * 0.8;
      p.vy = p.vy * Math.exp(-dt * 0.6) + dt * 0.05;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const size = p.size + p.grow * Math.sqrt(k) * 3;
      const fadeIn = Math.min(1, p.age * 5);
      P[n * 4] = p.x;
      P[n * 4 + 1] = p.y + size * 0.3;
      P[n * 4 + 2] = p.z;
      P[n * 4 + 3] = size;
      D[n * 4] = p.alpha * fadeIn * (1 - k) * (1 - k * 0.3);
      D[n * 4 + 1] = p.rot;
      D[n * 4 + 2] = p.shade;
      n++;
    }
    this.geo.instanceCount = n;
    this.iPos.needsUpdate = true;
    this.iData.needsUpdate = true;
    this.iPos.addUpdateRange(0, n * 4);
    this.iData.addUpdateRange(0, n * 4);
  }

  clear(): void {
    for (const p of this.puffs) p.alive = false;
    this.geo.instanceCount = 0;
  }
}

// ------------------------------------------------------------------ skid marks

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private geo = new THREE.BufferGeometry();
  private idx = 0;
  private count = 0;
  private last: ({ x: number; y: number; z: number; lx: number; lz: number; a: number } | null)[] = [];

  constructor(private max = 9000) {
    this.pos = new Float32Array(max * 6 * 3);
    this.col = new Float32Array(max * 6 * 4);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Add to the mark of wheel `id`. Pass on = false to lift the pen. */
  add(id: number, x: number, y: number, z: number, dirX: number, dirZ: number, width: number, strength: number, on: boolean): void {
    if (!on || strength <= 0.02) {
      this.last[id] = null;
      return;
    }
    const l = Math.hypot(dirX, dirZ) || 1;
    const lx = -dirZ / l, lz = dirX / l;
    const prev = this.last[id];
    const a = Math.min(0.75, strength * 0.8);
    if (prev) {
      const d2 = (x - prev.x) ** 2 + (z - prev.z) ** 2;
      if (d2 < 0.12) return;
      if (d2 > 9) {
        this.last[id] = { x, y, z, lx, lz, a };
        return;
      }
      const w = width / 2;
      const o = this.idx * 18;
      const P = this.pos;
      const v = [
        prev.x + prev.lx * w, prev.y, prev.z + prev.lz * w,
        prev.x - prev.lx * w, prev.y, prev.z - prev.lz * w,
        x - lx * w, y, z - lz * w,
        prev.x + prev.lx * w, prev.y, prev.z + prev.lz * w,
        x - lx * w, y, z - lz * w,
        x + lx * w, y, z + lz * w,
      ];
      for (let i = 0; i < 18; i++) P[o + i] = v[i];
      const C = this.col;
      const co = this.idx * 24;
      const alphas = [prev.a, prev.a, a, prev.a, a, a];
      for (let i = 0; i < 6; i++) {
        C[co + i * 4] = 0.03;
        C[co + i * 4 + 1] = 0.03;
        C[co + i * 4 + 2] = 0.035;
        C[co + i * 4 + 3] = alphas[i];
      }
      this.idx = (this.idx + 1) % this.max;
      this.count = Math.min(this.max, this.count + 1);
      this.geo.setDrawRange(0, this.count * 6);
      (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
    this.last[id] = { x, y, z, lx, lz, a };
  }

  clear(): void {
    this.count = 0;
    this.idx = 0;
    this.last = [];
    this.geo.setDrawRange(0, 0);
  }
}

// ------------------------------------------------------------------ cones (knockable props)

import type { Cone } from '../world/scenery';
import type { Vehicle } from '../physics/vehicle';

export class ConeField {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  onKnock: ((c: Cone, speed: number) => void) | null = null;

  constructor(public cones: Cone[], private track: Track) {
    const geo = new THREE.ConeGeometry(0.17, 0.62, 14);
    geo.translate(0, 0.37, 0);
    const base = new THREE.BoxGeometry(0.42, 0.05, 0.42);
    base.translate(0, 0.025, 0);
    const merged = mergeTwo(geo, base);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.55 });
    this.mesh = new THREE.InstancedMesh(merged, mat, Math.max(1, cones.length));
    this.mesh.count = cones.length;
    this.mesh.castShadow = true;
    for (const c of cones) c.home.y = c.pos.y = track.height(c.home.x, c.home.z);
    this.sync();
  }

  reset(): void {
    for (const c of this.cones) {
      c.pos.copy(c.home);
      c.vel.set(0, 0, 0);
      c.rot.set(0, 0, 0);
      c.hit = false;
    }
    this.sync();
  }

  update(dt: number, car: Vehicle): void {
    const cp = car.position;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
    const hl = car.spec.length / 2 + 0.15, hw = car.spec.width / 2 + 0.15;
    for (const c of this.cones) {
      const dx = c.pos.x - cp.x, dz = c.pos.z - cp.z;
      if (dx * dx + dz * dz < 16 && c.pos.y < cp.y + 0.6) {
        const lz = dx * fwd.x + dz * fwd.z, lx = dx * fwd.z - dz * fwd.x;
        if (Math.abs(lz) < hl && Math.abs(lx) < hw && car.telemetry.speed > 0.8) {
          const d = Math.hypot(dx, dz) || 1;
          c.vel.set(car.velocity.x * 1.1 + (dx / d) * 2.5, 2 + Math.random() * 3 + car.telemetry.speed * 0.15, car.velocity.z * 1.1 + (dz / d) * 2.5);
          c.spin = (Math.random() - 0.5) * 16;
          if (!c.hit) this.onKnock?.(c, car.telemetry.speed);
          c.hit = true;
        }
      }
      if (c.hit) {
        c.vel.y -= 9.81 * dt;
        c.pos.addScaledVector(c.vel, dt);
        const g = this.track.height(c.pos.x, c.pos.z);
        if (c.pos.y < g) {
          c.pos.y = g;
          c.vel.y = -c.vel.y * 0.3;
          c.vel.x *= 0.78;
          c.vel.z *= 0.78;
          c.spin *= 0.7;
          if (Math.abs(c.vel.y) < 0.5) c.vel.y = 0;
        }
        c.rot.x += c.spin * dt;
        c.rot.z = Math.min(Math.PI / 2, c.rot.z + Math.abs(c.spin) * dt * 0.4);
      }
    }
    this.sync();
  }

  private sync(): void {
    for (const c of this.cones) {
      this.q.setFromEuler(c.rot);
      this.m.compose(c.pos, this.q, this.s);
      this.mesh.setMatrixAt(c.index, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const A = a.toNonIndexed(), B = b.toNonIndexed();
  const pos = new Float32Array(A.getAttribute('position').count * 3 + B.getAttribute('position').count * 3);
  pos.set(A.getAttribute('position').array as Float32Array, 0);
  pos.set(B.getAttribute('position').array as Float32Array, A.getAttribute('position').count * 3);
  const nor = new Float32Array(pos.length);
  nor.set(A.getAttribute('normal').array as Float32Array, 0);
  nor.set(B.getAttribute('normal').array as Float32Array, A.getAttribute('normal').count * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
