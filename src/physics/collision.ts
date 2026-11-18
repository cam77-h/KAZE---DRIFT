import type { SurfaceId } from './types';

/** Everything the vehicle needs from the world. Implemented by world/track.ts. */
export interface GroundSample {
  height: number;
  nx: number;
  ny: number;
  nz: number;
  surface: SurfaceId;
}

export interface PhysicsWorld {
  sampleGround(x: number, z: number, out: GroundSample): GroundSample;
  walls: WallSet;
  /** 0 dry .. 1 soaked; set by weather */
  wetness: number;
}

export function makeSample(): GroundSample {
  return { height: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' };
}

export type WallMaterial = 'tire' | 'concrete' | 'guardrail' | 'fence' | 'building';

/** A wall is a vertical capsule in plan view: segment (x1,z1)-(x2,z2) with radius r. */
export interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  r: number;
  /** height of the top of the wall above its base; cars above it pass over */
  base: number;
  top: number;
  material: WallMaterial;
}

export interface WallHit {
  /** penetration depth (m) */
  depth: number;
  /** push-out normal in plan (unit) */
  nx: number;
  nz: number;
  /** closest point on the wall surface */
  px: number;
  pz: number;
  wall: Wall;
}

/** Uniform-grid spatial hash over wall capsules. */
export class WallSet {
  readonly walls: Wall[] = [];
  private grid = new Map<number, number[]>();
  constructor(private cell = 16) {}

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  add(w: Wall): void {
    const idx = this.walls.length;
    this.walls.push(w);
    const minX = Math.floor((Math.min(w.x1, w.x2) - w.r) / this.cell);
    const maxX = Math.floor((Math.max(w.x1, w.x2) + w.r) / this.cell);
    const minZ = Math.floor((Math.min(w.z1, w.z2) - w.r) / this.cell);
    const maxZ = Math.floor((Math.max(w.z1, w.z2) + w.r) / this.cell);
    for (let ix = minX; ix <= maxX; ix++)
      for (let iz = minZ; iz <= maxZ; iz++) {
        const k = this.key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(idx);
      }
  }

  /** Add a polyline as a chain of capsules. */
  addPolyline(points: [number, number, number][], r: number, height: number, material: WallMaterial, closed = false): void {
    const n = points.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const base = Math.min(a[1], b[1]) - 0.5;
      this.add({ x1: a[0], z1: a[2], x2: b[0], z2: b[2], r, base, top: Math.max(a[1], b[1]) + height, material });
    }
  }

  /** Deepest penetration of point (x, y, z) into any wall, or null. */
  query(x: number, y: number, z: number, out: WallHit): WallHit | null {
    const list = this.grid.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return null;
    let best = 0;
    let found = false;
    for (const i of list) {
      const w = this.walls[i];
      if (y > w.top || y < w.base) continue;
      const dx = w.x2 - w.x1;
      const dz = w.z2 - w.z1;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - w.x1) * dx + (z - w.z1) * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = w.x1 + dx * t;
      const cz = w.z1 + dz * t;
      const ex = x - cx;
      const ez = z - cz;
      const d = Math.hypot(ex, ez);
      const depth = w.r - d;
      if (depth > best) {
        best = depth;
        found = true;
        let nx: number, nz: number;
        if (d > 1e-6) {
          nx = ex / d;
          nz = ez / d;
        } else {
          // exactly on the centre line: push along the segment normal
          const l = Math.sqrt(len2) || 1;
          nx = -dz / l;
          nz = dx / l;
        }
        out.depth = depth;
        out.nx = nx;
        out.nz = nz;
        out.px = cx + nx * w.r;
        out.pz = cz + nz * w.r;
        out.wall = w;
      }
    }
    return found ? out : null;
  }

  clear(): void {
    this.walls.length = 0;
    this.grid.clear();
  }
}

/** A flat infinite ground, used by tests and as a fallback. */
export class FlatWorld implements PhysicsWorld {
  walls = new WallSet();
  wetness = 0;
  constructor(
    public surface: SurfaceId = 'asphalt',
    public height = 0,
  ) {}
  sampleGround(_x: number, _z: number, out: GroundSample): GroundSample {
    out.height = this.height;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.surface = this.surface;
    return out;
  }
}
