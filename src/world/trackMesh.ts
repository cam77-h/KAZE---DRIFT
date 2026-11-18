import * as THREE from 'three';
import { KERB_WIDTH, SHOULDER_WIDTH, padDistance, type Road, type Track, type WallLine } from './track';
import { asphaltTextures, checkerTexture, concreteTexture, grassTexture, gravelTexture, kerbTexture, lineTexture } from '../render/textures';
import type { SurfaceId } from '../physics/types';

// Turns a Track (pure data + ground query) into meshes. Every vertex height comes from the
// same ground query the physics uses.

const hs = { h: 0, surface: 'grass' as SurfaceId, onRoad: false } as { h: number; surface: SurfaceId; onRoad: boolean; road?: Road };

export interface TrackMeshes {
  group: THREE.Group;
  materials: { asphalt: THREE.MeshStandardMaterial };
}

export function buildTrackMeshes(track: Track, quality: number): TrackMeshes {
  const group = new THREE.Group();
  group.name = 'track';
  const tex = asphaltTextures();
  const asphalt = new THREE.MeshStandardMaterial({ map: tex.map, bumpMap: tex.bump, bumpScale: 0.6, roughnessMap: tex.rough, roughness: 0.95, metalness: 0 });
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.65 });
  const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 1 });
  const lineMat = new THREE.MeshStandardMaterial({ map: lineTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  group.add(buildTerrain(track, quality));
  for (const road of track.roads) {
    group.add(roadStrip(track, road, -1, 1, asphalt, 'road', 10, 0.004));
    group.add(kerbStrips(track, road, kerbMat));
    group.add(shoulderStrips(track, road, gravelMat));
    if ((road.def.lines ?? 'edge') !== 'none') {
      for (const side of [1, -1]) group.add(lineStrip(track, road, side, lineMat));
    }
    if (road.def.closed) group.add(startLine(track, road));
  }
  for (const pad of track.def.pads) group.add(padMesh(track, pad, asphalt));
  for (const w of track.wallLines) {
    const m = buildWall(w);
    if (m) group.add(m);
  }
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
  });
  return { group, materials: { asphalt } };
}

function buildTerrain(track: Track, quality: number): THREE.Mesh {
  const size = track.def.size + 600;
  const res = quality < 0.8 ? 5 : quality < 1.1 ? 3.5 : 2.5;
  const n = Math.ceil(size / res);
  const geo = new THREE.PlaneGeometry(size, size, n, n);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    track.heightSurface(x, z, hs);
    let h = hs.h;
    // sink the terrain under roads and pads, the road meshes sit on top
    if (hs.onRoad) h -= 0.35;
    const p = hs.road ? hs.road.project : null;
    void p;
    pos.setY(i, h);
    const nz = track['terrainHeight'](x * 3.1, z * 3.1);
    const v = 0.85 + (nz % 1) * 0.0 + Math.sin(x * 0.05) * Math.cos(z * 0.07) * 0.08;
    if (hs.surface === 'gravel') c.setRGB(0.62, 0.58, 0.5);
    else c.setRGB(0.78 * v, 0.9 * v, 0.62 * v);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // UVs in world metres / 7 for the grass tiling
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 7, pos.getZ(i) / 7);
  const mat = new THREE.MeshStandardMaterial({ map: grassTexture(), vertexColors: true, roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

/** Generic strip across the road between lateral fractions, sampled every sample. */
function roadStrip(track: Track, road: Road, from: number, to: number, mat: THREE.Material, name: string, cols: number, lift: number): THREE.Mesh {
  const S = road.samples;
  const m = S.length;
  const rows = road.def.closed ? m + 1 : m;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    const p = S[r % m];
    const s = r < m ? p.s : road.length;
    for (let k = 0; k <= cols; k++) {
      const f = from + ((to - from) * k) / cols;
      const lat = f * p.halfWidth;
      const x = p.x + p.lx * lat, z = p.z + p.lz * lat;
      pos.push(x, track.height(x, z) + lift, z);
      uv.push((f + 1) * p.halfWidth / 8, s / 8);
    }
  }
  for (let r = 0; r < rows - 1; r++)
    for (let k = 0; k < cols; k++) {
      const a = r * (cols + 1) + k, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  return mesh;
}

/** Strips between two lateral offsets measured from the road edge, only where `include` holds. */
function edgeStrip(
  track: Track,
  road: Road,
  side: 1 | -1,
  inner: (i: number) => number,
  outer: (i: number) => number,
  include: (i: number) => boolean,
  mat: THREE.Material,
  uvScale: number,
  lift: number,
  cols = 3,
): THREE.Mesh | null {
  const S = road.samples;
  const m = S.length;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const last = road.def.closed ? m : m - 1;
  let prevRow = -1;
  for (let i = 0; i <= last; i++) {
    const ii = i % m;
    const on = include(ii) || include((ii + 1) % m) || (i > 0 && include((i - 1) % m));
    if (!on) {
      prevRow = -1;
      continue;
    }
    const p = S[ii];
    const s = i < m ? p.s : road.length;
    const row = pos.length / 3;
    for (let k = 0; k <= cols; k++) {
      const lat = side * (inner(ii) + ((outer(ii) - inner(ii)) * k) / cols);
      const x = p.x + p.lx * lat, z = p.z + p.lz * lat;
      pos.push(x, track.height(x, z) + lift, z);
      uv.push(k / cols, s / uvScale);
    }
    if (prevRow >= 0) {
      for (let k = 0; k < cols; k++) {
        const a = prevRow + k, b = a + 1, c = row + k, d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
    prevRow = row;
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function kerbStrips(track: Track, road: Road, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const S = road.samples;
  for (const side of [1, -1] as const) {
    const has = (i: number) => (side > 0 ? S[i].kerbL : S[i].kerbR);
    const mesh = edgeStrip(track, road, side, (i) => S[i].halfWidth - 0.02, (i) => S[i].halfWidth + KERB_WIDTH, has, mat, 4, 0.006, 4);
    if (mesh) g.add(mesh);
  }
  return g;
}

function shoulderStrips(track: Track, road: Road, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const S = road.samples;
  for (const side of [1, -1] as const) {
    const kerb = (i: number) => (side > 0 ? S[i].kerbL : S[i].kerbR);
    const mesh = edgeStrip(
      track, road, side,
      (i) => S[i].halfWidth + (kerb(i) ? KERB_WIDTH : 0) - 0.05,
      (i) => S[i].halfWidth + (kerb(i) ? KERB_WIDTH : 0) + SHOULDER_WIDTH,
      () => true, mat, 3, 0.012, 3,
    );
    if (mesh) g.add(mesh);
  }
  return g;
}

function lineStrip(track: Track, road: Road, side: number, mat: THREE.Material): THREE.Mesh {
  const S = road.samples;
  const mesh = edgeStrip(track, road, side as 1 | -1, (i) => S[i].halfWidth - 0.45, (i) => S[i].halfWidth - 0.2, () => true, mat, 4, 0.012, 1);
  return mesh ?? new THREE.Mesh();
}

function startLine(track: Track, road: Road): THREE.Mesh {
  const p = road.samples[0];
  const geo = new THREE.PlaneGeometry(p.halfWidth * 2, 1.2, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const map = (mesh.material as THREE.MeshStandardMaterial).map!;
  map.repeat.set(p.halfWidth / 2, 1);
  mesh.position.set(p.x, track.height(p.x, p.z) + 0.014, p.z);
  mesh.rotation.y = Math.atan2(p.tx, p.tz);
  return mesh;
}

function padMesh(track: Track, pad: Track['def']['pads'][number], mat: THREE.Material): THREE.Mesh {
  let geo: THREE.BufferGeometry;
  if (pad.shape === 'circle') {
    geo = new THREE.CircleGeometry(pad.r ?? 10, 96, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    // densify: rebuild as a polar grid so the edge blends follow the ground
    const rings = 24, segs = 96;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let r = 0; r <= rings; r++) {
      const rad = ((pad.r ?? 10) * r) / rings;
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const x = pad.x + Math.cos(a) * rad, z = pad.z + Math.sin(a) * rad;
        pos.push(x, track.height(x, z) + 0.004, z);
        uv.push(x / 8, z / 8);
      }
    }
    for (let r = 0; r < rings; r++)
      for (let s = 0; s < segs; s++) {
        const a = r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
  } else {
    const w = pad.w ?? 10, d = pad.d ?? 10;
    const nx = Math.ceil(w / 4), nz = Math.ceil(d / 4);
    geo = new THREE.PlaneGeometry(w, d, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(pad.rot ?? 0);
    const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + pad.x, z = pos.getZ(i) + pad.z;
      pos.setXYZ(i, x, track.height(x, z) + 0.004, z);
      uv.setXY(i, x / 8, z / 8);
    }
  }
  geo.computeVertexNormals();
  void padDistance;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'pad';
  return mesh;
}

// ------------------------------------------------------------------ walls

function buildWall(w: WallLine): THREE.Object3D | null {
  switch (w.type) {
    case 'tire':
      return tireWall(w);
    case 'concrete':
      return sweep(w, JERSEY, new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9 }), 2.4);
    case 'guardrail':
      return guardrail(w);
    case 'fence':
      return fence(w);
    default:
      return sweep(w, JERSEY, new THREE.MeshStandardMaterial({ color: 0x999999 }), 2.4);
  }
}

const JERSEY: [number, number][] = [[-0.32, 0], [-0.32, 0.08], [-0.13, 0.3], [-0.09, 1.08], [0, 1.1], [0.09, 1.08], [0.13, 0.3], [0.32, 0.08], [0.32, 0]];

/** Sweep a 2D profile (lateral, height) along a wall polyline. */
function sweep(w: WallLine, profile: [number, number][], mat: THREE.Material, uvLen: number): THREE.Mesh {
  const pts = w.points;
  const n = pts.length;
  const loop = w.closed ? n + 1 : n;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let dist = 0;
  const P = profile.length;
  for (let i = 0; i < loop; i++) {
    const p = pts[i % n];
    const a = pts[Math.max(0, i - 1) % n], b = pts[Math.min(loop - 1, i + 1) % n];
    let tx = b[0] - a[0], tz = b[2] - a[2];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const lx = tz, lz = -tx;
    if (i > 0) dist += Math.hypot(p[0] - pts[(i - 1) % n][0], p[2] - pts[(i - 1) % n][2]);
    for (let k = 0; k < P; k++) {
      const [o, h] = profile[k];
      pos.push(p[0] + lx * o, p[1] + h * (w.height / 1.1) - 0.05, p[2] + lz * o);
      uv.push(k / (P - 1), dist / uvLen);
    }
  }
  for (let i = 0; i < loop - 1; i++)
    for (let k = 0; k < P - 1; k++) {
      const a = i * P + k, b = a + 1, c = a + P, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  (mat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  return mesh;
}

/** Stacked tire barrier, instanced, with a painted band every few stacks. */
function tireWall(w: WallLine): THREE.InstancedMesh {
  const spots: [number, number, number][] = [];
  const pts = w.points;
  const n = pts.length;
  const segs = w.closed ? n : n - 1;
  let carry = 0;
  const step = 0.84;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    let t = carry;
    while (t < len) {
      const f = t / len;
      spots.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
      t += step;
    }
    carry = t - len;
  }
  const layers = 3;
  const geo = new THREE.TorusGeometry(0.3, 0.13, 8, 14);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
  const inst = new THREE.InstancedMesh(geo, mat, spots.length * layers);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let k = 0;
  for (let i = 0; i < spots.length; i++)
    for (let h = 0; h < layers; h++) {
      const s = spots[i];
      m.makeRotationY(i * 0.7 + h);
      m.setPosition(s[0], s[1] + 0.12 + h * 0.25, s[2]);
      inst.setMatrixAt(k, m);
      const band = Math.floor(i / 5) % 2 === 0 && h === 1;
      col.set(band ? (Math.floor(i / 10) % 2 ? 0xd8d4c8 : 0xc4161c) : 0x18181a);
      inst.setColorAt(k, col);
      k++;
    }
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.name = 'tire-wall';
  return inst;
}

function guardrail(w: WallLine): THREE.Group {
  const g = new THREE.Group();
  const beam: [number, number][] = [[0, 0.5], [0.05, 0.55], [0.02, 0.62], [0.05, 0.69], [0, 0.74]];
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 0.75, roughness: 0.38 });
  g.add(sweep({ ...w, height: 1.1 }, beam.map(([o, h]) => [o * -w.face, h]), mat, 4));
  const pts = w.points;
  const postGeo = new THREE.BoxGeometry(0.09, 0.8, 0.09);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8d9297, metalness: 0.6, roughness: 0.5 });
  const count = Math.ceil(pts.length / 1);
  const inst = new THREE.InstancedMesh(postGeo, postMat, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const p = pts[i];
    m.makeTranslation(p[0], p[1] + 0.35, p[2]);
    inst.setMatrixAt(i, m);
  }
  inst.castShadow = true;
  g.add(inst);
  return g;
}

function fence(w: WallLine): THREE.Group {
  const g = new THREE.Group();
  const pts = w.points;
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, w.height, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6d7378, metalness: 0.5, roughness: 0.6 });
  const inst = new THREE.InstancedMesh(postGeo, postMat, pts.length);
  const m = new THREE.Matrix4();
  pts.forEach((p, i) => {
    m.makeTranslation(p[0], p[1] + w.height / 2, p[2]);
    inst.setMatrixAt(i, m);
  });
  g.add(inst);
  // chain-link panels
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = 'rgba(190,195,200,0.9)';
  ctx.lineWidth = 2;
  for (let i = -64; i < 128; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 64, 64);
    ctx.moveTo(i + 64, 0);
    ctx.lineTo(i, 64);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  const profile: [number, number][] = [[0, 0], [0, w.height]];
  const mesh = sweep({ ...w, height: 1.1 }, profile.map(([o, h]) => [o, (h * 1.1) / w.height * (w.height / 1.1)]), mat, 2);
  // uv: v along length, u across height
  const uv = mesh.geometry.getAttribute('uv');
  const pos = mesh.geometry.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), (i % 2) * w.height / 2);
  void pos;
  g.add(mesh);
  return g;
}
