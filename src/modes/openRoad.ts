import { ECONOMY, formatYen } from '../core/progression';
import type { Activity, Section } from '../world/openRoadScenery';
import type { GameApi, ModeController, SessionConfig, SessionResult } from './types';
import { eventKey } from './types';
import { payout, submitRecord, xpForPoints } from './rewards';

// Open Road: endless loop with traffic. Banked chain points turn into money as you drive;
// drift zones, speed traps and the danger sign pay stars (first time only per star).

interface ZoneRun {
  a: Activity;
  start: number;
  score: number;
}

export class OpenRoadMode implements ModeController {
  readonly title = 'OPEN ROAD';
  done = false;
  private api!: GameApi;
  private acts: Activity[] = [];
  private sections: Section[] = [];
  private lastS = 0;
  private zone: ZoneRun | null = null;
  private danger: { a: Activity; start: { x: number; z: number } | null; air: boolean; timer: number } | null = null;
  private money = 0;
  private yenFromChain = 0;
  private distance = 0;
  private time = 0;
  private starsEarned = 0;
  private starYen = 0;
  private nearMissYen = 0;
  private crashes = 0;
  private bestZone = 0;
  private sectionId = '';
  private unsub: (() => void) | null = null;

  constructor(readonly config: SessionConfig) {}

  async setup(api: GameApi): Promise<void> {
    this.api = api;
    this.acts = (api.track.def.activities ?? []) as Activity[];
    this.sections = (api.track.def.sections ?? []) as Section[];
    this.lastS = api.playerS();
    const road = api.track.roads[0];
    for (const a of this.acts) {
      const s = a.at ?? a.from ?? 0;
      const p = road.samples[Math.floor((s / road.length) * road.samples.length) % road.samples.length];
      api.addMarker(a.type === 'driftzone' ? 'zone' : a.type === 'speedtrap' ? 'trap' : a.type === 'danger' ? 'danger' : 'zone', p.x, p.z);
    }
    api.chain.reset();
    api.chain.on((e) => {
      if (e.type === 'bank' && e.points) {
        const yen = e.points * ECONOMY.openRoad.yenPerPoint;
        this.yenFromChain += yen;
        this.money += yen;
      }
    });
  }

  /** Called by the game for every near miss with traffic. */
  nearMiss(): void {
    this.nearMissYen += ECONOMY.openRoad.nearMissYen;
    this.money += ECONOMY.openRoad.nearMissYen;
  }

  get sessionMoney(): number {
    return this.money;
  }

  private crossed(at: number, a: number, b: number): boolean {
    // forward crossing of `at` between consecutive positions a → b (no wrap jumps)
    if (Math.abs(b - a) > 60) return false;
    return a < at && b >= at;
  }

  step(dt: number): void {
    const api = this.api;
    const v = api.vehicle;
    const s = api.playerS();
    this.time += dt;
    this.distance += v.telemetry.speed * dt;
    const sec = this.sections.find((x) => s >= x.from && s < x.to);
    if (sec && sec.id !== this.sectionId) {
      this.sectionId = sec.id;
      api.banner(sec.name.toUpperCase(), sec.jp, '#f6a5c0');
    }
    // near-miss alleys double near misses
    api.chain.cfg.nearMissScale = this.acts.some((a) => a.type === 'nearmiss' && s >= a.from! && s <= a.to!) ? 2 : 1;

    for (const a of this.acts) {
      if (a.type === 'driftzone') {
        if (!this.zone && this.crossed(a.from!, this.lastS, s)) {
          this.zone = { a, start: api.chain.stats.banked + api.chain.value, score: 0 };
          api.banner('DRIFT ZONE', `${a.name} · ★ ${a.stars!.map((x) => x.toLocaleString('en-US')).join(' / ')}`, '#e8202f');
          api.sound('checkpoint');
        } else if (this.zone?.a === a && this.crossed(a.to!, this.lastS, s)) {
          this.finishZone();
        }
      } else if (a.type === 'speedtrap' && this.crossed(a.at!, this.lastS, s)) {
        const kmh = Math.round(v.telemetry.speed * 3.6);
        const stars = a.stars!.filter((t) => kmh >= t).length;
        this.award(a, stars, ECONOMY.openRoad.trapStarYen, `SPEED TRAP · ${kmh} KM/H`, 'trapStars');
      } else if (a.type === 'danger' && this.crossed(a.at!, this.lastS, s)) {
        this.danger = { a, start: null, air: false, timer: 3 };
      }
    }
    // zone score = everything the chain gained since the zone began
    if (this.zone) this.zone.score = api.chain.stats.banked + api.chain.value - this.zone.start;
    if (this.danger) {
      const d = this.danger;
      d.timer -= dt;
      if (v.telemetry.airborne && !d.air) {
        d.air = true;
        d.start = { x: v.position.x, z: v.position.z };
      } else if (!v.telemetry.airborne && d.air && d.start) {
        const m = Math.hypot(v.position.x - d.start.x, v.position.z - d.start.z);
        const stars = d.a.stars!.filter((t) => m >= t).length;
        this.award(d.a, stars, ECONOMY.openRoad.trapStarYen, `DANGER SIGN · ${m.toFixed(1)} M`, 'trapStars');
        this.danger = null;
      } else if (d.timer <= 0) this.danger = null;
    }
    this.lastS = s;
  }

  private finishZone(): void {
    const z = this.zone!;
    this.zone = null;
    const score = Math.max(0, Math.round(z.score));
    this.bestZone = Math.max(this.bestZone, score);
    const stars = z.a.stars!.filter((t) => score >= t).length;
    submitRecord(this.api.save, `openroad|${z.a.id}`, { track: 'openroad', event: z.a.id, score, car: this.api.carId, date: Date.now(), playerName: this.api.save.profile.name });
    this.award(z.a, stars, ECONOMY.openRoad.zoneStarYen, `DRIFT ZONE · ${score.toLocaleString('en-US')}`, 'zoneStars');
  }

  private award(a: Activity, stars: number, table: number[], title: string, bucket: 'zoneStars' | 'trapStars'): void {
    const prev = this.api.save.records[bucket][a.id] ?? 0;
    let yen = 0;
    for (let i = prev; i < stars; i++) yen += table[i];
    if (stars > prev) this.api.save.records[bucket][a.id] = stars;
    this.starsEarned += Math.max(0, stars - prev);
    this.starYen += yen;
    this.money += yen;
    const starStr = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    this.api.banner(title, `${a.name}  ${starStr}${yen ? '  +' + formatYen(yen) : ''}`, stars ? '#f39c32' : '#9fb0c3');
    if (stars) this.api.sound('star');
  }

  frame(): void {
    const z = this.zone;
    if (z) this.api.setObjective(`DRIFT ZONE · ${z.a.name.toUpperCase()}  ${Math.round(z.score).toLocaleString('en-US')}  ★ ${z.a.stars!.map((x) => x.toLocaleString('en-US')).join(' / ')}`);
    else this.api.setObjective('');
  }

  onImpact(speed: number, material: string): void {
    if (speed > 6 && material === 'traffic') this.crashes++;
  }

  result(): SessionResult {
    const api = this.api;
    api.chain.bank();
    const st = api.chain.stats;
    // banked chain money was counted as it happened; pay it all now with XP
    const xp = xpForPoints(st.banked) + this.starsEarned * ECONOMY.xp.starXp;
    const pay = payout(api.save, this.money, xp);
    const s = api.save.stats;
    s.nearMisses += st.nearMisses;
    s.longestDrift = Math.max(s.longestDrift, st.longestDrift);
    s.biggestChain = Math.max(s.biggestChain, st.bestChain);
    const key = eventKey(this.config);
    const rank = submitRecord(api.save, key, { track: 'openroad', event: 'free', score: Math.round(st.banked), car: api.carId, date: Date.now(), playerName: api.save.profile.name });
    return {
      config: this.config,
      title: 'RUN COMPLETE',
      subtitle: 'オープンロード · Open Road',
      lines: [
        { label: 'Distance', value: `${(this.distance / 1000).toFixed(2)} km` },
        { label: 'Time', value: `${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, '0')}` },
        { label: 'Best chain', value: Math.round(st.bestChain).toLocaleString('en-US') },
        { label: 'Near misses', value: String(st.nearMisses) },
        { label: 'Zone & trap stars', value: `${this.starsEarned} new` },
        { label: 'Chain money', value: formatYen(this.yenFromChain) },
        { label: 'Star bonuses', value: formatYen(this.starYen) },
        { label: 'Near-miss money', value: formatYen(this.nearMissYen) },
      ],
      score: Math.round(st.banked),
      scoreLabel: 'SKILL POINTS',
      medal: null,
      money: pay.money,
      xp: pay.xp,
      sp: pay.sp,
      levelUps: pay.levelUps,
      newRecord: rank === 0 && st.banked > 0,
      recordKey: key,
    };
  }

  dispose(): void {
    this.unsub?.();
  }
}
