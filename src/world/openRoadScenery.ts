import * as THREE from 'three';
import type { Track, Road } from './track';
import { bannerTexture, signTexture } from '../render/textures';

// Dressing for the Open Road loop, section by section, plus the activity gates and cameras.

export interface Section { id: string; name: string; jp: string; from: number; to: number; lanes: number; speed: number; density: number; theme: string }
export interface Activity { type: 'driftzone' | 'speedtrap' | 'nearmiss' | 'danger'; id: string; name: string; from?: number; to?: number; at?: number; stars?: number[] }

let seed = 77;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function sampleAt(road: Road, s: number) {
  const S = road.samples;
  const i = Math.max(0, Math.min(S.length - 1, Math.round((s / road.length) * S.length)));
  return S[i];
}

/** Place an object beside the road at distance s, `off` metres to the left (negative = right). */
function besideRoad(track: Track, road: Road, s: number, off: number, obj: THREE.Object3D, face = 1): void {
  const p = sampleAt(road, s);
  const x = p.x + p.lx * off, z = p.z + p.lz * off;
  obj.position.set(x, track.height(x, z), z);
  obj.rotation.y = Math.atan2(p.tx, p.tz) + (face > 0 ? 0 : Math.PI);
}

const facadeCache: THREE.Texture[] = [];
function facadeTexture(v: number): THREE.Texture {
  if (facadeCache[v]) return facadeCache[v];
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  const walls = ['#d8d2c4', '#bfc5c9', '#c9b8a3', '#a9b0b6', '#e2ddd2'];
  g.fillStyle = walls[v % walls.length];
  g.fillRect(0, 0, 128, 256);
  for (let y = 12; y < 256; y += 28)
    for (let x = 10; x < 128; x += 30) {
      const lit = (x * 7 + y * 13 + v * 31) % 5 === 0;
      g.fillStyle = lit ? '#f7d58a' : '#2c3640';
      g.fillRect(x, y, 18, 16);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  facadeCache[v] = t;
  return t;
}

const SHOPS = [['ラーメン', 'RAMEN KOUYA'], ['居酒屋', 'IZAKAYA TOMO'], ['薬局', 'PHARMACY'], ['コンビニ', '24H MART'], ['喫茶', 'KISSA HANA'], ['自動車', 'TORA WORKS']];

export function buildOpenRoadScenery(track: Track): { group: THREE.Group; lamps: THREE.MeshStandardMaterial[] } {
  seed = 77;
  const group = new THREE.Group();
  const lamps: THREE.MeshStandardMaterial[] = [];
  const road = track.roads[0];
  const sections = (track.def.sections ?? []) as Section[];
  const acts = (track.def.activities ?? []) as Activity[];

  for (const sec of sections) {
    if (sec.theme === 'town') group.add(town(track, road, sec, lamps));
    if (sec.theme === 'expressway') group.add(expressway(track, road, sec, lamps));
    if (sec.theme === 'touge') group.add(touge(track, road, sec, lamps));
    if (sec.theme === 'coast') group.add(coast(track, road, sec, lamps));
  }
  for (const a of acts) group.add(activityMarker(track, road, a, lamps));
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
  });
  return { group, lamps };
}

function town(track: Track, road: Road, sec: Section, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  // buildings in rows on both sides
  for (let s = sec.from + 10; s < sec.to - 10; s += 16 + rnd() * 10) {
    for (const side of [1, -1]) {
      if (rnd() < 0.12) continue;
      const p = sampleAt(road, s);
      const w = 10 + rnd() * 8, d = 10 + rnd() * 6, h = 6 + rnd() * 16;
      const v = Math.floor(rnd() * 5);
      const mat = new THREE.MeshStandardMaterial({ map: facadeTexture(v), roughness: 0.85, emissive: 0xffffff, emissiveMap: facadeTexture(v), emissiveIntensity: 0.05 });
      mat.map!.repeat.set(w / 8, h / 8);
      lamps.push(mat);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.castShadow = true;
      const off = side * (p.halfWidth + 5 + d / 2);
      besideRoad(track, road, s, off, b);
      b.position.y += h / 2 - 0.2;
      g.add(b);
      // shop sign at street level
      if (rnd() < 0.6) {
        const [jp, en] = SHOPS[Math.floor(rnd() * SHOPS.length)];
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshStandardMaterial({ map: signTexture(jp, en, '#0d1a2b', '#f2efe6', ['#e8202f', '#f39c32', '#f6a5c0'][v % 3]), emissive: 0xffffff, emissiveIntensity: 0.1, emissiveMap: signTexture(jp, en, '#0d1a2b', '#f2efe6', ['#e8202f', '#f39c32', '#f6a5c0'][v % 3]) }));
        lamps.push(sign.material as THREE.MeshStandardMaterial);
        besideRoad(track, road, s, side * (p.halfWidth + 4.9), sign, -side);
        sign.position.y += 3.4;
        sign.rotation.y += side > 0 ? Math.PI / 2 : -Math.PI / 2;
        g.add(sign);
      }
    }
  }
  // power poles with sagging wires along the left side
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.17, 9, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.9 });
  const tops: THREE.Vector3[] = [];
  for (let s = sec.from; s < sec.to; s += 32) {
    const p = sampleAt(road, s);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    besideRoad(track, road, s, p.halfWidth + 2.2, pole);
    pole.position.y += 4.5;
    pole.castShadow = true;
    g.add(pole);
    tops.push(pole.position.clone().add(new THREE.Vector3(0, 4.2, 0)));
  }
  const wirePts: THREE.Vector3[] = [];
  for (let i = 0; i < tops.length - 1; i++)
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      const p = tops[i].clone().lerp(tops[i + 1], f);
      p.y -= Math.sin(f * Math.PI) * 0.8;
      wirePts.push(p);
    }
  for (const dy of [0, -0.5]) {
    const geo = new THREE.BufferGeometry().setFromPoints(wirePts.map((p) => p.clone().add(new THREE.Vector3(0, dy, 0))));
    g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x1a1a1a })));
  }
  // vending machines
  for (let i = 0; i < 6; i++) {
    const s = sec.from + 60 + i * 140;
    const p = sampleAt(road, s);
    const vm = vendingMachine(i, lamps);
    besideRoad(track, road, s, -(p.halfWidth + 2.4), vm, -1);
    vm.rotation.y += Math.PI / 2;
    g.add(vm);
  }
  return g;
}

function vendingMachine(i: number, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const vm = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1.85, 0.8), new THREE.MeshStandardMaterial({ color: [0xe8202f, 0xf2efe6, 0x1f6feb][i % 3], roughness: 0.5 }));
  box.position.y = 0.925;
  box.castShadow = true;
  vm.add(box);
  const panel = new THREE.MeshStandardMaterial({ color: 0xdfeaf2, emissive: 0xcfe6ff, emissiveIntensity: 0.15, roughness: 0.3 });
  lamps.push(panel);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.2), panel);
  face.position.set(0, 1.15, 0.41);
  vm.add(face);
  return vm;
}

function expressway(track: Track, road: Road, sec: Section, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 0.2 });
  lamps.push(lampMat);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 11, 6);
  const armGeo = new THREE.BoxGeometry(0.15, 0.15, 3);
  const headGeo = new THREE.BoxGeometry(0.5, 0.2, 1.1);
  const n = Math.floor((sec.to - sec.from) / 45);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, n * 2), arms = new THREE.InstancedMesh(armGeo, poleMat, n * 2), heads = new THREE.InstancedMesh(headGeo, lampMat, n * 2);
  const o = new THREE.Object3D();
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = sec.from + i * 45 + 20;
    const p = sampleAt(road, s);
    for (const side of [1, -1]) {
      besideRoad(track, road, s, side * (p.halfWidth + 2.2), o);
      o.position.y += 5.5;
      o.updateMatrix();
      poles.setMatrixAt(k, o.matrix);
      const top = o.position.clone();
      o.position.copy(top).add(new THREE.Vector3(-p.lx * side * 1.4, 5.4, -p.lz * side * 1.4));
      o.rotation.y = Math.atan2(p.lx, p.lz);
      o.updateMatrix();
      arms.setMatrixAt(k, o.matrix);
      o.position.add(new THREE.Vector3(-p.lx * side * 1.4, -0.15, -p.lz * side * 1.4));
      o.updateMatrix();
      heads.setMatrixAt(k, o.matrix);
      o.rotation.set(0, 0, 0);
      k++;
    }
  }
  poles.castShadow = true;
  g.add(poles, arms, heads);
  // green direction gantry with fictional place names
  for (const s of [sec.from + 300, sec.from + 1500]) {
    const p = sampleAt(road, s);
    const gantry = new THREE.Group();
    const span = p.halfWidth * 2 + 4;
    for (const side of [1, -1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.5, 0.5), poleMat);
      leg.position.set((side * span) / 2, 3.75, 0);
      gantry.add(leg);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.8, 2.6), new THREE.MeshStandardMaterial({ map: bannerTexture('AKAGIRI  12km', '赤霧峠 · 潮風海岸 →', '#1f6b3a', '#f2efe6', '#f2efe6'), roughness: 0.5 }));
    sign.position.set(0, 7.6, 0);
    gantry.add(sign);
    const back = sign.clone();
    back.rotation.y = Math.PI;
    back.position.z = -0.05;
    gantry.add(back);
    const y = track.height(p.x, p.z);
    gantry.position.set(p.x, y, p.z);
    gantry.rotation.y = Math.atan2(-p.lz, p.lx);
    g.add(gantry);
  }
  return g;
}

function touge(track: Track, road: Road, sec: Section, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  // summit: torii gate + stone lanterns + lookout vending machines
  let top = sec.from, best = -Infinity;
  for (let s = sec.from; s < sec.to; s += 10) {
    const p = sampleAt(road, s);
    if (p.y > best) {
      best = p.y;
      top = s;
    }
  }
  const red = new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
  const torii = new THREE.Group();
  for (const x of [-2.6, 2.6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 6, 12), red);
    post.position.set(x, 3, 0);
    torii.add(post);
  }
  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 0.7), black);
  kasagi.position.y = 6.3;
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.35, 0.4), red);
  nuki.position.y = 5.2;
  torii.add(kasagi, nuki);
  torii.traverse((o) => (o.castShadow = true));
  const p = sampleAt(road, top);
  besideRoad(track, road, top, p.halfWidth + 9, torii);
  torii.rotation.y += Math.PI / 2;
  g.add(torii);
  const stone = new THREE.MeshStandardMaterial({ color: 0x8b8a82, roughness: 1 });
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const lantern = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.9, 6), stone);
    base.position.y = 0.45;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: 0x9a978e, emissive: 0xffb050, emissiveIntensity: 0.1 }));
    lamps.push(lamp.material as THREE.MeshStandardMaterial);
    lamp.position.y = 1.15;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.4, 4), stone);
    roof.position.y = 1.6;
    roof.rotation.y = Math.PI / 4;
    lantern.add(base, lamp, roof);
    besideRoad(track, road, top + i * 9, p.halfWidth + 3, lantern);
    g.add(lantern);
  }
  for (let i = 0; i < 3; i++) {
    const vm = vendingMachine(i, lamps);
    besideRoad(track, road, top + 40 + i * 1.2, -(p.halfWidth + 3), vm, -1);
    vm.rotation.y += Math.PI / 2;
    g.add(vm);
  }
  return g;
}

function coast(track: Track, road: Road, sec: Section, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  // lighthouse on the headland, sea side
  const s = (sec.from + sec.to) / 2 + 600;
  const p = sampleAt(road, s);
  const lh = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.7 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 22, 16), white);
  tower.position.y = 11;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 3, 16), new THREE.MeshStandardMaterial({ color: 0xc8261e }));
  band.position.y = 14;
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xfff0b0, emissiveIntensity: 0.3 });
  lamps.push(lampMat);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 12), lampMat);
  lamp.position.y = 23;
  lh.add(tower, band, lamp);
  lh.traverse((o) => (o.castShadow = true));
  besideRoad(track, road, s, -(p.halfWidth + 40), lh);
  g.add(lh);
  return g;
}

function activityMarker(track: Track, road: Road, a: Activity, lamps: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.MeshStandardMaterial({ color: 0x20242a, metalness: 0.4, roughness: 0.5 });
  const mk = (s: number, label: string, sub: string, color: string) => {
    const p = sampleAt(road, s);
    const gate = new THREE.Group();
    const span = p.halfWidth * 2 + 3;
    for (const side of [1, -1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.2, 0.35), post);
      leg.position.set((side * span) / 2, 2.6, 0);
      gate.add(leg);
    }
    const tex = bannerTexture(label, sub, '#0d1a2b', '#f2efe6', color);
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    lamps.push(mat);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.85, 1.3), mat);
    banner.position.y = 5.2;
    gate.add(banner);
    const y = track.height(p.x, p.z);
    gate.position.set(p.x, y, p.z);
    gate.rotation.y = Math.atan2(-p.lz, p.lx);
    gate.traverse((o) => (o.castShadow = true));
    return gate;
  };
  if (a.type === 'driftzone') {
    g.add(mk(a.from!, 'DRIFT ZONE', `${a.name} · ドリフトゾーン`, '#e8202f'));
    g.add(mk(a.to!, 'ZONE END', a.name, '#e8202f'));
  } else if (a.type === 'nearmiss') {
    g.add(mk(a.from!, 'NEAR-MISS ALLEY', `${a.name} · ×2`, '#f39c32'));
  } else if (a.type === 'speedtrap' || a.type === 'danger') {
    const p = sampleAt(road, a.at!);
    const sign = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4, 8), post);
    pole.position.y = 2;
    const tex = bannerTexture(a.type === 'speedtrap' ? 'SPEED TRAP' : 'DANGER SIGN', a.name, '#0d1a2b', '#f2efe6', a.type === 'speedtrap' ? '#7cf3ff' : '#f39c32');
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    lamps.push(mat);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.8), mat);
    board.position.y = 4.2;
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.7), post);
    cam.position.set(0, 3.6, 0.3);
    sign.add(pole, board, cam);
    besideRoad(track, road, a.at!, p.halfWidth + 2, sign);
    sign.rotation.y += Math.PI / 2;
    g.add(sign);
  }
  return g;
}
