import { describe, expect, it } from 'vitest';
import { SAVE_KEY, SAVE_VERSION, decodeCode, encodeCode, exportSave, importSave, loadSave, migrate, newSave, writeSave, type StorageLike } from '../src/core/save';
import { GameLoop, PHYSICS_DT } from '../src/core/loop';

class MemStore implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe('save system', () => {
  it('creates a fresh save with the starter car', () => {
    const s = newSave();
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.garage.cars[0].carId).toBe('takumi_ae');
  });

  it('writes and reads back through storage', () => {
    const store = new MemStore();
    const s = newSave();
    s.profile.credits = 4242;
    expect(writeSave(s, store)).toBe(true);
    const back = loadSave(store);
    expect(back.profile.credits).toBe(4242);
  });

  it('migrates the v0.1 prototype keys', () => {
    const store = new MemStore();
    store.setItem('kaze_best', '12345');
    store.setItem('kaze_paint', '"#1f6feb"');
    store.setItem('kaze_tune', '{"power":15000}');
    store.setItem('kaze_muted', 'true');
    const s = loadSave(store);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.records.bestCombo).toBe(12345);
    expect(s.garage.cars[0].paint.body).toBe('#1f6feb');
    // the v0 starter is kept and the new starter is added alongside it
    expect(s.garage.cars.some((c) => c.carId === 'takumi_ae')).toBe(true);
    expect(s.garage.cars[0].tune.power).toBe(15000);
    expect(s.settings.audio.muted).toBe(true);
  });

  it('migrates a v1 save and fills missing fields', () => {
    const v1 = { version: 1, profile: { credits: 99 }, records: { bestCombo: 5 } };
    const s = migrate(v1);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.profile.credits).toBe(99);
    expect(s.profile.level).toBe(1);
    expect(s.records.bestScores).toEqual({});
    expect(s.settings.controls.keys.throttle.length).toBeGreaterThan(0);
  });

  it('falls back to the backup when the main save is corrupt', () => {
    const store = new MemStore();
    const s = newSave();
    s.profile.credits = 1;
    writeSave(s, store);
    s.profile.credits = 2;
    writeSave(s, store);
    store.setItem(SAVE_KEY, '{not json');
    expect(loadSave(store).profile.credits).toBe(1);
  });

  it('migrates a Phase 1 (v2) save without losing the S15 or money', () => {
    const v2 = { version: 2, profile: { name: 'Driver', credits: 23456, xp: 300, level: 2 }, garage: { selected: 'car-1', cars: [{ uid: 'car-1', carId: 'sakura_s15', parts: {}, tune: {}, paint: { body: '#123456', finish: 'metallic', wheels: '#fff', calipers: '#f00' }, livery: [], mileage: 12 }] }, records: { bestCombo: 999, bestScores: {}, bestTimes: {}, medals: {}, ghosts: {} } };
    const s = migrate(v2);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.profile.credits).toBe(23456);
    expect(s.profile.sp).toBe(0);
    expect(s.garage.cars.map((c) => c.carId).sort()).toEqual(['sakura_s15', 'takumi_ae']);
    expect(s.garage.selected).toBe('car-1');
    expect(s.records.tables).toEqual({});
    expect(s.stats.distance).toBe(0);
  });

  it('rejects saves from the future', () => {
    expect(() => migrate({ version: SAVE_VERSION + 5 })).toThrow();
  });

  it('round-trips an export code', async () => {
    const s = newSave();
    s.profile.xp = 777;
    s.records.bestTimes['minami'] = 61.234;
    const code = await exportSave(s);
    expect(code.startsWith('KZDS')).toBe(true);
    const back = await importSave(code);
    expect(back.profile.xp).toBe(777);
    expect(back.records.bestTimes.minami).toBeCloseTo(61.234);
  });

  it('rejects damaged or foreign codes', async () => {
    const code = await encodeCode({ a: 1 }, 'B');
    await expect(decodeCode(code, 'S')).rejects.toThrow();
    await expect(decodeCode('hello', 'S')).rejects.toThrow();
    const parts = code.split('-');
    const broken = `${parts[0]}-${parts[1]}-0000000`;
    await expect(decodeCode(broken, 'B')).rejects.toThrow();
  });
});

describe('game loop', () => {
  it('runs physics at a fixed rate regardless of frame rate', () => {
    let steps = 0;
    let lastAlpha = -1;
    const loop = new GameLoop({ step: () => steps++, render: (_dt, a) => (lastAlpha = a) });
    // simulate 1 second at an uneven frame rate starting at t=0
    (loop as any).last = 0;
    let t = 0;
    while (t < 1000) { t += 7 + (t % 3); loop.frame(t); }
    expect(Math.abs(steps - 120)).toBeLessThanOrEqual(2);
    expect(lastAlpha).toBeGreaterThanOrEqual(0);
    expect(lastAlpha).toBeLessThan(1);
    expect(PHYSICS_DT).toBeCloseTo(1 / 120);
  });
});
