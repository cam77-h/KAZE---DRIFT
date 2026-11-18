import * as THREE from 'three';
import { endSurfaceZ, sideSurfaceX, topSurfaceY, type BodyShape } from './profile';
import { honeycombTexture, plateTexture } from '../render/textures';

// Procedural car model. The body is a loft of cross-sections (superellipses whose size and
// shape follow hand-tuned side/top/plan profiles), with wheel arches cut from the side
// profile, a separate greenhouse with real glass and pillars, and surface-conforming
// details (lamps, grille, plates, seams) projected onto the body.

export interface CarMaterials {
  paint: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  chrome: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  interior: THREE.MeshStandardMaterial;
  headLens: THREE.MeshStandardMaterial;
  tailLens: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  reverse: THREE.MeshStandardMaterial;
  seam: THREE.MeshBasicMaterial;
  grille: THREE.MeshStandardMaterial;
  carbon: THREE.MeshStandardMaterial;
}

export function makeCarMaterials(color: string): CarMaterials {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.1 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.62, metalness: 0.1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0d151c, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.62, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.02 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6e8ea, metalness: 1, roughness: 0.12 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.85 }),
    headLens: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.8, roughness: 0.12, emissive: 0xfff1d6, emissiveIntensity: 0, map: headlightTexture(), emissiveMap: headlightTexture() }),
    tailLens: new THREE.MeshStandardMaterial({ color: 0x7a0b10, metalness: 0.3, roughness: 0.18, emissive: 0xff1020, emissiveIntensity: 0.25, map: taillightTexture(), emissiveMap: taillightTexture() }),
    amber: new THREE.MeshStandardMaterial({ color: 0xc87a10, metalness: 0.2, roughness: 0.2, emissive: 0xff8a10, emissiveIntensity: 0 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 0.2, roughness: 0.15, emissive: 0xffffff, emissiveIntensity: 0 }),
    seam: new THREE.MeshBasicMaterial({ color: 0x050506, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    grille: new THREE.MeshStandardMaterial({ map: honeycombTexture(), roughness: 0.6, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.4, roughness: 0.35 }),
  };
}

function headlightTexture(): THREE.Texture {
  return lampTexture('head', (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#5d646c');
    grd.addColorStop(1, '#1e2226');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // chrome reflector bowls + projectors
    for (const [cx, r] of [[0.28, 0.32], [0.62, 0.3]] as const) {
      const x = cx * w, y = h * 0.52, rr = r * h;
      const rg = g.createRadialGradient(x, y, 0, x, y, rr);
      rg.addColorStop(0, '#ffffff');
      rg.addColorStop(0.35, '#d9dde2');
      rg.addColorStop(0.75, '#7c858e');
      rg.addColorStop(1, '#2b3035');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#e09a2a';
    g.fillRect(w * 0.84, h * 0.3, w * 0.13, h * 0.45);
  });
}

function taillightTexture(): THREE.Texture {
  return lampTexture('tail', (g, w, h) => {
    g.fillStyle = '#5a0408';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const x = (0.22 + i * 0.28) * w, y = h * 0.5, r = h * 0.36;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, '#ff6a6a');
      rg.addColorStop(0.5, '#e01020');
      rg.addColorStop(1, '#5a0408');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, h * 0.08, w, h * 0.08);
  });
}

const lampCache = new Map<string, THREE.Texture>();
function lampTexture(key: string, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture {
  const hit = lampCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  draw(c.getContext('2d')!, 256, 96);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  lampCache.set(key, t);
  return t;
}

// ------------------------------------------------------------------ geometry builders

type Group3 = 'paint' | 'trim' | 'glass';

class MultiGeo {
  pos: number[] = [];
  uv: number[] = [];
  idx: Record<Group3, number[]> = { paint: [], trim: [], glass: [] };
  vert(x: number, y: number, z: number, u = 0, v = 0): number {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }
  quad(g: Group3, a: number, b: number, c: number, d: number): void {
    this.idx[g].push(a, b, c, a, c, d);
  }
  tri(g: Group3, a: number, b: number, c: number): void {
    this.idx[g].push(a, b, c);
  }
  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const all: number[] = [];
    let start = 0;
    const order: Group3[] = ['paint', 'trim', 'glass'];
    order.forEach((g, i) => {
      all.push(...this.idx[g]);
      geo.addGroup(start, this.idx[g].length, i);
      start += this.idx[g].length;
    });
    geo.setIndex(all);
    geo.computeVertexNormals();
    return geo;
  }
}

/** Lofted lower body with wheel arches. */
function buildBody(b: BodyShape): THREE.BufferGeometry {
  const g = new MultiGeo();
  const STATIONS = 120;
  const K = 28; // vertices per half ring
  const rings: number[][] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const u = i / STATIONS;
    const z = b.zRear + (b.zFront - b.zRear) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    const bot = b.bottom.at(z), top = b.top.at(z);
    const hw = b.halfWidth.at(z);
    const yc = bot + (top - bot) * b.shoulder.at(z);
    const nU = b.upperExp.at(z), nL = b.lowerExp;
    const ring: number[] = [];
    // left half: bottom centre → side → top centre; right half mirrors it back down
    const half: [number, number][] = [];
    for (let k = 0; k <= K; k++) {
      const th = (k / K) * Math.PI;
      let x: number, y: number;
      if (th <= Math.PI / 2) {
        const c = Math.cos(th), s = Math.sin(th);
        x = hw * Math.pow(s, 2 / nL);
        y = yc - (yc - bot) * Math.pow(c, 2 / nL);
      } else {
        const p = th - Math.PI / 2;
        const c = Math.cos(p), s = Math.sin(p);
        x = hw * Math.pow(c, 2 / nU);
        y = yc + (top - yc) * Math.pow(s, 2 / nU);
      }
      // wheel arches: lift anything inside the arch circle up to the arch line, flare the lip
      for (const w of b.wheels) {
        const dz = z - w.z;
        if (Math.abs(dz) < w.arch) {
          const ay = w.y + Math.sqrt(w.arch * w.arch - dz * dz);
          if (y < ay) {
            y = ay;
          }
          const near = Math.max(0, 1 - Math.abs(y - ay) / 0.07) * (Math.abs(x) / hw > 0.8 ? 1 : 0);
          x *= 1 + 0.018 * near;
        }
      }
      half.push([x, y]);
    }
    for (let k = 0; k <= K; k++) ring.push(g.vert(half[k][0], half[k][1], z, k / (2 * K), u));
    for (let k = K - 1; k >= 1; k--) ring.push(g.vert(-half[k][0], half[k][1], z, 1 - k / (2 * K), u));
    rings.push(ring);
  }
  const R = rings[0].length;
  for (let i = 0; i < STATIONS; i++) {
    for (let k = 0; k < R; k++) {
      const a = rings[i][k], bb = rings[i][(k + 1) % R], c = rings[i + 1][(k + 1) % R], d = rings[i + 1][k];
      const y = (g.pos[a * 3 + 1] + g.pos[c * 3 + 1]) / 2;
      const grp: Group3 = y < 0.235 ? 'trim' : 'paint';
      // a→bb runs up the section, a→d runs forward: (bb-a)×(c-bb) points outward
      g.quad(grp, a, bb, c, d);
    }
  }
  // end caps
  for (const [ri, flip] of [[0, true], [STATIONS, false]] as const) {
    const ring = rings[ri];
    let cx = 0, cy = 0, cz = 0;
    for (const v of ring) {
      cx += g.pos[v * 3];
      cy += g.pos[v * 3 + 1];
      cz += g.pos[v * 3 + 2];
    }
    const c = g.vert(cx / ring.length, cy / ring.length, cz / ring.length);
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], bb = ring[(k + 1) % ring.length];
      if (flip) g.tri('paint', c, bb, a);
      else g.tri('paint', c, a, bb);
    }
  }
  return g.build();
}

/** Greenhouse: windshield, roof, side glass with A/B/C pillars, rear window. */
function buildGreenhouse(b: BodyShape): THREE.BufferGeometry {
  const gh = b.greenhouse;
  const g = new MultiGeo();
  const STATIONS = 70;
  const rings: number[][] = [];
  const zs: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const u = i / STATIONS;
    const z = gh.zRear + (gh.zFront - gh.zRear) * u;
    zs.push(z);
    const belt = b.top.at(z) - 0.012;
    const roof = Math.max(belt, gh.roof.at(z));
    const wb = b.halfWidth.at(z) - gh.beltInset;
    const k = Math.min(1, Math.max(0, (roof - belt) / 0.3));
    const wr = Math.min(gh.roofHalfWidth, wb - 0.04);
    const pts: [number, number][] = [
      [wb, belt],
      [wb - 0.015, belt + 0.035 * k],
      [wr + 0.075 * k, roof - 0.075 * k],
      [wr + 0.02 * k, roof - 0.018 * k],
      [wr * 0.55, roof],
      [0, roof + 0.01 * k],
    ];
    const ring: number[] = [];
    for (const [x, y] of pts) ring.push(g.vert(x, y, z));
    for (let j = pts.length - 2; j >= 0; j--) ring.push(g.vert(-pts[j][0], pts[j][1], z));
    rings.push(ring);
  }
  const R = rings[0].length; // 11
  for (let i = 0; i < STATIONS; i++) {
    const zm = (zs[i] + zs[i + 1]) / 2;
    const windshield = zm > gh.windshieldZ;
    const rearWin = zm < gh.rearWindowZ;
    const cPillar = zm < gh.quarterZ;
    const bPillar = zm > gh.bPillar[0] && zm < gh.bPillar[1];
    for (let k = 0; k < R - 1; k++) {
      // segment index from the outside: 0 belt trim, 1 side window, 2 roof edge, 3-4 roof
      const seg = k < 5 ? k : R - 2 - k;
      let grp: Group3;
      if (seg === 0) grp = 'trim';
      else if (seg === 1) grp = windshield || cPillar ? 'paint' : bPillar ? 'trim' : rearWin ? 'paint' : 'glass';
      else if (seg === 2) grp = 'paint';
      else grp = windshield || rearWin ? 'glass' : 'paint';
      const a = rings[i][k], bb = rings[i][k + 1], c = rings[i + 1][k + 1], d = rings[i + 1][k];
      g.quad(grp, a, bb, c, d);
    }
  }
  return g.build();
}

/** A grid patch over a 2D outline, projected onto the front/rear surface of the body. */
function endPatch(b: BodyShape, outline: [number, number][], dir: 1 | -1, offset: number, mirror: boolean): THREE.BufferGeometry | null {
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const NX = 44, NY = 18;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const grid: (number | null)[][] = [];
  for (let j = 0; j <= NY; j++) {
    const row: (number | null)[] = [];
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, v = j / NY;
      const x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * v;
      if (!pointInPoly(x, y, outline, 0.004)) {
        row.push(null);
        continue;
      }
      const z = endSurfaceZ(b, x, y, dir);
      if (z === null) {
        row.push(null);
        continue;
      }
      // approximate surface normal from neighbouring depths
      const zx = endSurfaceZ(b, x + 0.01, y, dir) ?? z, zy = endSurfaceZ(b, x, y + 0.01, dir) ?? z;
      const nx = -(zx - z) / 0.01 * dir, ny = -(zy - z) / 0.01 * dir, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      pos.push(x + (nx / l) * offset, y + (ny / l) * offset, z + dir * (nz / l) * offset);
      uv.push(dir > 0 ? u : 1 - u, v);
      row.push(pos.length / 3 - 1);
    }
    grid.push(row);
  }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const a = grid[j][i], bb = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
      if (a === null || bb === null || c === null || d === null) continue;
      if (dir > 0) idx.push(a, bb, c, a, c, d);
      else idx.push(a, c, bb, a, d, c);
    }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (mirror) {
    const m = geo.clone();
    m.scale(-1, 1, 1);
    // flip winding back after mirroring
    const ix = m.getIndex()!;
    for (let i = 0; i < ix.count; i += 3) {
      const t = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, t);
    }
    const uvs = m.getAttribute('uv');
    for (let i = 0; i < uvs.count; i++) uvs.setX(i, 1 - uvs.getX(i));
    m.computeVertexNormals();
    return mergeGeos([geo, m]);
  }
  return geo;
}

function pointInPoly(x: number, y: number, poly: [number, number][], grow: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (inside || grow <= 0) return inside;
  // small tolerance so grid edges land on the outline
  for (const [dx, dy] of [[grow, 0], [-grow, 0], [0, grow], [0, -grow]]) if (pointInPoly(x + dx, y + dy, poly, 0)) return true;
  return false;
}

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g of list) {
    const p = g.getAttribute('position'), t = g.getAttribute('uv'), ix = g.getIndex()!;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

/** A thin ribbon following a list of points, offset along per-point normals. */
function ribbon(points: THREE.Vector3[], normals: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const t = (i < points.length - 1 ? points[i + 1].clone().sub(p) : p.clone().sub(points[i - 1])).normalize();
    const side = new THREE.Vector3().crossVectors(normals[i], t).normalize().multiplyScalar(width / 2);
    pos.push(p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Vertical seam on the side of the body at station z (both sides). */
function sideSeam(b: BodyShape, z: number, y0: number, y1: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const pts: THREE.Vector3[] = [], ns: THREE.Vector3[] = [];
    for (let y = y0; y <= y1 + 1e-6; y += 0.02) {
      const x = sideSurfaceX(b, y, z);
      if (x < 0) continue;
      pts.push(new THREE.Vector3(s * (x + 0.0025), y, z));
      ns.push(new THREE.Vector3(s, 0, 0));
    }
    if (pts.length > 1) out.push(ribbon(pts, ns, 0.005));
  }
  return out;
}

/** Seam across the top surface at station z between |x| ≤ xMax. */
function topSeamAcross(b: BodyShape, z: number, xMax: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [], ns: THREE.Vector3[] = [];
  for (let x = -xMax; x <= xMax + 1e-6; x += 0.03) {
    const y = topSurfaceY(b, x, z);
    if (y < 0) continue;
    pts.push(new THREE.Vector3(x, y + 0.0025, z));
    ns.push(new THREE.Vector3(0, 1, 0));
  }
  return ribbon(pts, ns, 0.005);
}

/** Seam along the top surface at lateral x from z0 to z1 (both sides). */
function topSeamAlong(b: BodyShape, x: number, z0: number, z1: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const pts: THREE.Vector3[] = [], ns: THREE.Vector3[] = [];
    for (let z = z0; z <= z1 + 1e-6; z += 0.04) {
      const y = topSurfaceY(b, x, z);
      if (y < 0) continue;
      pts.push(new THREE.Vector3(s * x, y + 0.0025, z));
      ns.push(new THREE.Vector3(0, 1, 0));
    }
    if (pts.length > 1) out.push(ribbon(pts, ns, 0.005));
  }
  return out;
}

export interface CarModel {
  root: THREE.Group;
  materials: CarMaterials;
  /** wheel pivots (steer) indexed FL, FR, RL, RR, created by the caller */
  shape: BodyShape;
  headlightAnchors: THREE.Vector3[];
  tailAnchors: THREE.Vector3[];
}

/** Build the full procedural body (no wheels). */
export function buildCarBody(shape: BodyShape, paintColor: string): CarModel {
  const m = makeCarMaterials(paintColor);
  const root = new THREE.Group();
  root.name = 'car-body';
  const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material | THREE.Material[], name: string, shadow = true) => {
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    root.add(mesh);
    return mesh;
  };

  add(buildBody(shape), [m.paint, m.trim, m.glass], 'body');
  add(buildGreenhouse(shape), [m.paint, m.trim, m.glass], 'greenhouse');

  // interior visible through the glass (right-hand drive)
  const interior = new THREE.Group();
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material = m.interior) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    interior.add(mesh);
    return mesh;
  };
  box(1.4, 0.06, 1.7, 0, 0.62, -0.35); // floor
  box(1.2, 0.14, 0.3, 0, 0.84, 0.22); // dashboard
  for (const sx of [0.36, -0.36]) {
    box(0.46, 0.1, 0.48, sx, 0.66, -0.32); // seat base
    const back = box(0.46, 0.5, 0.1, sx, 0.9, -0.6);
    back.rotation.x = -0.22;
  }
  box(1.1, 0.22, 0.4, 0, 0.72, -1.0); // rear bench
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), m.trim);
  wheel.position.set(-0.36, 0.92, 0.08);
  wheel.rotation.x = -0.35;
  wheel.name = 'steering-wheel';
  interior.add(wheel);
  root.add(interior);

  // headlights (swept along the nose corners)
  const head = endPatch(shape, [[0.34, 0.588], [0.79, 0.6], [0.815, 0.652], [0.62, 0.7], [0.36, 0.672]], 1, 0.006, true);
  add(head, m.headLens, 'headlights', false);
  // amber corner lights / fogs in the bumper
  add(endPatch(shape, [[0.58, 0.3], [0.73, 0.3], [0.71, 0.355], [0.6, 0.355]], 1, 0.005, true), m.amber, 'fogs', false);
  // lower intake + upper slot
  add(endPatch(shape, [[-0.52, 0.2], [0.52, 0.2], [0.46, 0.345], [-0.46, 0.345]], 1, 0.004, false), m.grille, 'intake', false);
  add(endPatch(shape, [[-0.3, 0.48], [0.3, 0.48], [0.26, 0.53], [-0.26, 0.53]], 1, 0.004, false), m.grille, 'grille', false);
  // number plates
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.4, metalness: 0.1 });
  add(endPatch(shape, [[-0.165, 0.36], [0.165, 0.36], [0.165, 0.45], [-0.165, 0.45]], 1, 0.008, false), plateMat, 'plate-front', false);
  add(endPatch(shape, [[-0.165, 0.56], [0.165, 0.56], [0.165, 0.65], [-0.165, 0.65]], -1, 0.008, false), plateMat, 'plate-rear', false);
  // taillights wrapping to the corners + reverse lamps
  add(endPatch(shape, [[0.3, 0.74], [0.74, 0.745], [0.75, 0.84], [0.3, 0.845]], -1, 0.006, true), m.tailLens, 'taillights', false);
  add(endPatch(shape, [[0.2, 0.745], [0.29, 0.745], [0.29, 0.84], [0.2, 0.84]], -1, 0.006, true), m.reverse, 'reverse', false);
  // rear diffuser strip
  add(endPatch(shape, [[-0.62, 0.26], [0.62, 0.26], [0.6, 0.34], [-0.6, 0.34]], -1, 0.004, false), m.trim, 'diffuser', false);

  // seams: doors, hood, trunk, bumpers
  const seams: THREE.BufferGeometry[] = [];
  seams.push(...sideSeam(shape, 0.6, 0.2, shape.top.at(0.6) - 0.02));
  seams.push(...sideSeam(shape, -0.62, 0.2, shape.top.at(-0.62) - 0.02));
  seams.push(...sideSeam(shape, 1.86, 0.22, shape.top.at(1.86) - 0.12));
  seams.push(...sideSeam(shape, -1.96, 0.24, shape.top.at(-1.96) - 0.15));
  seams.push(topSeamAcross(shape, shape.zFront - 0.13, 0.7));
  seams.push(...topSeamAlong(shape, 0.7, 0.6, shape.zFront - 0.13));
  seams.push(topSeamAcross(shape, -1.36, 0.66));
  seams.push(...topSeamAlong(shape, 0.66, shape.zRear + 0.12, -1.36));
  for (const s of seams) add(s, m.seam, 'seam', false);

  // door handles
  for (const s of [1, -1]) {
    const x = sideSurfaceX(shape, 0.8, -0.48);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.13), m.trim);
    h.position.set(s * (x + 0.005), 0.8, -0.48);
    root.add(h);
  }

  // mirrors
  for (const s of [1, -1]) {
    const z = 0.46;
    const x = shape.halfWidth.at(z) - shape.greenhouse.beltInset + 0.06;
    const y = shape.top.at(z) + 0.07;
    const mirror = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), m.paint);
    mirror.scale.set(0.05, 0.055, 0.1);
    mirror.position.set(s * (x + 0.07), y, z - 0.03);
    mirror.castShadow = true;
    root.add(mirror);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 16), m.chrome);
    glass.scale.set(0.042, 0.045, 1);
    glass.position.set(s * (x + 0.07), y, z - 0.128);
    glass.rotation.y = Math.PI;
    root.add(glass);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.04), m.trim);
    stalk.position.set(s * (x + 0.02), y - 0.02, z);
    root.add(stalk);
  }

  // rear lip spoiler on two pedestals
  const deckZ = shape.zRear + 0.32;
  const deckY = shape.top.at(deckZ);
  for (const s of [1, -1]) {
    const ped = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.14), m.paint);
    ped.position.set(s * 0.48, deckY + 0.035, deckZ + 0.06);
    ped.rotation.x = -0.25;
    ped.castShadow = true;
    root.add(ped);
  }
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.bezierCurveTo(0.06, 0.03, 0.15, 0.03, 0.22, 0.012);
  wingShape.lineTo(0.22, 0.0);
  wingShape.bezierCurveTo(0.15, 0.012, 0.06, 0.008, 0, -0.012);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 1.26, bevelEnabled: false, curveSegments: 8 });
  wingGeo.translate(0, 0, -0.63);
  wingGeo.rotateY(Math.PI / 2);
  const wing = new THREE.Mesh(wingGeo, m.paint);
  wing.position.set(0, deckY + 0.075, deckZ + 0.1);
  wing.rotation.x = 0.05;
  wing.castShadow = true;
  root.add(wing);

  // exhaust (right-hand side)
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 20, 1, true), m.chrome);
  tip.rotation.x = Math.PI / 2;
  const exZ = endSurfaceZ(shape, -0.5, 0.3, -1) ?? shape.zRear;
  tip.position.set(-0.5, 0.25, exZ - 0.03);
  root.add(tip);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  inner.position.set(-0.5, 0.25, exZ - 0.1);
  inner.rotation.y = Math.PI;
  root.add(inner);

  // underbody + wheel wells so nothing is see-through
  const under = new THREE.Mesh(new THREE.PlaneGeometry(1.5, shape.zFront - shape.zRear - 0.4), m.trim);
  under.rotation.x = Math.PI / 2;
  under.position.set(0, 0.19, (shape.zFront + shape.zRear) / 2);
  root.add(under);
  for (const w of shape.wheels) {
    for (const s of [1, -1]) {
      const well = new THREE.Mesh(new THREE.CylinderGeometry(w.arch - 0.01, w.arch - 0.01, 0.32, 20, 1, true, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 1, side: THREE.BackSide }));
      well.rotation.set(0, 0, Math.PI / 2);
      well.position.set(s * (shape.halfWidth.at(w.z) - 0.2), w.y, w.z);
      root.add(well);
    }
  }

  const headlightAnchors = [new THREE.Vector3(0.6, 0.64, shape.zFront - 0.05), new THREE.Vector3(-0.6, 0.64, shape.zFront - 0.05)];
  const tailAnchors = [new THREE.Vector3(0.55, 0.79, shape.zRear + 0.02), new THREE.Vector3(-0.55, 0.79, shape.zRear + 0.02)];
  return { root, materials: m, shape, headlightAnchors, tailAnchors };
}
