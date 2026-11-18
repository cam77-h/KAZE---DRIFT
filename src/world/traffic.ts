import * as THREE from 'three';
import type { Track, Road } from './track';
import type { Vehicle } from '../physics/vehicle';
import { TRAFFIC, type TrafficDef } from '../data';
import { loadCarModel, type LoadedCarModel } from '../vehicles/modelLoader';
import type { Section } from './openRoadScenery';

// Lane-following AI traffic for the Open Road. Cars keep left (Japan), follow the car ahead,
// brake and honk for the player, and spawn/despawn in a window around the player. Models are
// pooled at load time, so nothing loads while driving.

interface TrafficCar {
  model: LoadedCarModel;
  def: TrafficDef;
  group: THREE.Group;
  active: boolean;
  s: number;
  dir: 1 | -1;
  lane: number;
  speed: number;
  target: number;
  hl: number;
  hw: number;
  hitTimer: number;
  honk: number;
  passSign: number;
  passed: boolean;
  yaw: number;
  vx: number;
  vz: number;
  wheelAngle: number;
}

export interface TrafficEvents {
  onNearMiss(car: TrafficCar, gap: number): void;
  onHit(speed: number): void;
  onHonk(): void;
}

export class TrafficSystem {
  readonly group = new THREE.Group();
  cars: TrafficCar[] = [];
  private road: Road;
  private sections: Section[];
  density = 1;
  enabled = true;
  private tmp = new THREE.Vector3();

  constructor(
    private track: Track,
    private events: TrafficEvents,
  ) {
    this.road = track.roads[0];
    this.sections = (track.def.sections ?? []) as Section[];
    this.group.name = 'traffic';
  }

  /** Load the model pool (call during the loading screen). */
  async init(poolSize: number, onProgress?: (f: number) => void): Promise<void> {
    const defs = Object.values(TRAFFIC).filter((d) => d.weight > 0);
    const total = defs.reduce((a, d) => a + d.weight, 0);
    const pick = (r: number) => {
      let acc = 0;
      for (const d of defs) {
        acc += d.weight / total;
        if (r <= acc) return d;
      }
      return defs[defs.length - 1];
    };
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let done = 0;
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < poolSize; i++) {
      const def = pick(rnd());
      jobs.push(
        loadCarModel(def.glb)
          .then((m) => {
            if (def.paint) m.setPaint(def.paint, 'gloss');
            const g = new THREE.Group();
            g.add(m.root);
            g.visible = false;
            this.group.add(g);
            this.cars.push({ model: m, def, group: g, active: false, s: 0, dir: 1, lane: 0, speed: 0, target: 0, hl: m.dims.length / 2, hw: m.dims.width / 2 * 0.95, hitTimer: 0, honk: 0, passSign: 0, passed: false, yaw: 0, vx: 0, vz: 0, wheelAngle: 0 });
          })
          .catch(() => undefined)
          .finally(() => onProgress?.(++done / poolSize)),
      );
    }
    await Promise.all(jobs);
  }

  sectionAt(s: number): Section | undefined {
    const L = this.road.length;
    const ss = ((s % L) + L) % L;
    return this.sections.find((x) => ss >= x.from && ss < x.to) ?? this.sections[0];
  }

  private sample(s: number) {
    const S = this.road.samples;
    const L = this.road.length;
    const ss = ((s % L) + L) % L;
    const f = (ss / L) * S.length;
    const i = Math.floor(f) % S.length;
    const j = (i + 1) % S.length;
    const t = f - Math.floor(f);
    const a = S[i], b = S[j];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: a.tx, tz: a.tz, lx: a.lx, lz: a.lz, hw: a.halfWidth + (b.halfWidth - a.halfWidth) * t };
  }

  private laneOffset(c: TrafficCar, hw: number, lanes: number): number {
    // Japan keeps left: travelling along +s means the left half of the road
    const lw = hw / lanes;
    return c.dir * (lw * (c.lane + 0.5));
  }

  reset(): void {
    for (const c of this.cars) {
      c.active = false;
      c.group.visible = false;
    }
  }

  update(dt: number, player: Vehicle, playerS: number): void {
    if (!this.enabled) return;
    const L = this.road.length;
    const ahead = 650, behind = 350;
    // despawn far cars
    for (const c of this.cars) {
      if (!c.active) continue;
      let d = c.s - playerS;
      d = ((d + L / 2) % L + L) % L - L / 2;
      if (d > ahead + 50 || d < -behind - 50) {
        c.active = false;
        c.group.visible = false;
      }
    }
    // spawn to fill the density budget
    const free = this.cars.filter((c) => !c.active);
    const active = this.cars.length - free.length;
    const sec = this.sectionAt(playerS);
    const want = Math.min(this.cars.length, Math.round(((sec?.density ?? 0.5) * this.density * (ahead + behind)) / 100 * 2));
    let tries = 0;
    while (free.length && active + (this.cars.length - free.length - active) < want && tries++ < 4) {
      const c = free.pop()!;
      // spawn out of sight: ahead or behind the player
      const offset = Math.random() < 0.6 ? 380 + Math.random() * 260 : -(220 + Math.random() * 120);
      const s = ((playerS + offset) % L + L) % L;
      const sx = this.sectionAt(s);
      if (!sx) continue;
      c.s = s;
      c.dir = Math.random() < 0.5 ? 1 : -1;
      c.lane = Math.floor(Math.random() * sx.lanes);
      c.target = (sx.speed / 3.6) * (0.85 + Math.random() * 0.3);
      c.speed = c.target;
      c.active = true;
      c.hitTimer = 0;
      c.passed = false;
      c.passSign = 0;
      c.group.visible = true;
      if (this.tooClose(c)) {
        c.active = false;
        c.group.visible = false;
        free.push(c);
      }
    }

    const ps = player.position;
    for (const c of this.cars) {
      if (!c.active) continue;
      const sx = this.sectionAt(c.s)!;
      c.target = (sx.speed / 3.6) * (c.lane === 1 ? 1.15 : 1);
      // follow the car ahead in the same lane
      let gap = Infinity;
      for (const o of this.cars) {
        if (o === c || !o.active || o.dir !== c.dir || o.lane !== c.lane) continue;
        let d = (o.s - c.s) * c.dir;
        d = ((d % L) + L) % L;
        if (d < gap) gap = d;
      }
      // the player ahead in our lane
      const p = this.sample(c.s);
      const toP = this.tmp.set(ps.x - p.x, 0, ps.z - p.z);
      const along = (toP.x * p.tx + toP.z * p.tz) * c.dir;
      const lat = toP.x * p.lx + toP.z * p.lz;
      const myLat = this.laneOffset(c, p.hw, sx.lanes);
      if (along > 0 && along < 40 && Math.abs(lat - myLat) < 2.4) {
        gap = Math.min(gap, along);
        if (along < 22 && c.honk <= 0) {
          this.events.onHonk();
          c.honk = 4;
        }
      }
      c.honk -= dt;
      let tgt = c.target;
      if (gap < 40) tgt = Math.min(tgt, Math.max(0, (gap - 9) * 0.6));
      if (c.hitTimer > 0) {
        c.hitTimer -= dt;
        tgt = 0;
      }
      c.speed += Math.max(-9 * dt, Math.min(3 * dt, tgt - c.speed));
      c.s = ((c.s + c.speed * c.dir * dt) % L + L) % L;

      // place the model
      const q = this.sample(c.s);
      const off = this.laneOffset(c, q.hw, sx.lanes);
      const x = q.x + q.lx * off, z = q.z + q.lz * off;
      const y = this.track.height(x, z);
      c.yaw = Math.atan2(q.tx * c.dir, q.tz * c.dir);
      c.vx = q.tx * c.dir * c.speed;
      c.vz = q.tz * c.dir * c.speed;
      c.group.position.set(x, y, z);
      // pitch with the road
      const ahead2 = this.track.height(x + q.tx * c.dir * 2, z + q.tz * c.dir * 2);
      c.group.rotation.set(0, c.yaw, 0);
      c.group.rotateX(-Math.atan2(ahead2 - y, 2));
      c.wheelAngle += (c.speed / Math.max(0.2, c.model.dims.wheelRadius)) * dt;
      for (const w of c.model.wheels) w.spin.rotation.x = c.wheelAngle;
      const dist = Math.hypot(x - ps.x, z - ps.z);
      c.group.visible = dist < 700;

      // collision + near miss with the player
      if (dist < 12) {
        const hit = player.collideBox(x, y + 0.5, z, c.yaw, c.hl, c.hw, c.vx, c.vz);
        if (hit > 1) {
          c.hitTimer = 4;
          c.passed = true;
          this.events.onHit(hit);
        }
      }
      if (dist < 25) {
        // longitudinal position of the player relative to this car, and the side gap
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        const rx = ps.x - x, rz = ps.z - z;
        const lon = rx * fx + rz * fz;
        const side = Math.abs(rx * fz - rz * fx) - c.hw - player.spec.width / 2;
        const sign = Math.sign(lon) || 1;
        if (c.passSign !== 0 && sign !== c.passSign && !c.passed && side < 1.6 && side > -0.3) {
          const rel = Math.hypot(player.velocity.x - c.vx, player.velocity.z - c.vz);
          if (rel > 6 && c.hitTimer <= 0) {
            c.passed = true;
            this.events.onNearMiss(c, side);
          }
        }
        c.passSign = sign;
      } else {
        c.passSign = 0;
        c.passed = false;
      }
    }
  }

  private tooClose(c: TrafficCar): boolean {
    const L = this.road.length;
    for (const o of this.cars) {
      if (o === c || !o.active || o.dir !== c.dir || o.lane !== c.lane) continue;
      let d = Math.abs(o.s - c.s);
      d = Math.min(d, L - d);
      if (d < 30) return true;
    }
    return false;
  }

  get activeCount(): number {
    return this.cars.filter((c) => c.active).length;
  }
}
