import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CarDef } from '../data';
import { carPhysics } from '../data';
import { FlatWorld } from '../physics/collision';
import { Vehicle } from '../physics/vehicle';
import { defaultAssists, emptyInput, type CarPhysicsSpec } from '../physics/types';
import { buildCarVisual, fitPhysicsToModel } from '../vehicles/carVisual';
import { CarView } from '../vehicles/carView';
import type { PaintFinish } from '../vehicles/paint';
import { applyBuild, type Build } from '../garage/parts';

// Update 4 §2: the showroom. A dark room with a polished floor, soft spotlights and a slowly
// turning turntable. Cars are real models (paint, parts, stance) settled on their suspension.
// Neighbouring cars are preloaded so browsing is instant.

export interface ShowroomCar {
  key: string;
  def: CarDef;
  paint: string;
  finish: PaintFinish;
  build: Build;
  tune?: Record<string, number>;
}

interface Loaded {
  view: CarView;
  vehicle: Vehicle;
  spec: CarPhysicsSpec;
}

export class Showroom {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private turntable = new THREE.Group();
  private cache = new Map<string, Promise<Loaded>>();
  private current: Loaded | null = null;
  private currentKey = '';
  private world = new FlatWorld();
  // orbit
  private yaw = 0.7;
  private pitch = 0.14;
  private dist = 7.2;
  private idle = 0;
  private panT = 1;
  private panFrom = 0;
  private dragging = false;
  active = false;

  constructor(renderer: THREE.WebGLRenderer, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(36, aspect, 0.1, 200);
    const s = this.scene;
    s.background = new THREE.Color('#07090d');
    s.fog = new THREE.Fog('#07090d', 14, 34);
    const pm = new THREE.PMREMGenerator(renderer);
    s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.55;

    // polished floor: a mirror under a dark, slightly rough tint
    const mirror = new Reflector(new THREE.CircleGeometry(40, 64), { textureWidth: 512, textureHeight: 512, color: 0x6a7280 });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.002;
    s.add(mirror);
    const tint = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: '#0b0e14', roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.84 }));
    tint.rotation.x = -Math.PI / 2;
    s.add(tint);
    // turntable: a brushed disc with a glowing rim
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.45, 0.06, 96), new THREE.MeshStandardMaterial({ color: '#1a1f29', roughness: 0.28, metalness: 0.7 }));
    disc.position.y = 0.03;
    disc.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.43, 0.012, 8, 160), new THREE.MeshBasicMaterial({ color: '#f2a03a' }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.06;
    this.turntable.add(disc, rim);
    s.add(this.turntable);
    // back wall panels with light strips
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 5), new THREE.MeshBasicMaterial({ color: i % 2 ? '#2a3448' : '#3b4a66' }));
      strip.position.set(Math.sin(a) * 16, 2.6, Math.cos(a) * 16);
      strip.lookAt(0, 2.6, 0);
      s.add(strip);
    }
    // lights: a key spot, two rims, a soft fill
    s.add(new THREE.HemisphereLight('#a8b8d8', '#07090d', 0.35));
    const key = new THREE.SpotLight('#fff4e6', 120, 30, 0.5, 0.7, 1.6);
    key.position.set(4, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    s.add(key, key.target);
    for (const [x, c] of [[-7, '#7fa6ff'], [7, '#ffb36b']] as const) {
      const r = new THREE.SpotLight(c, 90, 26, 0.55, 0.8, 1.6);
      r.position.set(x, 5, -6);
      s.add(r, r.target);
    }
    this.bindInput(renderer.domElement);
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  private load(car: ShowroomCar): Promise<Loaded> {
    const hit = this.cache.get(car.key);
    if (hit) return hit;
    const p = (async () => {
      const visual = await buildCarVisual(car.def, car.paint, car.finish);
      const base = carPhysics(car.def.id);
      const spec = applyBuild(base, car.build, car.tune);
      if (visual.kind === 'glb') fitPhysicsToModel(spec, visual.dims);
      const vehicle = new Vehicle(spec, defaultAssists());
      vehicle.reset(this.world, 0, 0, 0);
      const inp = emptyInput();
      inp.handbrake = 1;
      for (let i = 0; i < 150; i++) vehicle.step(1 / 120, inp, this.world);
      const view = new CarView(vehicle, visual, { stance: car.def.visual.stance ?? 0 });
      view.update(1, 1 / 60);
      view.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      return { view, vehicle, spec };
    })();
    this.cache.set(car.key, p);
    // keep the cache small: drop the oldest entries
    if (this.cache.size > 6) {
      const [oldKey, old] = this.cache.entries().next().value as [string, Promise<Loaded>];
      if (oldKey !== this.currentKey) {
        this.cache.delete(oldKey);
        void old.then((l) => l.view.dispose());
      }
    }
    return p;
  }

  preload(cars: ShowroomCar[]): void {
    for (const c of cars) void this.load(c);
  }

  /** Show a car; `dir` (-1/1) pans the camera like sliding to the next bay. */
  async show(car: ShowroomCar, dir = 0): Promise<CarPhysicsSpec> {
    this.currentKey = car.key;
    const l = await this.load(car);
    if (this.currentKey !== car.key) return l.spec;
    if (this.current) this.turntable.remove(this.current.view.group);
    this.current = l;
    this.turntable.add(l.view.group);
    l.view.group.position.set(0, l.vehicle.position.y + 0.06, 0);
    l.view.group.quaternion.identity();
    if (dir) {
      this.panFrom = dir * 1.1;
      this.panT = 0;
    }
    return l.spec;
  }

  /** forget a cached car (paint/parts changed) */
  invalidate(key: string): void {
    const p = this.cache.get(key);
    if (!p) return;
    this.cache.delete(key);
    if (key !== this.currentKey) void p.then((l) => l.view.dispose());
  }

  previewPaint(color: string, finish: PaintFinish): void {
    this.current?.view.setPaint(color, finish);
  }

  resetView(): void {
    this.yaw = 0.7;
    this.pitch = 0.14;
    this.dist = 7.2;
  }

  update(dt: number): void {
    this.idle += dt;
    this.turntable.rotation.y += dt * 0.18;
    if (!this.dragging && this.idle > 3) this.yaw += dt * 0.05;
    this.panT = Math.min(1, this.panT + dt * 2.6);
    const ease = 1 - Math.pow(1 - this.panT, 3);
    const pan = this.panFrom * (1 - ease);
    const c = this.camera;
    // narrow (portrait) screens need the camera further back to fit the car's length
    const dist = this.dist * Math.max(1, 1.3 / this.camera.aspect);
    const y = 0.75 + Math.sin(this.pitch) * dist;
    const r = Math.cos(this.pitch) * dist;
    c.position.set(Math.sin(this.yaw + pan) * r + pan * 2, y, Math.cos(this.yaw + pan) * r);
    c.lookAt(pan * 1.5, 0.62, 0);
    // keep the car left of centre on wide screens so the info panel has room
    const wide = c.aspect > 1.2;
    c.setViewOffset(1000, 1000 / c.aspect, wide ? 140 : 0, wide ? 0 : 90, 1000, 1000 / c.aspect);
  }

  private bindInput(el: HTMLElement): void {
    let lx = 0, ly = 0, pinch = 0;
    const pts = new Map<number, { x: number; y: number }>();
    el.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      this.idle = 0;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.active || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.dist = THREE.MathUtils.clamp(this.dist * (pinch / d), 4.2, 12);
        pinch = d;
        return;
      }
      this.yaw -= (e.clientX - lx) * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - ly) * 0.004, 0.02, 0.9);
      lx = e.clientX;
      ly = e.clientY;
      this.idle = 0;
    });
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      pinch = 0;
      if (!pts.size) this.dragging = false;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.dist = THREE.MathUtils.clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.08), 4.2, 12);
      this.idle = 0;
    }, { passive: true });
    el.addEventListener('dblclick', () => this.active && this.resetView());
  }
}
