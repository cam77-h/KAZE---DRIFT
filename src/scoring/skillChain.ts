import type { Vehicle } from '../physics/vehicle';

// Forza-Horizon-style skill chain: skills add points to a live chain, the multiplier grows
// with the chain, points bank automatically after a quiet spell, and a mistake wipes the
// unbanked chain. Pure logic (no DOM): the HUD listens to its events.

export type SkillId =
  | 'drift'
  | 'transition'
  | 'ebrake'
  | 'nearmiss'
  | 'daredevil'
  | 'clip'
  | 'wreckage'
  | 'airtime'
  | 'speed'
  | 'tandem'
  | 'zone';

export const SKILL_NAMES: Record<SkillId, string> = {
  drift: 'DRIFT',
  transition: 'TRANSITION',
  ebrake: 'E-BRAKE TURN',
  nearmiss: 'NEAR MISS',
  daredevil: 'DAREDEVIL',
  clip: 'CLIPPING POINT',
  wreckage: 'WRECKAGE',
  airtime: 'AIRTIME',
  speed: 'SPEED',
  tandem: 'TANDEM CLOSE',
  zone: 'ZONE BONUS',
};

export interface ChainEvent {
  type: 'skill' | 'bank' | 'break' | 'tier';
  skill?: SkillId;
  label?: string;
  points?: number;
  total?: number;
  multiplier?: number;
  reason?: string;
}

export interface ChainConfig {
  bankTime: number;
  maxMultiplier: number;
  nearMissBonus: number;
  /** extra multiplier for near misses in a near-miss alley */
  nearMissScale: number;
}

export function defaultChainConfig(): ChainConfig {
  return { bankTime: 2.5, maxMultiplier: 10, nearMissBonus: 1, nearMissScale: 1 };
}

export const DRIFT_TIERS: [number, string][] = [
  [12000, 'LEGENDARY DRIFT'],
  [5000, 'INSANE DRIFT'],
  [1800, 'GREAT DRIFT'],
  [0, 'DRIFT'],
];

export interface ChainStats {
  banked: number;
  bestChain: number;
  longestDrift: number;
  longestDriftTime: number;
  nearMisses: number;
  skills: number;
  breaks: number;
  wreckage: number;
  airtime: number;
}

export class SkillChain {
  cfg: ChainConfig;
  /** unbanked raw points in the chain (before multiplier) */
  points = 0;
  multiplier = 1;
  /** seconds left before the chain banks */
  bankTimer = 0;
  active = false;
  /** points of the drift currently in progress (raw) */
  driftPoints = 0;
  driftTime = 0;
  driftDir = 0;
  private quiet = 0;
  private skillsInChain = 0;
  private nearMissesInChain = 0;
  private airborne = 0;
  private speedTime = 0;
  private ebrakeArmed = 0;
  private spinTimer = 0;
  stats: ChainStats = { banked: 0, bestChain: 0, longestDrift: 0, longestDriftTime: 0, nearMisses: 0, skills: 0, breaks: 0, wreckage: 0, airtime: 0 };
  /** points earned since the last call to takeBanked() (for money) */
  private bankedSince = 0;
  enabled = true;
  private listeners: ((e: ChainEvent) => void)[] = [];

  constructor(cfg: Partial<ChainConfig> = {}) {
    this.cfg = { ...defaultChainConfig(), ...cfg };
  }

  on(fn: (e: ChainEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: ChainEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** The chain value right now (what banks if nothing goes wrong). */
  get value(): number {
    return Math.round((this.points + this.driftPoints) * this.multiplier);
  }

  get tier(): number {
    return Math.min(4, Math.floor((this.multiplier - 1) / 2.25));
  }

  takeBanked(): number {
    const b = this.bankedSince;
    this.bankedSince = 0;
    return b;
  }

  /** Add a completed skill to the chain. */
  add(skill: SkillId, raw: number, label = SKILL_NAMES[skill]): void {
    if (!this.enabled || raw <= 0) return;
    const before = Math.floor(this.multiplier);
    this.points += raw;
    this.skillsInChain++;
    this.stats.skills++;
    this.active = true;
    this.quiet = 0;
    this.bankTimer = this.cfg.bankTime;
    this.multiplier = Math.min(this.cfg.maxMultiplier, this.multiplier + 0.5);
    this.emit({ type: 'skill', skill, label, points: Math.round(raw), multiplier: this.multiplier });
    if (Math.floor(this.multiplier) > before) this.emit({ type: 'tier', multiplier: Math.floor(this.multiplier) });
  }

  nearMiss(scale = this.cfg.nearMissScale): void {
    this.nearMissesInChain++;
    this.stats.nearMisses++;
    this.add('nearmiss', 350 * scale * this.cfg.nearMissBonus, scale > 1 ? 'NEAR MISS ×2' : 'NEAR MISS');
    if (this.nearMissesInChain > 0 && this.nearMissesInChain % 3 === 0) this.add('daredevil', 1200 * scale, 'DAREDEVIL');
  }

  wreckage(n = 1): void {
    this.stats.wreckage += n;
    this.add('wreckage', 150 * n);
  }

  /** Lose the unbanked chain. */
  break(reason: string): void {
    if (!this.active && this.driftPoints <= 0) return;
    const lost = this.value;
    this.points = 0;
    this.driftPoints = 0;
    this.driftTime = 0;
    this.driftDir = 0;
    this.multiplier = 1;
    this.skillsInChain = 0;
    this.nearMissesInChain = 0;
    this.active = false;
    this.bankTimer = 0;
    this.stats.breaks++;
    if (lost > 50) this.emit({ type: 'break', reason, points: lost });
  }

  bank(): void {
    const v = this.value;
    if (v > 0) {
      this.stats.banked += v;
      this.bankedSince += v;
      this.stats.bestChain = Math.max(this.stats.bestChain, v);
      this.emit({ type: 'bank', points: v, total: this.stats.banked });
    }
    this.points = 0;
    this.driftPoints = 0;
    this.multiplier = 1;
    this.skillsInChain = 0;
    this.nearMissesInChain = 0;
    this.active = false;
    this.bankTimer = 0;
  }

  private finishDrift(): void {
    if (this.driftPoints > 30) {
      const pts = this.driftPoints;
      const label = DRIFT_TIERS.find(([t]) => pts >= t)![1];
      this.stats.longestDrift = Math.max(this.stats.longestDrift, pts);
      this.stats.longestDriftTime = Math.max(this.stats.longestDriftTime, this.driftTime);
      this.driftPoints = 0;
      this.add('drift', pts, label);
    } else this.driftPoints = 0;
    this.driftTime = 0;
    this.driftDir = 0;
  }

  /** Per physics step: detect drift, e-brake turns, airtime, speed and spins. */
  update(dt: number, v: Vehicle, scale = 1): void {
    if (!this.enabled) return;
    const t = v.telemetry;
    const ang = Math.abs(t.driftAngle) * (180 / Math.PI);
    const kmh = t.speed * 3.6;
    const drifting = t.forwardSpeed > 4 && kmh > 22 && ang > 10 && !t.airborne;

    // spin-out: going backwards or past 115 degrees of slide
    if (t.speed > 3 && (t.forwardSpeed < -1.5 || ang > 115)) {
      this.spinTimer += dt;
      if (this.spinTimer > 0.25) {
        this.break('SPUN OUT');
        this.spinTimer = 0;
      }
    } else this.spinTimer = 0;

    if (drifting) {
      const dir = Math.sign(t.driftAngle);
      // switching sides mid-drift is a transition: finish the current drift with a bonus
      if (this.driftDir !== 0 && dir !== this.driftDir && this.driftTime > 0.6) {
        this.finishDrift();
        this.add('transition', 400 * scale);
      }
      this.driftDir = dir;
      const angF = Math.min(1.5, (ang - 10) / 35);
      const spdF = Math.min(3, t.speed / 15);
      this.driftPoints += 400 * angF * spdF * dt * scale;
      this.driftTime += dt;
      this.multiplier = Math.min(this.cfg.maxMultiplier, this.multiplier + dt * 0.25);
      this.active = true;
      this.quiet = 0;
      this.bankTimer = this.cfg.bankTime;
    } else if (this.driftPoints > 0) {
      this.quiet += dt;
      if (this.quiet > 0.35) this.finishDrift();
    }

    // e-brake turn: handbrake held while the car rotates hard at speed
    if (t.speed > 8 && Math.abs(t.yawRate) > 1.0 && v.wheels[2].absFactor === 1 && v.wheels[2].omega * v.wheels[2].radius < t.speed * 0.4) this.ebrakeArmed += dt;
    else {
      if (this.ebrakeArmed > 0.3) this.add('ebrake', 500 * scale);
      this.ebrakeArmed = 0;
    }

    // airtime
    if (t.airborne) this.airborne += dt;
    else {
      if (this.airborne > 0.45) {
        this.stats.airtime += this.airborne;
        this.add('airtime', Math.round(this.airborne * 900 * scale), `AIRTIME ${this.airborne.toFixed(1)}s`);
      }
      this.airborne = 0;
    }

    // sustained speed
    if (kmh > 150) {
      this.speedTime += dt;
      if (this.speedTime > 3) {
        this.add('speed', 300 * scale);
        this.speedTime = 0;
      }
    } else this.speedTime = 0;

    // banking countdown
    if (this.active && !drifting && this.driftPoints === 0) {
      this.bankTimer -= dt;
      if (this.bankTimer <= 0) this.bank();
    }
  }

  reset(): void {
    this.points = 0;
    this.driftPoints = 0;
    this.multiplier = 1;
    this.active = false;
    this.bankTimer = 0;
    this.skillsInChain = 0;
    this.nearMissesInChain = 0;
    this.bankedSince = 0;
    this.stats = { banked: 0, bestChain: 0, longestDrift: 0, longestDriftTime: 0, nearMisses: 0, skills: 0, breaks: 0, wreckage: 0, airtime: 0 };
  }
}
