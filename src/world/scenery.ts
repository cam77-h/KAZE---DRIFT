import * as THREE from 'three';
import type { Track } from './track';
import { bannerTexture, lineTexture, signTexture } from '../render/textures';
import { Noise } from './track';

// Lived-in scenery for a location, all instanced where it repeats.

interface SceneryDef {
  theme?: string;
  stands?: { x: number; z: number; rot: number; len: number }[];
  trees?: { count: number; minDist: number; radius: number };
  circles?: number[];
  cones?: boolean;
}

export interface SceneryResult {
  group: THREE.Group;
  lamps: THREE.MeshStandardMaterial[];
  cones: Cone[];
}

export interface Cone {
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: number;
  hit: boolean;
  index: number;
}

let rngState = 1;
function rnd(): number {
  rngState = (rngState * 16807) % 2147483647;
  return (rngState - 1) / 2147483646;
}

export function buildScenery(track: Track, density: number): SceneryResult {
  const def = (track.def.scenery ?? {}) as SceneryDef;
  rngState = 4242;
  const group = new THREE.Group();
  group.name = 'scenery';
  const lamps: THREE.MeshStandardMaterial[] = [];
  const cones: Cone[] = [];

  if (def.trees) group.add(forest(track, Math.round(def.trees.count * density), def.trees.minDist, def.trees.radius));
  for (const s of def.stands ?? []) group.add(grandstand(track, s.x, s.z, s.rot, s.len));

  if (def.theme === 'mountain-park') {
    group.add(paddockBuildings(track, lamps));
    group.add(startGantry(track));
    group.add(lightPoles(track, lamps));
  }
  if (def.theme === 'port') {
    group.add(portCranes(track, lamps));
    if (def.cones) cones.push(...portCones(track));
  }
  if (def.theme === 'skidpad') {
    group.add(skidpadMarkings(track, def.circles ?? []));
    group.add(controlTower(track, lamps));
    group.add(lightPolesRing(track, 130, 10, lamps));
    if (def.cones) cones.push(...coneLayout());
  }
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = o.castShadow || false;
      o.receiveShadow = true;
    }
  });
  return { group, lamps, cones };
}

/** Cedar and broadleaf trees scattered away from the roads, denser on the hillsides. */
function forest(track: Track, count: number, minDist: number, radius: number): THREE.Group {
  const g = new THREE.Group();
  const noise = new Noise(99);
  const cedarFoliage = new THREE.ConeGeometry(1, 1, 7, 1);
  cedarFoliage.translate(0, 0.5, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const broad = new THREE.IcosahedronGeometry(1, 1);
  const cedarMat = new THREE.MeshStandardMaterial({ color: 0x2d4a2a, roughness: 0.95, flatShading: true });
  const broadMat = new THREE.MeshStandardMaterial({ color: 0x4d6b34, roughness: 0.95, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
  const cedars: THREE.Matrix4[] = [], broads: THREE.Matrix4[] = [], trunks: THREE.Matrix4[] = [];
  const cedarCols: THREE.Color[] = [], broadCols: THREE.Color[] = [];
  let tries = 0;
  const cx = track.def.spawn.x * 0.2, cz = track.def.spawn.z * 0.2;
  while (cedars.length + broads.length < count && tries < count * 12) {
    tries++;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    // clumping
    if (noise.fbm(x / 60, z / 60, 3) < -0.05) continue;
    const loc = track.locate(x, z);
    if (loc && Math.abs(loc.lateral) - loc.road.samples[0].halfWidth < minDist) continue;
    let onPad = false;
    for (const p of track.def.pads) {
      const d = p.shape === 'circle' ? Math.hypot(x - p.x, z - p.z) - (p.r ?? 0) : Math.max(Math.abs(x - p.x) - (p.w ?? 0) / 2, Math.abs(z - p.z) - (p.d ?? 0) / 2);
      if (d < minDist) onPad = true;
    }
    if (onPad) continue;
    const y = track.height(x, z);
    const s = 0.75 + rnd() * 0.7;
    const isCedar = rnd() < 0.62;
    const h = isCedar ? 9 + rnd() * 7 : 5 + rnd() * 4;
    const tm = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.2, z), new THREE.Quaternion(), new THREE.Vector3(s, isCedar ? h * 0.35 : h * 0.45, s));
    trunks.push(tm);
    if (isCedar) {
      cedars.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + h * 0.18, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), new THREE.Vector3(1.8 * s, h * 0.85, 1.8 * s)));
      cedarCols.push(new THREE.Color().setHSL(0.3 + rnd() * 0.05, 0.35 + rnd() * 0.15, 0.17 + rnd() * 0.08));
    } else {
      const rr = 2.2 + rnd() * 1.6;
      broads.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + h * 0.62, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), new THREE.Vector3(rr * s, rr * 0.8 * s, rr * s)));
      broadCols.push(new THREE.Color().setHSL(0.22 + rnd() * 0.08, 0.4 + rnd() * 0.2, 0.24 + rnd() * 0.1));
    }
  }
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], cols?: THREE.Color[]) => {
    const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((m, i) => {
      inst.setMatrixAt(i, m);
      if (cols) inst.setColorAt(i, cols[i]);
    });
    inst.count = list.length;
    inst.castShadow = true;
    inst.receiveShadow = true;
    return inst;
  };
  g.add(mk(trunkGeo, trunkMat, trunks), mk(cedarFoliage, cedarMat, cedars, cedarCols), mk(broad, broadMat, broads, broadCols));
  g.name = 'forest';
  return g;
}

function grandstand(track: Track, x: number, z: number, rot: number, len: number): THREE.Group {
  const g = new THREE.Group();
  const y = track.height(x, z);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa8a59d, roughness: 0.9 });
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.45, 0.9), concrete);
    step.position.set(0, 0.45 * i + 0.22, -0.9 * i);
    step.castShadow = true;
    g.add(step);
  }
  // back wall + roof
  const back = new THREE.Mesh(new THREE.BoxGeometry(len, 4.5, 0.3), concrete);
  back.position.set(0, 2.25, -0.9 * steps);
  g.add(back);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 1, 0.2, 7.5), new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.6, metalness: 0.4 }));
  roof.position.set(0, 5.4, -0.9 * steps + 3.4);
  roof.rotation.x = 0.06;
  roof.castShadow = true;
  g.add(roof);
  for (const sx of [-len / 2, len / 2]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5.4, 0.25), roof.material);
    col.position.set(sx, 2.7, -0.9 * steps + 0.2);
    g.add(col);
  }
  // spectators: simple low-poly figures with varied clothing
  const body = new THREE.CapsuleGeometry(0.2, 0.55, 3, 6);
  body.translate(0, 0.5, 0);
  const head = new THREE.SphereGeometry(0.13, 6, 5);
  head.translate(0, 1.1, 0);
  const people = Math.floor(len * steps * 0.45);
  const bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.9 }), people);
  const heads = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.8 }), people);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const palette = [0x1c2a44, 0xe8202f, 0xf2efe6, 0x22252a, 0xf39c32, 0x3b5a3a, 0xf6a5c0, 0x6a6f78];
  for (let i = 0; i < people; i++) {
    const row = Math.floor(rnd() * steps);
    m.makeTranslation((rnd() - 0.5) * (len - 1), 0.45 * (row + 1), -0.9 * row - 0.1);
    bodies.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    bodies.setColorAt(i, c.set(palette[Math.floor(rnd() * palette.length)]));
  }
  g.add(bodies, heads);
  // sponsor banner along the front
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(len, 18), 1.2), new THREE.MeshStandardMaterial({ map: bannerTexture('HOSHI RACING', 'ホシレーシング · since 1987', '#0d1a2b', '#f2efe6', '#e8202f'), roughness: 0.6 }));
  banner.position.set(0, 0.6, 0.47);
  g.add(banner);
  g.position.set(x, y, z);
  g.rotation.y = rot;
  return g;
}

function paddockBuildings(track: Track, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  const pad = track.def.pads.find((p) => p.id === 'paddock');
  if (!pad) return g;
  const y = pad.y;
  const wall = new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 0.7, metalness: 0.3 });
  const brands: [string, string, string, string, string][] = [
    ['KUMO WHEELS', 'クモホイール · forged in Hamamatsu', '#f2efe6', '#0d1a2b', '#f39c32'],
    ['TORA WORKS', 'トラワークス · exhaust & intake', '#111317', '#f39c32', '#e8202f'],
    ['SHIN-KAZE', '新風エンジニアリング · turbo kits', '#e8202f', '#f2efe6', '#0d1a2b'],
    ['YORU GARAGE', '夜ガレージ · drift setups', '#0d1a2b', '#f6a5c0', '#f6a5c0'],
  ];
  const w = pad.w ?? 100;
  const n = brands.length;
  for (let i = 0; i < n; i++) {
    const bx = pad.x - w / 2 + 14 + i * ((w - 28) / (n - 1));
    const bz = pad.z - (pad.d ?? 40) / 2 - 6;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(18, 6, 12), wall);
    shell.position.set(bx, y + 3, bz);
    shell.castShadow = true;
    g.add(shell);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.2), dark);
    door.position.set(bx, y + 2.1, bz + 6.01);
    g.add(door);
    // roller-door ribs
    for (let k = 0; k < 10; k++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(13, 0.05, 0.04), wall);
      rib.position.set(bx, y + 0.3 + k * 0.4, bz + 6.03);
      g.add(rib);
    }
    const [t, sub, bg, fg, ac] = brands[i];
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshStandardMaterial({ map: bannerTexture(t, sub, bg, fg, ac), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0, emissiveMap: bannerTexture(t, sub, bg, fg, ac) }));
    sign.position.set(bx, y + 5.0, bz + 6.05);
    lamps.push(sign.material as THREE.MeshStandardMaterial);
    g.add(sign);
  }
  // vending machines (glowing panels at night)
  for (let i = 0; i < 3; i++) {
    const vm = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1.85, 0.8), new THREE.MeshStandardMaterial({ color: i === 1 ? 0xe8202f : 0xf2efe6, roughness: 0.5 }));
    box.position.y = 0.925;
    vm.add(box);
    const panel = new THREE.MeshStandardMaterial({ map: vendingTexture(i), emissive: 0xffffff, emissiveMap: vendingTexture(i), emissiveIntensity: 0.15, roughness: 0.3 });
    lamps.push(panel);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.2), panel);
    face.position.set(0, 1.15, 0.41);
    vm.add(face);
    vm.position.set(pad.x + w / 2 - 6 - i * 1.1, y, pad.z + (pad.d ?? 40) / 2 - 3);
    vm.rotation.y = Math.PI;
    vm.traverse((o) => (o.castShadow = true));
    g.add(vm);
  }
  return g;
}

const vendCache = new Map<number, THREE.Texture>();
function vendingTexture(v: number): THREE.Texture {
  const hit = vendCache.get(v);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 180;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9f2f7';
  g.fillRect(0, 0, 128, 180);
  const cols = ['#e8202f', '#1f6feb', '#f39c32', '#2fbf71', '#f6a5c0', '#7c4dff', '#111', '#f2c230'];
  for (let r = 0; r < 4; r++)
    for (let k = 0; k < 5; k++) {
      g.fillStyle = cols[(r * 5 + k + v * 3) % cols.length];
      g.fillRect(8 + k * 23, 10 + r * 38, 16, 28);
      g.fillStyle = '#fff';
      g.fillRect(8 + k * 23, 40 + r * 38, 16, 4);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  vendCache.set(v, t);
  return t;
}

function startGantry(track: Track): THREE.Group {
  const g = new THREE.Group();
  const road = track.roads[0];
  if (!road) return g;
  const p = road.samples[Math.floor(road.samples.length * 0.03)];
  const span = p.halfWidth * 2 + 6;
  const steel = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.6, roughness: 0.5 });
  for (const s of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), steel);
    leg.position.set(s * span / 2, 3.5, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 2.2, 0.5), steel);
  beam.position.set(0, 7.2, 0);
  g.add(beam);
  for (const side of [1, -1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.9, 2), new THREE.MeshStandardMaterial({ map: signTexture('南ドリフトパーク', 'MINAMI DRIFT PARK', '#0d1a2b', '#f2efe6', '#e8202f', (span * 0.9) / 2), roughness: 0.6 }));
    sign.position.set(0, 7.2, side * 0.26);
    if (side < 0) sign.rotation.y = Math.PI;
    g.add(sign);
  }
  const y = track.height(p.x, p.z);
  g.position.set(p.x, y, p.z);
  // local +X must run across the road (along the left normal)
  g.rotation.y = Math.atan2(-p.lz, p.lx);
  return g;
}

function lightPoles(track: Track, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  const road = track.roads[0];
  if (!road) return g;
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 12, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.5, roughness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.2 });
  lamps.push(lampMat);
  const S = road.samples;
  for (let i = 0; i < S.length; i += 55) {
    const p = S[i];
    const off = p.halfWidth + 9;
    const side = i % 110 === 0 ? 1 : -1;
    const x = p.x + p.lx * off * side, z = p.z + p.lz * off * side;
    if (track.walls.query(x, track.height(x, z) + 0.5, z, { depth: 0, nx: 0, nz: 0, px: 0, pz: 0, wall: null as never })) continue;
    const y = track.height(x, z);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, y + 6, z);
    pole.castShadow = true;
    g.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.7), lampMat);
    head.position.set(x - p.lx * side * 0.9, y + 12, z - p.lz * side * 0.9);
    head.rotation.y = Math.atan2(p.lx, p.lz);
    g.add(head);
  }
  return g;
}

function lightPolesRing(track: Track, r: number, n: number, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.5, roughness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.2 });
  lamps.push(lampMat);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = track.height(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 14, 8), poleMat);
    pole.position.set(x, y + 7, z);
    pole.castShadow = true;
    g.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 0.9), lampMat);
    head.position.set(x * 0.99, y + 14, z * 0.99);
    head.rotation.y = -a;
    g.add(head);
  }
  return g;
}

function controlTower(track: Track, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  const x = 0, z = -140;
  const y = track.height(x, z);
  const wall = new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.85 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 9), wall);
  base.position.set(x, y + 2, z);
  const top = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 7), new THREE.MeshStandardMaterial({ color: 0x1c2532, metalness: 0.5, roughness: 0.2 }));
  top.position.set(x, y + 5.5, z);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.2), new THREE.MeshStandardMaterial({ map: signTexture('風テストコース', 'KAZE PROVING GROUND'), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0, emissiveMap: signTexture('風テストコース', 'KAZE PROVING GROUND') }));
  lamps.push(sign.material as THREE.MeshStandardMaterial);
  sign.position.set(x, y + 8.4, z + 3.6);
  g.add(base, top, sign);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function skidpadMarkings(track: Track, radii: number[]): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: lineTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const r of radii) {
    const ring = new THREE.RingGeometry(r - 0.12, r + 0.12, 160, 1);
    ring.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(ring, mat);
    m.position.set(0, track.height(0, 0) + 0.01, 0);
    g.add(m);
  }
  // a figure-eight pair of small circles and a start box
  for (const cx of [-58, 58]) {
    const ring = new THREE.RingGeometry(17.8, 18.1, 96, 1);
    ring.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(ring, mat);
    m.position.set(cx, track.height(cx, 0) + 0.01, 0);
    g.add(m);
  }
  const box = new THREE.RingGeometry(5.6, 5.8, 4, 1, Math.PI / 4);
  box.rotateX(-Math.PI / 2);
  const bm = new THREE.Mesh(box, mat);
  bm.position.set(track.def.spawn.x, 0.01, track.def.spawn.z);
  g.add(bm);
  return g;
}

function coneLayout(): Cone[] {
  const out: Cone[] = [];
  const add = (x: number, z: number) => {
    const home = new THREE.Vector3(x, 0, z);
    out.push({ home, pos: home.clone(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: 0, hit: false, index: out.length });
  };
  for (let i = 0; i < 9; i++) add(-40 + i * 12, 30 + (i % 2) * 4); // slalom
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    add(58 + Math.cos(a) * 3, Math.sin(a) * 3); // donut post
    if (i % 2 === 0) add(-58 + Math.cos(a) * 3, Math.sin(a) * 3);
  }
  for (let i = 0; i < 8; i++) add(-20 + i * 6, -60); // gate line
  return out;
}

/** Two ship-to-shore gantry cranes on the quay and a row of floodlights. */
function portCranes(track: Track, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.4, roughness: 0.5 });
  for (const z of [-20, 90]) {
    const crane = new THREE.Group();
    for (const [x, zz] of [[0, -8], [0, 8], [16, -8], [16, 8]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 34, 1), steel);
      leg.position.set(x, 17, zz);
      crane.add(leg);
    }
    const boom = new THREE.Mesh(new THREE.BoxGeometry(70, 2.4, 3), steel);
    boom.position.set(10, 34, 0);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), new THREE.MeshStandardMaterial({ color: 0x2b3440 }));
    cab.position.set(20, 31, 0);
    crane.add(boom, cab);
    crane.traverse((o) => (o.castShadow = true));
    crane.position.set(200, track.height(200, z), z);
    g.add(crane);
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.5, roughness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.2 });
  lamps.push(lampMat);
  for (const [x, z] of [[-190, -90], [-190, 180], [220, -90], [220, 180], [10, -95], [10, 185]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 22, 8), poleMat);
    pole.position.set(x, track.height(x, z) + 11, z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 1.2), lampMat);
    head.position.set(x, track.height(x, z) + 22, z);
    g.add(pole, head);
  }
  return g;
}

/** Gymkhana cones: gates at every corner of the course. */
function portCones(track: Track): Cone[] {
  const out: Cone[] = [];
  const road = track.roads[0];
  if (!road) return out;
  const S = road.samples;
  for (let i = 0; i < S.length; i += 9) {
    const p = S[i];
    if (Math.abs(p.curvature) < 1 / 45) continue;
    const inside = Math.sign(p.curvature);
    const lat = inside * (p.halfWidth + 0.6);
    const home = new THREE.Vector3(p.x + p.lx * lat, 0, p.z + p.lz * lat);
    out.push({ home, pos: home.clone(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: 0, hit: false, index: out.length });
  }
  return out;
}
