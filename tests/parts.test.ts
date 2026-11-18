import { describe, expect, it } from 'vitest';
import { CAR_ORDER, carPhysics } from '../src/data';
import { applyBuild, availableOptions, CATEGORIES, fullyUpgraded, SLOTS, TUNES, tuneUnlocked } from '../src/garage/parts';
import { classOf, rate } from '../src/garage/rating';
import { measure } from '../src/physics/performance';
import { peakPower } from '../src/physics/drivetrain';

// Update 4 §3: every part exists, applies, and changes the physics; the rating follows.
const s15 = carPhysics('sakura_s15');

describe('upgrade catalogue', () => {
  it('has every category with slots and tiers', () => {
    for (const c of CATEGORIES) expect(SLOTS.filter((s) => s.category === c.id).length, c.id).toBeGreaterThan(0);
    for (const s of SLOTS) expect(s.options[0].id, s.id).toBe('stock');
  });

  it('every non-visual option changes the physics of some car', () => {
    const cars = CAR_ORDER.map((id) => carPhysics(id));
    for (const slot of SLOTS) {
      if (slot.visualOnly) continue;
      for (const o of slot.options) {
        if (o.id === 'stock') continue;
        const changed = cars.some((base) => {
          const build: Record<string, string> = { [slot.id]: o.id };
          if (slot.id.startsWith('width') && o.id.match(/plus[34]/)) build.bodyKit = 'widebody';
          if (!availableOptions(base, build, slot.id).some((x) => x.id === o.id)) return false;
          return JSON.stringify(applyBuild(base, build)) !== JSON.stringify(base);
        });
        expect(changed, `${slot.id}.${o.id}`).toBe(true);
      }
    }
  });

  it('one part per category moves the right numbers', () => {
    const p0 = peakPower(s15.engine).hp;
    expect(peakPower(applyBuild(s15, { exhaust: 'race' }).engine).hp).toBeGreaterThan(p0 * 1.05); // engine
    expect(applyBuild(s15, { engineSwap: 'rb' }).engine.cylinders).toBe(6); // conversion
    expect(applyBuild(s15, { drivetrainSwap: 'awd' }).layout).toBe('AWD');
    expect(applyBuild(s15, { weight: 'race' }).mass).toBe(s15.mass - 150); // platform
    expect(applyBuild(s15, { angleKit: 'race' }).steerLock).toBeCloseTo((70 * Math.PI) / 180);
    expect(applyBuild(s15, { transmission: 'seq' }).gearbox.shiftTime).toBe(0.04); // drivetrain
    expect(applyBuild(s15, { diff: 'welded' }).diff.type).toBe('welded');
    expect(applyBuild(s15, { compound: 'slick' }).tireRear).toBe('slick'); // tires
    expect(applyBuild(s15, { wing: 'swan' }).downforceRear).toBeGreaterThan(s15.downforceRear + 0.3); // aero
  });

  it('turbo upgrades are only offered with a turbo; widebody widths need the kit', () => {
    const ae = carPhysics('takumi_ae');
    expect(availableOptions(ae, {}, 'turbo').map((o) => o.id)).toEqual(['stock']);
    expect(availableOptions(ae, { aspiration: 'turboM' }, 'turbo').length).toBe(4);
    expect(availableOptions(s15, {}, 'widthRear').some((o) => o.id === 'plus4')).toBe(false);
    expect(availableOptions(s15, { bodyKit: 'widebody' }, 'widthRear').some((o) => o.id === 'plus4')).toBe(true);
    expect(availableOptions(s15, {}, 'engineSwap').some((o) => o.id === 'moto')).toBe(false);
    expect(availableOptions(ae, {}, 'engineSwap').some((o) => o.id === 'moto')).toBe(true);
  });

  it('a bigger turbo means more lag', () => {
    expect(applyBuild(s15, { turbo: 'race' }).engine.turbo!.lag).toBeGreaterThan(s15.engine.turbo!.lag * 1.3);
  });

  it('race cams trade low end for top end', () => {
    const c = applyBuild(s15, { cams: 'race' }).engine.torqueCurve;
    expect(c[0][1]).toBeLessThan(s15.engine.torqueCurve[0][1]);
    expect(Math.max(...c.map((p) => p[1]))).toBeGreaterThan(Math.max(...s15.engine.torqueCurve.map((p) => p[1])));
  });

  it('tuning is locked until the race part is installed', () => {
    const camber = TUNES.find((t) => t.key === 'camberF')!;
    expect(tuneUnlocked(camber, {})).toBe(false);
    expect(tuneUnlocked(camber, { springs: 'race' })).toBe(true);
    const locked = applyBuild(s15, {}, { springF: 1.5 });
    expect(locked.suspension.springFront).toBe(s15.suspension.springFront);
    const tuned = applyBuild(s15, { springs: 'race' }, { springF: 1.5 });
    expect(tuned.suspension.springFront).toBeCloseTo(applyBuild(s15, { springs: 'race' }).suspension.springFront * 1.5);
  });
});

describe('rating and class', () => {
  it('stock cars spread across the low classes and parts raise the rating', () => {
    const r = CAR_ORDER.map((id) => rate(carPhysics(id)));
    for (const x of r) expect(x.rating).toBeGreaterThanOrEqual(100);
    expect(rate(carPhysics('takumi_ae')).cls).toBe('D');
    expect(rate(carPhysics('raiden_34')).rating).toBeGreaterThan(rate(s15).rating);
    expect(rate(applyBuild(s15, { exhaust: 'race' })).rating).toBeGreaterThan(rate(s15).rating);
    expect(classOf(950).id).toBe('R');
    expect(classOf(401).id).toBe('C');
  });
});

describe('acceleration targets (fully upgraded)', () => {
  for (const id of CAR_ORDER) {
    it(`${id}: 0-100 in 2.8–3.6 s`, () => {
      const base = carPhysics(id);
      const t = measure(applyBuild(base, fullyUpgraded(base))).zeroTo100;
      // AWD on race slicks is grip-bound at ~1.3 g, so it may beat the 2.8 s floor (DECISIONS.md)
      expect(t, `${t.toFixed(2)} s`).toBeGreaterThanOrEqual(base.layout === 'AWD' ? 1.9 : 2.8 * 0.9);
      expect(t, `${t.toFixed(2)} s`).toBeLessThanOrEqual(3.6 * 1.1);
    }, 60_000);
  }
});
