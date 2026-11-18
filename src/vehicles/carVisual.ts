import * as THREE from 'three';
import type { CarDef } from '../data';
import type { CarPhysicsSpec } from '../physics/types';
import { buildCarBody } from './carModel';
import { buildWheel } from './wheelModel';
import { s15Shape } from './shapes';
import type { BodyShape } from './profile';
import { loadCarModel, type ModelDims } from './modelLoader';
import { makePaintMaterial, type PaintFinish } from './paint';

/**
 * Everything the game needs from a car's 3D model, whether it was imported (glTF) or built
 * procedurally. Model space: +Z forward, +X left, ground at y = 0.
 */
export interface CarVisual {
  kind: 'glb' | 'procedural';
  root: THREE.Group;
  /** pivots FL, FR, RL, RR (steer about Y); spin groups rotate about X */
  wheels: { pivot: THREE.Group; spin: THREE.Group; spinSign: number; shared: boolean }[];
  dims: ModelDims;
  /** z of the model's front axle in model space; CarView lines it up with the physics */
  frontAxleZ: number;
  headAnchors: THREE.Vector3[];
  setPaint(color: string, finish: PaintFinish): void;
  setHeadlights(on: boolean): void;
  setBrake(level: number, night: boolean): void;
  setReverse(on: boolean): void;
  /** optional steering-wheel node to animate */
  steeringWheel?: THREE.Object3D;
}

const SHAPES: Record<string, (f: number, r: number, wr: number) => BodyShape> = { s15: s15Shape };

export async function buildCarVisual(def: CarDef, paint: string, finish: PaintFinish): Promise<CarVisual> {
  if (def.visual.model === 'glb' && def.visual.glb) {
    try {
      return await glbVisual(def, paint, finish);
    } catch (e) {
      console.warn(`Model for ${def.id} failed to load, using the procedural car instead`, e);
    }
  }
  return proceduralVisual(def.physics, def.visual.model, paint, finish, def.visual.wheelDiameterIn ?? 17);
}

async function glbVisual(def: CarDef, paint: string, finish: PaintFinish): Promise<CarVisual> {
  const m = await loadCarModel(def.visual.glb!);
  m.setPaint(paint, finish);
  const d = m.dims;
  const halfW = d.width * 0.36;
  const frontZ = d.frontAxleZ + (d.length / 2 - (d.frontAxleZ - (d.frontAxleZ + d.rearAxleZ) / 2)) * 0.9;
  const head = m.headMaterials, tail = m.tailMaterials;
  return {
    kind: 'glb',
    root: m.root,
    wheels: m.wheels.map((w) => ({ pivot: w.pivot, spin: w.spin, spinSign: 1, shared: w.shared })),
    dims: d,
    frontAxleZ: d.frontAxleZ,
    headAnchors: [new THREE.Vector3(halfW, d.wheelRadius * 2.0, frontZ), new THREE.Vector3(-halfW, d.wheelRadius * 2.0, frontZ)],
    setPaint: (c, f) => m.setPaint(c, f),
    setHeadlights(on) {
      for (const h of head) h.emissiveIntensity = on ? 3 : 0.05;
    },
    setBrake(level, night) {
      for (const t of tail) t.emissiveIntensity = (night ? 0.9 : 0.25) + level * 2.4;
    },
    setReverse() {
      /* imported models rarely separate reverse lamps */
    },
  };
}

export function proceduralVisual(p: CarPhysicsSpec, shapeId: string, paint: string, finish: PaintFinish, wheelIn: number): CarVisual {
  const shape = (SHAPES[shapeId] ?? s15Shape)(p.cgToFront, p.cgToRear, p.wheelRadius);
  const body = buildCarBody(shape, paint);
  // swap the body paint for the shared car-paint material so finishes work
  const pm = makePaintMaterial(paint, finish);
  body.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((x) => (x === body.materials.paint ? pm : x));
    else if (mesh.material === body.materials.paint) mesh.material = pm;
  });
  const root = new THREE.Group();
  root.add(body.root);
  const shared = {
    rim: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.85, roughness: 0.28 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xd21f2b, metalness: 0.3, roughness: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x131315, roughness: 0.88 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x5b5d61, metalness: 0.9, roughness: 0.45 }),
  };
  const wheels = [0, 1, 2, 3].map((i) => {
    const left = i % 2 === 0;
    const w = buildWheel({ radius: p.wheelRadius, width: 0.225, rimRadius: (wheelIn * 0.0254) / 2, spokes: 6, rimColor: '#c9ccd1', caliperColor: '#d21f2b', design: 'kumo6' }, left ? 1 : -1, shared);
    return { pivot: w.pivot, spin: w.spin, spinSign: w.side, shared: false };
  });
  const mats = body.materials;
  return {
    kind: 'procedural',
    root,
    wheels,
    dims: {
      length: shape.zFront - shape.zRear,
      width: p.width,
      height: p.height,
      wheelbase: p.cgToFront + p.cgToRear,
      trackFront: p.trackFront,
      trackRear: p.trackRear,
      wheelRadius: p.wheelRadius,
      frontAxleZ: p.cgToFront,
      rearAxleZ: -p.cgToRear,
    },
    frontAxleZ: p.cgToFront,
    headAnchors: body.headlightAnchors,
    setPaint: (c, f) => pm.setPaint(c, f),
    setHeadlights(on) {
      mats.headLens.emissiveIntensity = on ? 2.6 : 0;
    },
    setBrake(level, night) {
      mats.tailLens.emissiveIntensity = (night ? 0.9 : 0.25) + level * 2.2;
    },
    setReverse(on) {
      mats.reverse.emissiveIntensity = on ? 1.6 : 0;
    },
    steeringWheel: body.root.getObjectByName('steering-wheel') ?? undefined,
  };
}

/** Make the physics geometry match the model: wheelbase, track, wheel radius, body size. */
export function fitPhysicsToModel(spec: CarPhysicsSpec, d: ModelDims): void {
  const wb = THREE.MathUtils.clamp(d.wheelbase, 2.1, 3.2);
  const frontShare = spec.cgToFront / (spec.cgToFront + spec.cgToRear);
  spec.cgToFront = wb * frontShare;
  spec.cgToRear = wb * (1 - frontShare);
  spec.trackFront = THREE.MathUtils.clamp(d.trackFront, 1.2, 1.85);
  spec.trackRear = THREE.MathUtils.clamp(d.trackRear, 1.2, 1.85);
  spec.wheelRadius = THREE.MathUtils.clamp(d.wheelRadius, 0.26, 0.38);
  spec.length = d.length;
  spec.width = Math.min(2.0, d.width);
  spec.height = d.height;
}
