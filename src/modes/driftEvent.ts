import * as THREE from 'three';
import { ECONOMY, MEDAL_LABEL, formatYen, medalFor, type Medal } from '../core/progression';
import type { Road } from '../world/track';
import type { GameApi, ModeController, SessionConfig, SessionResult } from './types';
import { eventKey } from './types';
import { bestRecord, medalBonus, payout, submitRecord, xpForPoints } from './rewards';
import eventsJson from '../data/events.json';
import { carDef } from '../data';
import { buildCarVisual, type CarVisual } from '../vehicles/carVisual';

// Drift Track events: Drift Attack (one judged lap), Time Attack (3 laps with ghost, sectors
// and delta) and Tandem Chase (follow a scripted lead car).

interface VenueEvents {
  driftattack: Record<Medal, number>;
  timeattack: Record<Medal, number>;
  tandem: Record<Medal, number>;
  laps: number;
  leadCar: string;
}
const EVENTS = eventsJson as unknown as Record<string, VenueEvents>;

interface Clip {
  s: number;
  x: number;
  z: number;
  kind: 'inner' | 'outer';
  hit: boolean;
  mesh: THREE.Mesh;
}

/** Auto-place clipping points: an inner point at each corner's apex, an outer zone on its exit. */
export function makeClips(road: Road): { s: number; side: number; lat: number; kind: 'inner' | 'outer' }[] {
  const S = road.samples;
  const out: { s: number; side: number; lat: number; kind: 'inner' | 'outer' }[] = [];
  let i = 0;
  while (i < S.length) {
    if (Math.abs(S[i].curvature) > 1 / 70) {
      let j = i, apex = i;
      while (j < S.length && Math.abs(S[j].curvature) > 1 / 90) {
        if (Math.abs(S[j].curvature) > Math.abs(S[apex].curvature)) apex = j;
        j++;
      }
      if (j - i > 12) {
        const inside = Math.sign(S[apex].curvature); // + = turning left: inside is left
        out.push({ s: S[apex].s, side: inside, lat: inside * (S[apex].halfWidth - 1.2), kind: 'inner' });
        const ex = Math.min(S.length - 1, apex + Math.round((j - apex) * 0.8) + 6);
        out.push({ s: S[ex].s, side: -inside, lat: -inside * (S[ex].halfWidth - 1.5), kind: 'outer' });
      }
      i = j + 1;
    } else i++;
  }
  return out;
}

export class DriftEventMode implements ModeController {
  done = false;
  private api!: GameApi;
  private road!: Road;
  private ev!: VenueEvents;
  private started = false;
  private lap = 0;
  private lastS = 0;
  private lapTime = 0;
  private laps: number[] = [];
  private sectorBest: number[] = [];
  private sectors: number[] = [];
  private sectorMarks: number[] = [];
  private clips: Clip[] = [];
  private group = new THREE.Group();
  private offTimer = 0;
  // judging sums
  private angleSum = 0;
  private speedSum = 0;
  private lineSum = 0;
  private samples = 0;
  private bestMult = 1;
  // ghost
  private rec: number[] = [];
  private ghost: Float32Array | null = null;
  private ghostVisual: CarVisual | null = null;
  private recT = 0;
  // tandem
  private lead: { s: number; v: number; visual: CarVisual | null; angle: number } | null = null;
  private tandemProx = 0;
  private tandemAngle = 0;
  private tandemN = 0;

  constructor(readonly config: SessionConfig) {}

  get title(): string {
    return this.config.event === 'driftattack' ? 'DRIFT ATTACK' : this.config.event === 'timeattack' ? 'TIME ATTACK' : 'TANDEM CHASE';
  }

  async setup(api: GameApi): Promise<void> {
    this.api = api;
    this.road = api.track.roads[0];
    this.ev = EVENTS[this.config.location] ?? EVENTS.minami;
    api.scene.add(this.group);
    api.chain.reset();
    const L = this.road.length;
    this.sectorMarks = [L / 3, (2 * L) / 3];
    if (this.config.event === 'driftattack') {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff2a4a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
      const zoneMat = new THREE.MeshBasicMaterial({ color: 0x7cf3ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
      for (const c of makeClips(this.road)) {
        const p = this.road.samples[Math.floor((c.s / L) * this.road.samples.length) % this.road.samples.length];
        const x = p.x + p.lx * c.lat, z = p.z + p.lz * c.lat;
        const y = api.track.height(x, z);
        const mesh = new THREE.Mesh(c.kind === 'inner' ? new THREE.CylinderGeometry(0.5, 0.5, 2.4, 16, 1, true) : new THREE.BoxGeometry(1, 0.15, 10), c.kind === 'inner' ? mat : zoneMat);
        mesh.position.set(x, y + (c.kind === 'inner' ? 1.2 : 0.08), z);
        mesh.rotation.y = Math.atan2(p.tx, p.tz);
        this.group.add(mesh);
        this.clips.push({ s: c.s, x, z, kind: c.kind, hit: false, mesh });
        api.addMarker('clip', x, z);
      }
    }
    if (this.config.event === 'timeattack') {
      const g = api.save.records.ghosts[eventKey(this.config) + '|' + api.carId];
      if (g) {
        this.ghost = decodeGhost(g);
        this.ghostVisual = await buildCarVisual(carDef(api.carId), '#7cf3ff', 'gloss');
        this.ghostVisual.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            m.material = mats.map(() => new THREE.MeshBasicMaterial({ color: 0x7cf3ff, transparent: true, opacity: 0.28, depthWrite: false }));
            m.castShadow = false;
          }
        });
        for (const w of this.ghostVisual.wheels) this.ghostVisual.root.add(w.pivot);
        this.group.add(this.ghostVisual.root);
      }
    }
    if (this.config.event === 'tandem') {
      const def = carDef(this.ev.leadCar);
      const visual = await buildCarVisual(def, '#111317', 'metallic');
      for (const w of visual.wheels) visual.root.add(w.pivot);
      // place the procedural wheels on the axle corners
      if (visual.kind === 'procedural') {
        const d = visual.dims;
        visual.root.children[0].position.y = 0;
        visual.wheels.forEach((w, i) => w.pivot.position.set(((i % 2 ? -1 : 1) * (i < 2 ? d.trackFront : d.trackRear)) / 2, d.wheelRadius, i < 2 ? d.frontAxleZ : d.rearAxleZ));
      }
      this.group.add(visual.root);
      this.lead = { s: 25, v: 0, visual, angle: 0 };
    }
    this.lastS = api.playerS();
    api.chain.enabled = this.config.event !== 'timeattack';
  }

  private crossedStart(a: number, b: number): boolean {
    const L = this.road.length;
    return a > L - 60 && b < 60;
  }

  step(dt: number): void {
    const api = this.api;
    const v = api.vehicle;
    const s = api.playerS();
    const L = this.road.length;
    // the event starts at the first crossing of the start line
    if (this.crossedStart(this.lastS, s) || (!this.started && this.config.event === 'tandem' && s > 5 && s < 60)) {
      if (!this.started) {
        this.started = true;
        this.lap = 1;
        this.lapTime = 0;
        this.sectors = [];
        api.banner(this.title, this.config.event === 'timeattack' ? `LAP 1 / ${this.ev.laps}` : 'GO', '#e8202f');
        api.sound('checkpoint');
      } else this.completeLap();
    }
    if (this.started && !this.done) {
      this.lapTime += dt;
      for (let k = 0; k < this.sectorMarks.length; k++) {
        if (this.sectors.length === k && this.lastS < this.sectorMarks[k] && s >= this.sectorMarks[k] && s - this.lastS < 60) {
          this.sectors.push(this.lapTime);
          const best = this.sectorBest[k];
          const delta = best !== undefined ? this.lapTime - best : 0;
          api.toast(`SECTOR ${k + 1}  ${fmtTime(this.lapTime)}${best !== undefined ? `  ${delta <= 0 ? '−' : '+'}${Math.abs(delta).toFixed(2)}` : ''}`, 2);
        }
      }
      // ghost recording at 30 Hz
      this.recT += dt;
      if (this.config.event === 'timeattack' && this.recT >= 1 / 30) {
        this.recT = 0;
        this.rec.push(v.position.x, v.position.y, v.position.z, v.yaw);
      }
      this.judge(dt, s);
    }
    if (this.lead) this.stepLead(dt);
    this.lastS = s;
  }

  private judge(dt: number, s: number): void {
    const api = this.api;
    const v = api.vehicle;
    const t = v.telemetry;
    const L = this.road.length;
    const S = this.road.samples;
    const p = S[Math.floor((s / L) * S.length) % S.length];
    // line: the ideal line runs outside-in-outside, wide of the corner's inside
    const loc = api.track.locate(v.position.x, v.position.z);
    const lat = loc?.lateral ?? 0;
    const ideal = -Math.sign(p.curvature) * Math.min(1, Math.abs(p.curvature) * 60) * p.halfWidth * 0.35;
    const lineF = 1 - 0.5 * Math.min(1, Math.abs(lat - ideal) / Math.max(1, p.halfWidth));
    // proximity to the next clipping point
    let proxF = 1;
    for (const c of this.clips) {
      const d = Math.hypot(v.position.x - c.x, v.position.z - c.z);
      if (d < 6) proxF = Math.max(proxF, 1 + (6 - d) / 6);
      if (!c.hit && d < (c.kind === 'inner' ? 2.6 : 3.5) && Math.abs(t.driftAngle) > 0.17) {
        c.hit = true;
        (c.mesh.material as THREE.MeshBasicMaterial) = (c.mesh.material as THREE.MeshBasicMaterial).clone();
        (c.mesh.material as THREE.MeshBasicMaterial).color.set(0x3fd07a);
        api.chain.add('clip', c.kind === 'inner' ? 800 : 600, c.kind === 'inner' ? 'CLIPPING POINT' : 'CLIPPING ZONE');
      }
    }
    if (this.config.event !== 'timeattack') api.chain.update(dt, v, lineF * proxF);
    this.bestMult = Math.max(this.bestMult, api.chain.multiplier);
    // off-track: two or more wheels on grass/gravel
    const off = v.wheels.filter((w) => w.onGround && (w.surface === 'grass' || w.surface === 'gravel' || w.surface === 'dirt')).length;
    if (off >= 2) {
      this.offTimer += dt;
      if (this.offTimer > 0.3 && this.config.event !== 'timeattack') {
        api.chain.break('OFF TRACK');
        this.offTimer = -1.5;
      }
    } else this.offTimer = Math.min(0, this.offTimer + dt);
    if (Math.abs(t.driftAngle) > 0.17 && t.speed > 6) {
      this.angleSum += Math.abs(t.driftAngle) * 57.3;
      this.speedSum += t.speed * 3.6;
      this.lineSum += lineF;
      this.samples++;
    }
  }

  private stepLead(dt: number): void {
    const lead = this.lead!;
    const S = this.road.samples;
    const L = this.road.length;
    const p = S[Math.floor((lead.s / L) * S.length) % S.length];
    const ahead = S[Math.floor(((lead.s + 25) / L) * S.length) % S.length];
    const k = Math.max(Math.abs(p.curvature), Math.abs(ahead.curvature));
    const target = THREE.MathUtils.clamp(Math.sqrt(9.5 / Math.max(k, 1 / 400)), 13, 30);
    // wait at the start until the player rolls up behind, then go
    const playerS = this.api.playerS();
    const behind = ((lead.s - playerS) % L + L) % L;
    let tgt = target;
    if (!this.started && behind < 30) tgt = 0;
    if (behind > 45) tgt *= 0.75;
    lead.v += THREE.MathUtils.clamp(tgt - lead.v, -8 * dt, 4 * dt);
    lead.s = (lead.s + lead.v * dt) % L;
    const targetAngle = Math.abs(p.curvature) > 1 / 120 && lead.v > 10 ? Math.sign(p.curvature) * 0.55 : 0;
    lead.angle += (targetAngle - lead.angle) * Math.min(1, dt * 2);
    const q = S[Math.floor((lead.s / L) * S.length) % S.length];
    const off = -Math.sign(q.curvature) * Math.min(1, Math.abs(q.curvature) * 50) * q.halfWidth * 0.3;
    const x = q.x + q.lx * off, z = q.z + q.lz * off;
    const y = this.api.track.height(x, z);
    if (lead.visual) {
      lead.visual.root.position.set(x, y, z);
      lead.visual.root.rotation.set(0, Math.atan2(q.tx, q.tz) + lead.angle, 0);
      for (let i = 0; i < 4; i++) {
        lead.visual.wheels[i].spin.rotation.x += (lead.v / 0.31) * dt;
        if (i < 2) lead.visual.wheels[i].pivot.rotation.y = -lead.angle * 0.8;
      }
    }
    // tandem judging: proximity and angle match while the leader is sliding
    if (this.started && !this.done) {
      const v = this.api.vehicle;
      const d = Math.hypot(v.position.x - x, v.position.z - z);
      const prox = THREE.MathUtils.clamp(1 - (d - 4) / 16, 0, 1);
      const match = 1 - Math.min(1, Math.abs(Math.abs(v.telemetry.driftAngle) - Math.abs(lead.angle)) / 0.6);
      this.tandemProx += prox * dt;
      this.tandemAngle += match * dt;
      this.tandemN += dt;
      if (prox > 0.6 && Math.abs(v.telemetry.driftAngle) > 0.25 && Math.random() < dt * 0.5) this.api.chain.add('tandem', 600 * prox, 'TANDEM CLOSE');
    }
  }

  private completeLap(): void {
    const api = this.api;
    this.laps.push(this.lapTime);
    // keep the recording of the fastest lap for the ghost
    if (this.lapTime <= Math.min(...this.laps)) this.bestRec = this.rec.slice();
    this.sectors.forEach((t, i) => (this.sectorBest[i] = Math.min(this.sectorBest[i] ?? Infinity, t)));
    if (this.config.event !== 'timeattack' || this.lap >= this.ev.laps) {
      this.done = true;
      api.chain.bank();
      api.banner('FINISH', this.config.event === 'timeattack' ? `BEST ${fmtTime(Math.min(...this.laps))}` : `${api.chain.stats.banked.toLocaleString('en-US')} PTS`, '#3fd07a');
      api.finish();
      return;
    }
    const best = Math.min(...this.laps.slice(0, -1), Infinity);
    api.banner(`LAP ${this.lap}  ${fmtTime(this.lapTime)}`, best < Infinity ? `${this.lapTime < best ? 'BEST LAP' : `+${(this.lapTime - best).toFixed(2)}`}` : `LAP ${this.lap + 1} / ${this.ev.laps}`, this.lapTime < best ? '#3fd07a' : '#f2efe6');
    this.lap++;
    this.lapTime = 0;
    this.sectors = [];
    this.rec = [];
  }

  frame(): void {
    const api = this.api;
    if (!this.started) {
      api.setObjective(this.config.event === 'tandem' ? 'FOLLOW THE LEAD CAR · cross the line to start' : 'CROSS THE START LINE TO BEGIN');
    } else if (this.config.event === 'timeattack') {
      const best = this.laps.length ? Math.min(...this.laps) : null;
      api.setObjective(`LAP ${this.lap}/${this.ev.laps}  ${fmtTime(this.lapTime)}${best ? `   BEST ${fmtTime(best)}` : ''}`);
    } else if (this.config.event === 'driftattack') {
      const hit = this.clips.filter((c) => c.hit).length;
      api.setObjective(`SCORE ${(api.chain.stats.banked + api.chain.value).toLocaleString('en-US')}   CLIPS ${hit}/${this.clips.length}   GOLD ${this.ev.driftattack.gold.toLocaleString('en-US')}`);
    } else {
      const prox = this.tandemN ? (this.tandemProx / this.tandemN) * 100 : 0;
      api.setObjective(`PROXIMITY ${prox.toFixed(0)}%   ANGLE MATCH ${this.tandemN ? ((this.tandemAngle / this.tandemN) * 100).toFixed(0) : 0}%`);
    }
    // ghost playback
    if (this.ghost && this.ghostVisual && this.started && this.config.event === 'timeattack') {
      const i = Math.min(this.ghost.length / 4 - 1, Math.floor(this.lapTime * 30));
      const g = this.ghost;
      this.ghostVisual.root.position.set(g[i * 4], g[i * 4 + 1] - 0.48, g[i * 4 + 2]);
      this.ghostVisual.root.rotation.set(0, g[i * 4 + 3], 0);
      this.ghostVisual.root.visible = i < g.length / 4 - 1;
    }
  }

  onImpact(speed: number): void {
    if (speed > 2.5 && this.config.event !== 'timeattack') this.api.chain.break('WALL');
  }

  result(): SessionResult {
    const api = this.api;
    const key = eventKey(this.config);
    const car = api.carId;
    const ev = this.config.event;
    let score = 0;
    let medal: Medal | null = null;
    let lines = [] as SessionResult['lines'];
    let newRecord = false;
    let yen = ECONOMY.driftTrack.participationYen;
    let verdict: string | undefined;
    const avg = (x: number) => (this.samples ? x / this.samples : 0);
    if (ev === 'timeattack') {
      const best = this.laps.length ? Math.min(...this.laps) : 0;
      score = Math.round(best * 1000);
      medal = this.done && best > 0 ? medalFor(best, this.ev.timeattack, true) : null;
      const prev = bestRecord(api.save, key);
      const rank = best > 0 ? submitRecord(api.save, key, { track: this.config.location, event: ev, score, car, date: Date.now(), playerName: api.save.profile.name }, true) : -1;
      newRecord = rank === 0;
      if (newRecord && this.bestRec) api.save.records.ghosts[key + '|' + car] = encodeGhost(this.bestRec);
      yen += medalBonus(api.save, key, medal, ECONOMY.driftTrack.timeAttackYen);
      lines = [
        ...this.laps.map((t, i) => ({ label: `Lap ${i + 1}`, value: fmtTime(t), emphasis: t === best })),
        { label: 'Best lap', value: best ? fmtTime(best) : '—', emphasis: true },
        { label: 'Previous best', value: prev ? fmtTime(prev.score / 1000) : '—' },
        { label: 'Targets', value: (['bronze', 'silver', 'gold', 'platinum'] as Medal[]).map((m) => `${MEDAL_LABEL[m][0]} ${fmtTime(this.ev.timeattack[m])}`).join('  ') },
      ];
    } else {
      const st = api.chain.stats;
      score = Math.round(st.banked);
      if (ev === 'tandem') {
        const prox = this.tandemN ? this.tandemProx / this.tandemN : 0;
        const match = this.tandemN ? this.tandemAngle / this.tandemN : 0;
        const judge = (prox * 0.6 + match * 0.4) * 100;
        verdict = judge > 62 ? 'WIN' : judge > 48 ? 'OMT · ONE MORE TIME' : 'LOSE';
        score = Math.round(score * (0.5 + judge / 100));
        lines = [
          { label: 'Proximity', value: `${(prox * 100).toFixed(0)}%` },
          { label: 'Angle match', value: `${(match * 100).toFixed(0)}%` },
          { label: 'Judges', value: verdict, emphasis: true },
          { label: 'Best chain', value: Math.round(st.bestChain).toLocaleString('en-US') },
        ];
      } else {
        const hit = this.clips.filter((c) => c.hit).length;
        lines = [
          { label: 'Angle', value: `${avg(this.angleSum).toFixed(0)}° avg` },
          { label: 'Speed', value: `${avg(this.speedSum).toFixed(0)} km/h avg` },
          { label: 'Line', value: `${(avg(this.lineSum) * 100).toFixed(0)}%` },
          { label: 'Proximity', value: `${hit} / ${this.clips.length} clips` },
          { label: 'Combo', value: `×${this.bestMult.toFixed(1)} best` },
          { label: 'Chain breaks', value: String(st.breaks) },
        ];
      }
      const targets = ev === 'tandem' ? this.ev.tandem : this.ev.driftattack;
      medal = this.done ? medalFor(score, targets) : null;
      const prev = bestRecord(api.save, key);
      const rank = score > 0 ? submitRecord(api.save, key, { track: this.config.location, event: ev, score, car, date: Date.now(), playerName: api.save.profile.name }) : -1;
      newRecord = rank === 0 && (!prev || score > prev.score);
      yen += score * ECONOMY.driftTrack.yenPerPoint + medalBonus(api.save, key, medal, ECONOMY.driftTrack.medalYen);
      lines.push({ label: 'Targets', value: (['bronze', 'silver', 'gold', 'platinum'] as Medal[]).map((m) => `${MEDAL_LABEL[m][0]} ${(targets[m] / 1000).toFixed(0)}k`).join('  ') });
      api.save.stats.longestDrift = Math.max(api.save.stats.longestDrift, st.longestDrift);
      api.save.stats.biggestChain = Math.max(api.save.stats.biggestChain, st.bestChain);
    }
    const xp = xpForPoints(ev === 'timeattack' ? 2000 : score) + (medal ? ECONOMY.xp.medalXp[medal] : 0);
    const pay = payout(api.save, yen, xp);
    lines.push({ label: 'Earned', value: formatYen(pay.money), emphasis: true });
    return {
      config: this.config,
      title: this.done ? (medal ? `${MEDAL_LABEL[medal]} MEDAL` : 'EVENT COMPLETE') : 'EVENT ENDED',
      subtitle: `${this.title} · ドリフトコース`,
      lines,
      score,
      scoreLabel: ev === 'timeattack' ? 'BEST LAP' : 'SCORE',
      medal,
      money: pay.money,
      xp: pay.xp,
      sp: pay.sp,
      levelUps: pay.levelUps,
      newRecord,
      recordKey: key,
      verdict,
    };
  }

  private bestRec: number[] | null = null;

  dispose(): void {
    this.api.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.api.chain.enabled = true;
  }
}

export function fmtTime(t: number): string {
  if (!isFinite(t) || t <= 0) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function encodeGhost(data: number[]): string {
  const f = new Float32Array(data);
  const b = new Uint8Array(f.buffer);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export function decodeGhost(s: string): Float32Array {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new Float32Array(b.buffer);
}
