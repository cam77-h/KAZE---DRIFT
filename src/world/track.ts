import { makeSample, WallSet, type GroundSample, type PhysicsWorld, type WallMaterial } from '../physics/collision';
import type { SurfaceId } from '../physics/types';

// Spline-based track: roads are centripetal Catmull-Rom splines with per-point width and
// banking, sampled every metre. The ground query below is the single source of truth for
// both physics (suspension raycasts) and the rendered meshes, so what you see is what you drive on.

export interface WallDef {
  side: 'left' | 'right';
  /** fraction of the road length (0..1); from > to wraps around on closed roads */
  from: number;
  to: number;
  /** distance from the road edge (m) */
  offset: number;
  type: WallMaterial;
  height?: number;
}

export interface RoadDef {
  id: string;
  closed: boolean;
  /** default full width (m) */
  width: number;
  /** [x, y, z] or [x, y, z, width, bankDeg] */
  points: number[][];
  surface?: SurfaceId;
  shoulder?: SurfaceId;
  kerbs?: 'corners' | 'all' | 'none';
  walls?: WallDef[];
  lines?: 'edge' | 'center' | 'none';
}

export interface PadDef {
  id?: string;
  shape: 'rect' | 'circle';
  x: number;
  z: number;
  w?: number;
  d?: number;
  r?: number;
  rot?: number;
  y: number;
  surface: SurfaceId;
  /** blend distance to the surrounding terrain */
  blend?: number;
}

export interface TerrainDef {
  base: number;
  amp: number;
  scale: number;
  seed: number;
  /** mountains rising away from a centre point */
  rise?: { x: number; z: number; r: number; height: number; falloff: number };
  /** planar slope added to the terrain: h += tilt[0] * x + tilt[1] * z */
  tilt?: [number, number];
  ground?: SurfaceId;
  /** smooth hills (cos² falloff) */
  hills?: { x: number; z: number; r: number; h: number }[];
  /** coastline: west of x0 the land falls into the sea over `width` metres */
  sea?: { level: number; x0: number; width: number; depth: number };
}

export interface FreeWallDef {
  type: WallMaterial;
  points?: number[][];
  circle?: { x: number; z: number; r: number; segments?: number };
  closed?: boolean;
  height?: number;
  radius?: number;
}

export interface TrackDef {
  id: string;
  size: number;
  spawn: { x: number; z: number; yaw: number };
  roads: RoadDef[];
  pads: PadDef[];
  terrain: TerrainDef;
  walls?: FreeWallDef[];
  [key: string]: unknown;
}

export interface RoadSample {
  x: number;
  y: number;
  z: number;
  /** unit tangent (plan) */
  tx: number;
  tz: number;
  /** unit left normal (plan) */
  lx: number;
  lz: number;
  halfWidth: number;
  bank: number;
  s: number;
  curvature: number;
  kerbL: boolean;
  kerbR: boolean;
}

export const KERB_WIDTH = 1.1;
export const SHOULDER_WIDTH = 2.5;
const BLEND = 16;

export class Road {
  samples: RoadSample[] = [];
  length = 0;
  surface: SurfaceId;
  shoulder: SurfaceId;
  private grid = new Map<number, number[]>();
  private cell = 10;
  segCount = 0;

  constructor(public def: RoadDef) {
    this.surface = def.surface ?? 'asphalt';
    this.shoulder = def.shoulder ?? 'grass';
    this.build();
  }

  private build(): void {
    const d = this.def;
    const pts = d.points.map((p) => ({
      x: p[0],
      y: p[1],
      z: p[2],
      w: p[3] ?? d.width,
      b: ((p[4] ?? 0) * Math.PI) / 180,
    }));
    const n = pts.length;
    const get = (i: number) => (d.closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    // dense centripetal Catmull-Rom
    const dense: { x: number; y: number; z: number; w: number; b: number }[] = [];
    const segs = d.closed ? n : n - 1;
    const SUB = 24;
    for (let i = 0; i < segs; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const k0 = 0;
      const k1 = k0 + Math.pow(dist3(p0, p1), 0.5) + 1e-6;
      const k2 = k1 + Math.pow(dist3(p1, p2), 0.5) + 1e-6;
      const k3 = k2 + Math.pow(dist3(p2, p3), 0.5) + 1e-6;
      for (let j = 0; j < SUB; j++) {
        const u = j / SUB;
        const t = k1 + (k2 - k1) * u;
        const q = { x: 0, y: 0, z: 0, w: p1.w + (p2.w - p1.w) * smooth(u), b: p1.b + (p2.b - p1.b) * smooth(u) };
        for (const key of ['x', 'y', 'z'] as const) {
          const A1 = ((k1 - t) / (k1 - k0)) * p0[key] + ((t - k0) / (k1 - k0)) * p1[key];
          const A2 = ((k2 - t) / (k2 - k1)) * p1[key] + ((t - k1) / (k2 - k1)) * p2[key];
          const A3 = ((k3 - t) / (k3 - k2)) * p2[key] + ((t - k2) / (k3 - k2)) * p3[key];
          const B1 = ((k2 - t) / (k2 - k0)) * A1 + ((t - k0) / (k2 - k0)) * A2;
          const B2 = ((k3 - t) / (k3 - k1)) * A2 + ((t - k1) / (k3 - k1)) * A3;
          q[key] = ((k2 - t) / (k2 - k1)) * B1 + ((t - k1) / (k2 - k1)) * B2;
        }
        dense.push(q);
      }
    }
    if (!d.closed) dense.push({ ...pts[n - 1] });
    // resample at ~1 m by arc length
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z));
    let total = cum[cum.length - 1];
    if (d.closed) total += Math.hypot(dense[0].x - dense[dense.length - 1].x, dense[0].z - dense[dense.length - 1].z);
    const count = Math.max(4, Math.round(total));
    const step = total / count;
    const out: RoadSample[] = [];
    let k = 0;
    const lastIdx = d.closed ? count : count + 1;
    for (let i = 0; i < lastIdx; i++) {
      const s = i * step;
      while (k < cum.length - 2 && cum[k + 1] < s) k++;
      const a = dense[k];
      const b = k + 1 < dense.length ? dense[k + 1] : dense[0];
      const segLen = (k + 1 < cum.length ? cum[k + 1] : total) - cum[k];
      const f = segLen > 0 ? Math.min(1, Math.max(0, (s - cum[k]) / segLen)) : 0;
      out.push({
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
        tx: 0, tz: 0, lx: 0, lz: 0,
        halfWidth: (a.w + (b.w - a.w) * f) / 2,
        bank: a.b + (b.b - a.b) * f,
        s,
        curvature: 0,
        kerbL: false,
        kerbR: false,
      });
    }
    const m = out.length;
    const at = (i: number) => (d.closed ? out[((i % m) + m) % m] : out[Math.max(0, Math.min(m - 1, i))]);
    for (let i = 0; i < m; i++) {
      const a = at(i - 1), b = at(i + 1);
      const tx = b.x - a.x, tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      out[i].tx = tx / l;
      out[i].tz = tz / l;
      // left of travel in a Y-up, X/Z plane: rotate the tangent +90 degrees about +Y
      out[i].lx = tz / l;
      out[i].lz = -tx / l;
    }
    for (let i = 0; i < m; i++) {
      const a = at(i - 3), b = at(i + 3);
      const cross = a.tx * b.tz - a.tz * b.tx;
      const dot = a.tx * b.tx + a.tz * b.tz;
      // positive curvature = turning left
      out[i].curvature = -Math.atan2(cross, dot) / Math.max(1, b.s - a.s || 6);
    }
    // kerbs on corners: inside and outside where the radius is under ~90 m
    const mode = d.kerbs ?? 'corners';
    if (mode !== 'none') {
      const flags = out.map((p) => mode === 'all' || Math.abs(p.curvature) > 1 / 90);
      for (let i = 0; i < m; i++) {
        let on = false;
        for (let j = -8; j <= 8 && !on; j++) on = flags[d.closed ? (((i + j) % m) + m) % m : Math.max(0, Math.min(m - 1, i + j))];
        out[i].kerbL = on;
        out[i].kerbR = on;
      }
    }
    this.samples = out;
    this.length = total;
    this.segCount = d.closed ? m : m - 1;
    // spatial grid over segments
    const reach = Math.max(...out.map((p) => p.halfWidth)) + KERB_WIDTH + BLEND + 2;
    for (let i = 0; i < this.segCount; i++) {
      const a = out[i], b = out[(i + 1) % m];
      const x0 = Math.floor((Math.min(a.x, b.x) - reach) / this.cell), x1 = Math.floor((Math.max(a.x, b.x) + reach) / this.cell);
      const z0 = Math.floor((Math.min(a.z, b.z) - reach) / this.cell), z1 = Math.floor((Math.max(a.z, b.z) + reach) / this.cell);
      for (let ix = x0; ix <= x1; ix++)
        for (let iz = z0; iz <= z1; iz++) {
          const key = (ix + 4096) * 8192 + iz + 4096;
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(i);
        }
    }
  }

  /** Nearest point on the centre line. Returns false when (x, z) is out of the road's reach. */
  project(x: number, z: number, out: Projection): boolean {
    const list = this.grid.get((Math.floor(x / this.cell) + 4096) * 8192 + Math.floor(z / this.cell) + 4096);
    if (!list) return false;
    const S = this.samples;
    const m = S.length;
    let best = Infinity;
    for (const i of list) {
      const a = S[i], b = S[(i + 1) % m];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = a.x + dx * t, cz = a.z + dz * t;
      const lx = a.lx + (b.lx - a.lx) * t, lz = a.lz + (b.lz - a.lz) * t;
      // true distance to the segment, signed by side (a pure normal projection would let a
      // far-away segment "win" when the point lies beyond its clamped end)
      const side = (x - cx) * lx + (z - cz) * lz >= 0 ? 1 : -1;
      const lat = side * Math.hypot(x - cx, z - cz);
      const hw = a.halfWidth + (b.halfWidth - a.halfWidth) * t;
      const outside = Math.abs(lat) - hw;
      if (outside < best) {
        best = outside;
        out.index = i;
        out.t = t;
        out.lateral = lat;
        out.halfWidth = hw;
        out.y = a.y + (b.y - a.y) * t;
        out.bank = a.bank + (b.bank - a.bank) * t;
        out.s = a.s + (b.s - a.s) * t;
        out.kerbL = a.kerbL;
        out.kerbR = a.kerbR;
        out.outside = outside;
      }
    }
    return best < Infinity;
  }

  /** Road height at lateral offset `lat` given a projection. */
  heightAt(p: Projection, lat: number): number {
    return p.y + lat * Math.tan(p.bank);
  }
}

export interface Projection {
  index: number;
  t: number;
  lateral: number;
  halfWidth: number;
  y: number;
  bank: number;
  s: number;
  kerbL: boolean;
  kerbR: boolean;
  outside: number;
}

function newProjection(): Projection {
  return { index: 0, t: 0, lateral: 0, halfWidth: 0, y: 0, bank: 0, s: 0, kerbL: false, kerbR: false, outside: 0 };
}

/** The physical world of one location: roads + pads + terrain + walls. */
export interface WallLine {
  points: [number, number, number][];
  type: WallMaterial;
  height: number;
  closed: boolean;
  /** which side of the line faces the road (+1 = left of the polyline direction) */
  face: 1 | -1;
  style?: string;
}

export class Track implements PhysicsWorld {
  roads: Road[];
  walls = new WallSet();
  /** wall polylines, kept for the renderer */
  wallLines: WallLine[] = [];
  wetness = 0;
  private proj = newProjection();
  private best = newProjection();
  private hs = makeSample();
  private noise: Noise;

  constructor(public def: TrackDef) {
    this.roads = def.roads.map((r) => new Road(r));
    this.noise = new Noise(def.terrain.seed);
    this.buildWalls();
  }

  terrainHeight(x: number, z: number): number {
    const t = this.def.terrain;
    let h = t.base + this.noise.fbm(x / t.scale, z / t.scale, 4) * t.amp;
    if (t.tilt) h += t.tilt[0] * x + t.tilt[1] * z;
    if (t.hills)
      for (const hl of t.hills) {
        const d = Math.hypot(x - hl.x, z - hl.z) / hl.r;
        if (d < 1) {
          const c = Math.cos(d * Math.PI * 0.5);
          h += hl.h * c * c * (0.85 + 0.3 * this.noise.fbm(x / 120 + 3, z / 120 - 7, 3));
        }
      }
    if (t.sea) {
      const k = smoothstep(t.sea.x0 + t.sea.width * 0.5, t.sea.x0 - t.sea.width * 0.5, x + this.noise.fbm(z / 200, 1.7, 3) * 60);
      h = h * (1 - k) + (t.sea.level - t.sea.depth) * k;
    }
    if (t.rise) {
      const d = Math.hypot(x - t.rise.x, z - t.rise.z) - t.rise.r;
      if (d > 0) h += t.rise.height * (1 - Math.exp(-d / t.rise.falloff)) * (0.75 + 0.5 * this.noise.fbm(x / 90 + 17, z / 90 - 3, 3));
    }
    return h;
  }

  /** Height + surface without the normal (cheap). */
  heightSurface(x: number, z: number, out: { h: number; surface: SurfaceId; onRoad: boolean; road?: Road }): void {
    let bestRoad: Road | undefined;
    let bestOutside = Infinity;
    for (const r of this.roads) {
      if (!r.project(x, z, this.proj)) continue;
      if (this.proj.outside < bestOutside) {
        bestOutside = this.proj.outside;
        bestRoad = r;
        Object.assign(this.best, this.proj);
      }
    }
    const terrain = this.terrainHeight(x, z);
    let h = terrain;
    let surface: SurfaceId = this.def.terrain.ground ?? 'grass';
    let onRoad = false;
    if (bestRoad) {
      const p = this.best;
      const lat = p.lateral;
      const side = lat >= 0 ? 1 : -1;
      const kerb = side > 0 ? p.kerbL : p.kerbR;
      const a = Math.abs(lat);
      if (a <= p.halfWidth) {
        h = bestRoad.heightAt(p, lat);
        surface = bestRoad.surface;
        onRoad = true;
        if ((bestRoad.def.lines ?? 'edge') !== 'none' && a > p.halfWidth - 0.45 && a < p.halfWidth - 0.2) surface = 'paint';
      } else if (kerb && a <= p.halfWidth + KERB_WIDTH) {
        const e = a - p.halfWidth;
        h = bestRoad.heightAt(p, side * p.halfWidth) + Math.min(1, e / 0.35) * 0.04 + 0.012 * Math.abs(Math.sin((p.s * Math.PI) / 1.0));
        surface = 'kerb';
        onRoad = true;
      } else {
        const edge = p.halfWidth + (kerb ? KERB_WIDTH : 0);
        const e = a - edge;
        const he = bestRoad.heightAt(p, side * edge) + (kerb ? 0.03 : -0.02);
        const k = smoothstep(SHOULDER_WIDTH * 0.6, BLEND, e);
        h = he + (terrain - he) * k;
        surface = e < SHOULDER_WIDTH ? bestRoad.shoulder : (this.def.terrain.ground ?? 'grass');
      }
    }
    // pads (paddocks, the skidpad)
    for (const pad of this.def.pads) {
      const sd = padDistance(pad, x, z);
      const blend = pad.blend ?? 10;
      if (sd >= blend) continue;
      if (onRoad && sd > 0) continue;
      if (sd <= 0) {
        if (!onRoad) {
          h = pad.y;
          surface = pad.surface;
          onRoad = true;
        }
      } else {
        const k = smoothstep(0, blend, sd);
        h = pad.y + (h - pad.y) * k;
      }
    }
    out.h = h;
    out.surface = surface;
    out.onRoad = onRoad;
    out.road = bestRoad;
  }

  private hsTmp = { h: 0, surface: 'asphalt' as SurfaceId, onRoad: false } as { h: number; surface: SurfaceId; onRoad: boolean; road?: Road };

  sampleGround(x: number, z: number, out: GroundSample): GroundSample {
    const t = this.hsTmp;
    this.heightSurface(x, z, t);
    const h = t.h;
    const surface = t.surface;
    const e = 0.3;
    this.heightSurface(x + e, z, t);
    const hx1 = t.h;
    this.heightSurface(x - e, z, t);
    const hx0 = t.h;
    this.heightSurface(x, z + e, t);
    const hz1 = t.h;
    this.heightSurface(x, z - e, t);
    const hz0 = t.h;
    const nx = -(hx1 - hx0) / (2 * e);
    const nz = -(hz1 - hz0) / (2 * e);
    const l = Math.hypot(nx, 1, nz);
    out.height = h;
    out.nx = nx / l;
    out.ny = 1 / l;
    out.nz = nz / l;
    out.surface = surface;
    return out;
  }

  height(x: number, z: number): number {
    this.heightSurface(x, z, this.hsTmp);
    return this.hsTmp.h;
  }

  private buildWalls(): void {
    for (const road of this.roads) {
      const S = road.samples;
      const m = S.length;
      for (const w of road.def.walls ?? []) {
        const pts: [number, number, number][] = [];
        const i0 = Math.floor(w.from * m), i1 = Math.floor(w.to * m);
        const span = i1 >= i0 ? i1 - i0 : m - i0 + i1;
        const side = w.side === 'left' ? 1 : -1;
        for (let k = 0; k <= span; k += 2) {
          const p = S[(i0 + k) % m];
          const kerb = side > 0 ? p.kerbL : p.kerbR;
          const off = p.halfWidth + (kerb ? KERB_WIDTH : 0) + w.offset;
          const x = p.x + p.lx * off * side, z = p.z + p.lz * off * side;
          pts.push([x, this.height(x, z), z]);
        }
        const r = w.type === 'tire' ? 0.45 : w.type === 'guardrail' ? 0.2 : 0.35;
        this.walls.addPolyline(pts, r, w.height ?? 1.0, w.type);
        this.wallLines.push({ points: pts, type: w.type, height: w.height ?? 1.0, closed: false, face: side > 0 ? -1 : 1 });
      }
    }
    // tunnel walls are solid
    const tun = this.def.tunnel as { from: number; to: number } | undefined;
    if (tun && this.roads[0]) {
      const S = this.roads[0].samples;
      for (const side of [1, -1]) {
        const pts: [number, number, number][] = [];
        for (const p of S) {
          if (p.s < tun.from || p.s > tun.to) continue;
          const off = side * (p.halfWidth + 1.4);
          pts.push([p.x + p.lx * off, p.y, p.z + p.lz * off]);
        }
        this.walls.addPolyline(pts.filter((_, i) => i % 2 === 0), 0.35, 7, 'concrete');
      }
    }
    for (const w of this.def.walls ?? []) {
      const r = w.radius ?? (w.type === 'tire' ? 0.45 : 0.35);
      if (w.circle) {
        const c = w.circle;
        const segs = c.segments ?? Math.max(24, Math.round((2 * Math.PI * c.r) / 2));
        const pts: [number, number, number][] = [];
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const x = c.x + Math.cos(a) * c.r, z = c.z + Math.sin(a) * c.r;
          pts.push([x, this.height(x, z), z]);
        }
        this.walls.addPolyline(pts, r, w.height ?? 1.0, w.type, true);
        this.wallLines.push({ points: pts, type: w.type, height: w.height ?? 1.0, closed: true, face: 1 });
      } else if (w.points) {
        const pts = w.points.map((p) => [p[0], p.length > 2 ? p[1] : this.height(p[0], p[1]), p.length > 2 ? p[2] : p[1]] as [number, number, number]);
        this.walls.addPolyline(pts, r, w.height ?? 1.0, w.type, w.closed);
        this.wallLines.push({ points: pts, type: w.type, height: w.height ?? 1.0, closed: !!w.closed, face: 1, style: (w as { container?: boolean }).container ? 'container' : undefined });
      }
    }
  }

  /** Which road and how far along it, for minimap / progress. */
  locate(x: number, z: number): { road: Road; s: number; lateral: number } | null {
    let res: { road: Road; s: number; lateral: number } | null = null;
    let best = Infinity;
    for (const r of this.roads) {
      if (!r.project(x, z, this.proj)) continue;
      if (this.proj.outside < best) {
        best = this.proj.outside;
        res = { road: r, s: this.proj.s, lateral: this.proj.lateral };
      }
    }
    return res;
  }
}

export function padDistance(p: PadDef, x: number, z: number): number {
  if (p.shape === 'circle') return Math.hypot(x - p.x, z - p.z) - (p.r ?? 10);
  const c = Math.cos(-(p.rot ?? 0)), s = Math.sin(-(p.rot ?? 0));
  const dx = x - p.x, dz = z - p.z;
  const lx = Math.abs(dx * c - dz * s) - (p.w ?? 10) / 2;
  const lz = Math.abs(dx * s + dz * c) - (p.d ?? 10) / 2;
  const ox = Math.max(lx, 0), oz = Math.max(lz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(lx, lz), 0);
}

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function smooth(u: number): number {
  return u * u * (3 - 2 * u);
}
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Small seeded value-noise with fBm, deterministic across runs. */
export class Noise {
  private perm: Uint8Array;
  constructor(seed: number) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed >>> 0 || 1;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  private v(ix: number, iz: number): number {
    return this.perm[(this.perm[ix & 255] + iz) & 511] / 127.5 - 1;
  }
  noise(x: number, z: number): number {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz);
    const a = this.v(ix, iz), b = this.v(ix + 1, iz), c = this.v(ix, iz + 1), d = this.v(ix + 1, iz + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  }
  fbm(x: number, z: number, oct: number): number {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += this.noise(x * f, z * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }
}
