import { CARS, carPhysics } from '../data';
import type { OwnedCar, SaveData } from '../core/save';
import type { CarPhysicsSpec } from '../physics/types';
import { applyBuild, availableOptions, optionOf, resetsFor, SLOTS, SLOT_BY_ID, type Build, type PartOption } from './parts';
import { CLASSES, rate, type ClassId } from './rating';

// Update 4 §3: buying, installing and removing parts, Quick Upgrade, build presets and build codes.
// Pure functions on the save so they are unit-testable; the shop UI only calls these.

export interface BuildPreset {
  name: string;
  parts: Build;
  tune: Record<string, number>;
}

/** parts this car has paid for (re-installing them is free), as "slot.option" */
export function inventory(o: OwnedCar): Set<string> {
  return new Set(o.inventory ?? []);
}

export function specOf(o: OwnedCar): CarPhysicsSpec {
  return applyBuild(carPhysics(o.carId), o.parts, o.tune);
}

export function partPrice(o: OwnedCar, slot: string, opt: PartOption, discount = 0): number {
  if (opt.id === 'stock' || inventory(o).has(`${slot}.${opt.id}`)) return 0;
  return Math.round(opt.price * (1 - discount));
}

/** what a conversion would reset: installed non-stock parts in its reset list */
export function conversionLosses(o: OwnedCar, slot: string, optId: string): string[] {
  if ((o.parts[slot] ?? 'stock') === optId) return [];
  return resetsFor(slot).filter((s) => (o.parts[s] ?? 'stock') !== 'stock');
}

export interface InstallResult {
  ok: boolean;
  msg: string;
  cost: number;
  reset: string[];
}

export function installPart(save: SaveData, o: OwnedCar, slot: string, optId: string, discount = 0): InstallResult {
  const sd = SLOT_BY_ID[slot];
  if (!sd) return { ok: false, msg: 'Unknown part slot.', cost: 0, reset: [] };
  const base = carPhysics(o.carId);
  const opt = availableOptions(base, o.parts, slot).find((x) => x.id === optId);
  if (!opt) return { ok: false, msg: 'That part does not fit this car.', cost: 0, reset: [] };
  if (save.profile.level < opt.level) return { ok: false, msg: `Reach level ${opt.level} first.`, cost: 0, reset: [] };
  const cost = partPrice(o, slot, opt, discount);
  if (save.profile.credits < cost) return { ok: false, msg: 'Not enough money.', cost, reset: [] };
  save.profile.credits -= cost;
  o.paid += cost;
  const inv = inventory(o);
  if (opt.id !== 'stock') inv.add(`${slot}.${opt.id}`);
  o.inventory = [...inv];
  const reset = conversionLosses(o, slot, optId);
  for (const r of reset) delete o.parts[r];
  if (opt.id === 'stock') delete o.parts[slot];
  else o.parts[slot] = opt.id;
  // parts that no longer fit after a conversion (e.g. turbo upgrade without a turbo) come off
  for (const s of SLOTS) {
    const cur = o.parts[s.id];
    if (cur && !availableOptions(base, o.parts, s.id).some((x) => x.id === cur)) delete o.parts[s.id];
  }
  return { ok: true, msg: opt.id === 'stock' ? `${sd.name} back to stock` : `${opt.name} installed`, cost, reset };
}

export function installedCount(o: OwnedCar, category?: string): number {
  return Object.entries(o.parts).filter(([k, v]) => v && v !== 'stock' && (!category || SLOT_BY_ID[k]?.category === category)).length;
}

// ---------- Quick Upgrade ----------
export type QuickStyle = 'drift' | 'grip' | 'balanced';
export interface QuickPlan {
  steps: { slot: string; opt: PartOption; cost: number }[];
  total: number;
  rating: number;
  cls: ClassId;
}

const STYLE_SLOTS: Record<QuickStyle, Record<string, string[]>> = {
  drift: { angleKit: ['race', 'sport', 'street'], diff: ['drift', 'welded'], compound: ['drift'], springs: ['drift'], handbrake: ['drift'], exhaust: ['race', 'sport', 'street'], flywheel: ['sport', 'street'] },
  grip: { compound: ['semislick', 'sport'], springs: ['race', 'sport'], brakes: ['race', 'sport'], diff: ['race', 'sport'], wing: ['swan', 'lowgt'], frontAero: ['race', 'sport'] },
  balanced: {},
};

/**
 * Greedy planner: repeatedly buy the option with the best rating gain per yen (plus style
 * preferences), staying under the target class ceiling and the budget.
 */
export function quickUpgrade(save: SaveData, o: OwnedCar, opts: { cls?: ClassId; style?: QuickStyle; budget?: number }): QuickPlan {
  const base = carPhysics(o.carId);
  const build: Build = { ...o.parts };
  const ceiling = opts.cls ? CLASSES.find((c) => c.id === opts.cls)!.max : 999;
  let budget = opts.budget ?? save.profile.credits;
  const steps: QuickPlan['steps'] = [];
  const prefs = STYLE_SLOTS[opts.style ?? 'balanced'];
  let cur = rate(applyBuild(base, build)).rating;
  for (let iter = 0; iter < 40; iter++) {
    let best: { slot: string; opt: PartOption; cost: number; score: number; rating: number } | null = null;
    for (const sd of SLOTS) {
      if (sd.visualOnly || sd.category === 'conversion') continue;
      const have = build[sd.id] ?? 'stock';
      for (const opt of availableOptions(base, build, sd.id)) {
        if (opt.id === 'stock' || opt.id === have || opt.level > save.profile.level) continue;
        const cost = inventory(o).has(`${sd.id}.${opt.id}`) ? 0 : opt.price;
        if (cost > budget) continue;
        const r = rate(applyBuild(base, { ...build, [sd.id]: opt.id })).rating;
        if (r > ceiling) continue;
        const pref = prefs[sd.id]?.indexOf(opt.id) ?? -1;
        const gain = r - cur + (pref >= 0 ? 30 - pref * 6 : 0);
        if (gain <= 0) continue;
        const score = gain / (cost + 500);
        if (!best || score > best.score) best = { slot: sd.id, opt, cost, score, rating: r };
      }
    }
    if (!best) break;
    build[best.slot] = best.opt.id;
    budget -= best.cost;
    cur = best.rating;
    const prev = steps.findIndex((s) => s.slot === best!.slot);
    if (prev >= 0) steps.splice(prev, 1);
    steps.push({ slot: best.slot, opt: best.opt, cost: best.cost });
    if (opts.cls && cur >= ceiling - 8) break;
  }
  const r = rate(applyBuild(base, build));
  return { steps, total: steps.reduce((a, s) => a + s.cost, 0), rating: r.rating, cls: r.cls };
}

export function applyQuickPlan(save: SaveData, o: OwnedCar, plan: QuickPlan): string | null {
  if (save.profile.credits < plan.total) return 'Not enough money.';
  for (const s of plan.steps) {
    const r = installPart(save, o, s.slot, s.opt.id);
    if (!r.ok) return r.msg;
  }
  return null;
}

// ---------- presets and build codes ----------
export function savePreset(o: OwnedCar, name: string): void {
  o.presets = [...(o.presets ?? []).filter((p) => p.name !== name), { name, parts: { ...o.parts }, tune: { ...o.tune } }].slice(-8);
}

export function renamePreset(o: OwnedCar, from: string, to: string): void {
  const p = o.presets?.find((x) => x.name === from);
  if (p) p.name = to;
}

/** Load a preset: parts already in the inventory are free; anything missing is bought now. */
export function loadPreset(save: SaveData, o: OwnedCar, p: Pick<BuildPreset, 'parts' | 'tune'>): { cost: number; msg: string | null } {
  const order = [...SLOTS].sort((a, b) => (a.category === 'conversion' ? -1 : 0) - (b.category === 'conversion' ? -1 : 0));
  const want = { ...p.parts };
  let cost = 0;
  for (const sd of order) {
    const id = want[sd.id] ?? 'stock';
    if ((o.parts[sd.id] ?? 'stock') === id) continue;
    const r = installPart(save, o, sd.id, id);
    if (!r.ok) return { cost, msg: `${sd.name}: ${r.msg}` };
    cost += r.cost;
  }
  o.tune = { ...p.tune };
  return { cost, msg: null };
}

/** KZ1-<base64url(json)>: car, parts, tune and paint in one shareable string */
export function exportBuildCode(o: OwnedCar): string {
  const json = JSON.stringify({ c: o.carId, p: o.parts, t: o.tune, k: [o.paint.body, o.paint.finish] });
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, 'utf8').toString('base64');
  return 'KZ1-' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseBuildCode(code: string): { carId: string; parts: Build; tune: Record<string, number>; paint?: [string, string] } | null {
  const m = code.trim().match(/^KZ1-([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, 'base64').toString('utf8');
    const d = JSON.parse(json) as { c: string; p: Build; t: Record<string, number>; k?: [string, string] };
    if (!CARS[d.c] || typeof d.p !== 'object') return null;
    const parts: Build = {};
    for (const [k, v] of Object.entries(d.p)) if (SLOT_BY_ID[k] && optionOf(k, v).id === v) parts[k] = v;
    return { carId: d.c, parts, tune: d.t ?? {}, paint: d.k };
  } catch {
    return null;
  }
}
