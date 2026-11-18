import { describe, expect, it } from 'vitest';
import { newSave } from '../src/core/save';
import { addXp, xpForLevel, medalFor } from '../src/core/progression';
import { buyCar, sellCar, buyPerk, sellValue } from '../src/ui/shop';
import { submitRecord, medalBonus } from '../src/modes/rewards';

describe('economy', () => {
  it('starts with the Takumi AE and ¥15,000', () => {
    const s = newSave();
    expect(s.profile.credits).toBe(15000);
    expect(s.garage.cars[0].carId).toBe('takumi_ae');
  });

  it('level n needs round(1000 * n^1.4) XP and pays 1 SP + ¥2,500', () => {
    const s = newSave();
    expect(xpForLevel(1)).toBe(1000);
    expect(xpForLevel(2)).toBe(Math.round(1000 * Math.pow(2, 1.4)));
    const ups = addXp(s, 1000 + xpForLevel(2));
    expect(s.profile.level).toBe(3);
    expect(ups.length).toBe(2);
    expect(s.profile.sp).toBe(2);
    expect(s.profile.credits).toBe(15000 + 5000);
  });

  it('buys and sells cars at 60%, respecting level gates', () => {
    const s = newSave();
    s.profile.credits = 100000;
    expect(buyCar(s, 'raiden_34')).toMatch(/level/i);
    const r = buyCar(s, 'sakura_18');
    expect(typeof r).not.toBe('string');
    expect(s.profile.credits).toBe(100000 - 35000);
    const uid = (r as { uid: string }).uid;
    expect(sellValue(s, s.garage.cars.find((c) => c.uid === uid)!)).toBe(21000);
    sellCar(s, uid);
    expect(s.profile.credits).toBe(100000 - 35000 + 21000);
    expect(sellCar(s, s.garage.cars[0].uid)).toMatch(/at least one/);
  });

  it('perks cost 1 SP, have ranks and prerequisites', () => {
    const s = newSave();
    expect(buyPerk(s, 'bank')).toMatch(/skill points/i);
    s.profile.sp = 3;
    expect(buyPerk(s, 'mult')).toMatch(/above/i);
    expect(buyPerk(s, 'bank')).toBeNull();
    expect(buyPerk(s, 'bank')).toBeNull();
    expect(buyPerk(s, 'bank')).toMatch(/max/i);
    expect(s.profile.sp).toBe(1);
  });

  it('pays first-time medal bonuses once and keeps a top-10 table', () => {
    const s = newSave();
    const table = { bronze: 2000, silver: 4000, gold: 7500, platinum: 12000 };
    expect(medalBonus(s, 'k', 'silver', table)).toBe(6000);
    expect(medalBonus(s, 'k', 'gold', table)).toBe(7500);
    expect(medalBonus(s, 'k', 'gold', table)).toBe(0);
    for (let i = 0; i < 14; i++) submitRecord(s, 'k', { track: 't', event: 'e', score: i * 10, car: 'c', date: i, playerName: 'p' });
    expect(s.records.tables.k.length).toBe(10);
    expect(s.records.tables.k[0].score).toBe(130);
    expect(medalFor(55, { bronze: 75, silver: 64, gold: 57, platinum: 52 }, true)).toBe('gold');
  });
});
