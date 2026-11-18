import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makePaintMaterial, applyPaintToTextured, type PaintFinish } from './paint';
import { plateTexture } from '../render/textures';

// One loader for every imported car model. It normalises scale, orientation and ground
// height, finds the four wheels and re-parents each into a pivot at its own centre, swaps the
// body paint for our car-paint material, hides real branding and tags the light materials.

export interface ModelDef {
  /** path under public/assets/models/ */
  file: string;
  /** which end of the raw model is the front */
  forward: '+z' | '-z';
  /** real-world length in metres the model is scaled to */
  length: number;
  /** optional width/height targets for toy-proportioned models (scaled per axis, wheels kept round) */
  width?: number;
  height?: number;
  /** wheel node names [FL, FR, RL, RR]; a rear entry may be shared (one node for the axle). Omit for auto-detect. */
  wheels?: [string, string, string, string];
  /** material names that are body paint (untextured models) */
  paintMaterials?: string[];
  /** for atlas-textured models: the texel colour that marks body paint, and how far from it still counts */
  paintKey?: [number, number, number];
  paintTolerance?: number;
  /** node or material name fragments to hide (real badges, toy parts) */
  hide?: string[];
  /** material names that are number plates (replaced by our fictional plate) */
  plates?: string[];
  headMaterials?: string[];
  tailMaterials?: string[];
  /** add a roof panel in body colour (models that ship without one) */
  addRoof?: { y: number; z0: number; z1: number; halfWidth: number };
}

export interface WheelSlot {
  /** pivot at the wheel centre (model space); steer rotates this about Y */
  pivot: THREE.Group;
  /** spins about X */
  spin: THREE.Group;
  /** rest centre in model space */
  center: THREE.Vector3;
  radius: number;
  /** true for an empty slot whose geometry lives on the other side's pivot (shared axle) */
  shared: boolean;
}

export interface ModelDims {
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheelRadius: number;
  /** model-space z of the front and rear axle (front is +z) */
  frontAxleZ: number;
  rearAxleZ: number;
}

export interface LoadedCarModel {
  /** model space: +Z forward, +X left, ground at y = 0, axle midpoint at z = 0 */
  root: THREE.Group;
  wheels: WheelSlot[];
  paintMaterials: THREE.Material[];
  headMaterials: THREE.MeshStandardMaterial[];
  tailMaterials: THREE.MeshStandardMaterial[];
  dims: ModelDims;
  setPaint(color: string, finish: PaintFinish): void;
}

const BASE = import.meta.env.BASE_URL ?? './';
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

export function modelUrl(file: string): string {
  return `${BASE}assets/models/${file}`;
}

function loadScene(file: string): Promise<THREE.Group> {
  let p = cache.get(file);
  if (!p) {
    p = loader.loadAsync(modelUrl(file)).then((g) => g.scene as THREE.Group);
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p;
}

/** Preload a set of files (used by the loading screen). */
export async function preload(files: string[], onProgress?: (f: number) => void): Promise<void> {
  let done = 0;
  await Promise.all(
    files.map((f) =>
      loadScene(f)
        .catch(() => undefined)
        .finally(() => onProgress?.(++done / files.length)),
    ),
  );
}

function matName(m: THREE.Material | THREE.Material[]): string[] {
  return (Array.isArray(m) ? m : [m]).map((x) => x.name ?? '');
}

const tmpBox = new THREE.Box3();

/** World-space bounds of an object (after root matrices are updated). */
function boundsOf(o: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(o, true);
}

/** Load a car model and return a fresh, independent instance ready to drive. */
export async function loadCarModel(def: ModelDef): Promise<LoadedCarModel> {
  const template = await loadScene(def.file);
  const scene = template.clone(true);
  // clone materials so paint changes never leak between instances
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
  });

  const root = new THREE.Group();
  root.name = 'car-model';
  const norm = new THREE.Group();
  norm.add(scene);
  root.add(norm);

  // hide branding / unwanted parts
  const hide = (def.hide ?? []).map((h) => h.toLowerCase());
  scene.traverse((o) => {
    const n = (o.name ?? '').toLowerCase();
    if (hide.some((h) => n.includes(h))) o.visible = false;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && matName(mesh.material).some((mn) => hide.some((h) => mn.toLowerCase().includes(h)))) {
      // hide only that material's faces: swap it for an invisible material
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const repl = mats.map((x) => (hide.some((h) => (x.name ?? '').toLowerCase().includes(h)) ? new THREE.MeshBasicMaterial({ visible: false }) : x));
      mesh.material = Array.isArray(mesh.material) ? repl : repl[0];
    }
  });

  // orientation + scale
  if (def.forward === '-z') norm.rotation.y = Math.PI;
  root.updateMatrixWorld(true);
  let box = boundsOf(scene);
  const rawLen = box.max.z - box.min.z;
  const s = def.length / rawLen;
  norm.scale.setScalar(s);
  if (def.width || def.height) {
    const sz = box.getSize(new THREE.Vector3());
    norm.scale.set(def.width ? def.width / sz.x : s, def.height ? def.height / sz.y : s, s);
  }
  root.updateMatrixWorld(true);

  // wheels
  const wheelNodes = findWheels(scene, def);
  box = boundsOf(scene);
  const centers: THREE.Vector3[] = [];
  const radii: number[] = [];
  const shared: boolean[] = [false, false, false, false];
  for (let i = 0; i < 4; i++) {
    const node = wheelNodes[i];
    if (!node) {
      centers.push(new THREE.Vector3());
      radii.push(0);
      continue;
    }
    const b = boundsOf(node);
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    radii.push(size.y / 2);
    // a shared axle node (both rears) sits in the middle; place each side at the outer edge
    if (i >= 2 && wheelNodes[2] === wheelNodes[3]) {
      const side = i === 2 ? 1 : -1;
      c.x = c.x + side * (size.x / 2 - Math.min(size.y, size.z) * 0.18);
      shared[i] = i === 3;
    }
    centers.push(c);
  }
  // fall back to the bounding box if wheel detection failed
  if (!wheelNodes[0] || !wheelNodes[2]) {
    const len = box.max.z - box.min.z, wid = box.max.x - box.min.x;
    const r = (box.max.y - box.min.y) * 0.24;
    const zf = box.min.z + len * 0.8, zr = box.min.z + len * 0.2;
    const x = wid * 0.4;
    const pts = [[x, zf], [-x, zf], [x, zr], [-x, zr]];
    pts.forEach(([px, pz], i) => {
      centers[i] = new THREE.Vector3(px, box.min.y + r, pz);
      radii[i] = r;
    });
  }

  // ground the tires on y = 0 and centre between the axles
  const tireBottom = Math.min(...centers.map((c, i) => c.y - radii[i]));
  const midX = (centers[0].x + centers[1].x + centers[2].x + centers[3].x) / 4;
  const frontZ = (centers[0].z + centers[1].z) / 2, rearZ = (centers[2].z + centers[3].z) / 2;
  const midZ = (frontZ + rearZ) / 2;
  const shift = new THREE.Vector3(-midX, -tireBottom, -midZ);
  norm.position.add(shift);
  for (const c of centers) c.add(shift);
  root.updateMatrixWorld(true);

  // re-parent wheels into pivots
  const wheels: WheelSlot[] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.name = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'][i];
    const spin = new THREE.Group();
    pivot.add(spin);
    pivot.position.copy(centers[i]);
    // shared rear axle: spin around the axle midpoint, so put the pivot there for the owner
    if (i === 2 && wheelNodes[2] && wheelNodes[2] === wheelNodes[3]) pivot.position.x = (centers[2].x + centers[3].x) / 2;
    root.add(pivot);
    root.updateMatrixWorld(true);
    const node = wheelNodes[i];
    if (node && !shared[i]) {
      spin.attach(node);
      // per-axis scaled bodies must not squash the wheels: make the wheel's scale uniform
      if (def.width || def.height) {
        const ws = node.getWorldScale(new THREE.Vector3());
        const u = ws.y;
        node.scale.multiply(new THREE.Vector3(1, 1, u / ws.z));
      }
    }
    wheels.push({ pivot, spin, center: pivot.position.clone(), radius: radii[i], shared: shared[i] });
  }

  // paint
  const paintMaterials: THREE.Material[] = [];
  const paintNames = new Set(def.paintMaterials ?? []);
  const headNames = new Set(def.headMaterials ?? []);
  const tailNames = new Set(def.tailMaterials ?? []);
  const plateNames = new Set(def.plates ?? []);
  const headMaterials: THREE.MeshStandardMaterial[] = [];
  const tailMaterials: THREE.MeshStandardMaterial[] = [];
  const swapped = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = mats.map((m) => {
      if (swapped.has(m)) return swapped.get(m)!;
      let r: THREE.Material = m;
      const std = m as THREE.MeshStandardMaterial;
      if (paintNames.has(m.name)) {
        const p = makePaintMaterial(std.color ? '#' + std.color.getHexString() : '#c8102e', 'metallic', true);
        p.name = m.name;
        paintMaterials.push(p);
        r = p;
      } else if (def.paintKey && std.map) {
        const p = applyPaintToTextured(std, def.paintKey, def.paintTolerance ?? 0.18);
        paintMaterials.push(p);
        r = p;
      } else if (plateNames.has(m.name)) {
        r = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.4 });
      } else if (/glass|window/i.test(m.name)) {
        r = new THREE.MeshPhysicalMaterial({ color: 0x0b1117, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.7, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.02, name: m.name });
      } else if (std.isMeshStandardMaterial) {
        // imported models are often fully rough; give trim and rims some life under the env map
        if (/rim|chrome|metal|grey|gray/i.test(m.name)) {
          std.metalness = Math.max(std.metalness, 0.7);
          std.roughness = Math.min(std.roughness, 0.35);
        }
        std.envMapIntensity = 1;
      }
      if (headNames.has(m.name)) {
        const hm = (r === m ? (r = std.clone()) : r) as THREE.MeshStandardMaterial;
        hm.emissive = new THREE.Color(0xfff1d6);
        hm.emissiveIntensity = 0.05;
        headMaterials.push(hm);
      }
      if (tailNames.has(m.name)) {
        const tm = (r === m ? (r = std.clone()) : r) as THREE.MeshStandardMaterial;
        tm.emissive = new THREE.Color(0xff1020);
        tm.emissiveIntensity = 0.25;
        tailMaterials.push(tm);
      }
      swapped.set(m, r);
      return r;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
  });

  if (def.addRoof) {
    const r = def.addRoof;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(r.halfWidth * 2, 0.04, r.z1 - r.z0), paintMaterials[0] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    roof.position.set(0, r.y, (r.z0 + r.z1) / 2);
    roof.castShadow = true;
    root.add(roof);
  }

  root.updateMatrixWorld(true);
  const fb = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.visible) fb.union(tmpBox.setFromObject(mesh, true));
  });
  const fs = fb.getSize(new THREE.Vector3());
  const dims: ModelDims = {
    length: fs.z,
    width: fs.x,
    height: fs.y,
    wheelbase: (centers[0].z + centers[1].z) / 2 - (centers[2].z + centers[3].z) / 2,
    trackFront: Math.abs(centers[0].x - centers[1].x),
    trackRear: Math.abs(centers[2].x - centers[3].x),
    wheelRadius: (radii[0] + radii[1] + radii[2] + radii[3]) / 4,
    frontAxleZ: (centers[0].z + centers[1].z) / 2,
    rearAxleZ: (centers[2].z + centers[3].z) / 2,
  };

  return {
    root,
    wheels,
    paintMaterials,
    headMaterials,
    tailMaterials,
    dims,
    setPaint(color, finish) {
      for (const m of paintMaterials) (m as THREE.Material & { setPaint?: (c: string, f: PaintFinish) => void }).setPaint?.(color, finish);
    },
  };
}

/** Find FL, FR, RL, RR wheel nodes by name, else by shape and position. */
function findWheels(scene: THREE.Object3D, def: ModelDef): (THREE.Object3D | null)[] {
  scene.updateMatrixWorld(true);
  if (def.wheels) {
    return def.wheels.map((n) => scene.getObjectByName(n) ?? findByPrefix(scene, n));
  }
  const all = boundsOf(scene);
  const size = all.getSize(new THREE.Vector3());
  const cands: { o: THREE.Object3D; c: THREE.Vector3; s: THREE.Vector3 }[] = [];
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh || o === scene) return;
    const b = boundsOf(o);
    const s = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    const round = Math.abs(s.y - s.z) < 0.15 * Math.max(s.y, s.z);
    const narrow = s.x < Math.max(s.y, s.z) * 0.9;
    const low = c.y < all.min.y + size.y * 0.45;
    const outer = Math.abs(c.x - (all.min.x + all.max.x) / 2) > size.x * 0.25;
    const sizable = s.y > size.y * 0.25;
    if (round && narrow && low && outer && sizable) cands.push({ o, c, s });
  });
  // keep the largest candidate per corner
  const mid = all.getCenter(new THREE.Vector3());
  const corner = (c: THREE.Vector3) => (c.z > mid.z ? 0 : 2) + (c.x > mid.x ? 0 : 1);
  const best: ({ o: THREE.Object3D; s: THREE.Vector3 } | null)[] = [null, null, null, null];
  for (const cd of cands) {
    const k = corner(cd.c);
    if (!best[k] || cd.s.y > best[k]!.s.y) best[k] = cd;
  }
  return best.map((b) => b?.o ?? null);
}

function findByPrefix(scene: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  scene.traverse((o) => {
    if (!hit && o.name && (o.name.startsWith(name) || o.name.includes(name))) hit = o;
  });
  return hit;
}
