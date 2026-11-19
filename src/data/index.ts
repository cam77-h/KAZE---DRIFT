// Typed access to the JSON data files. Content lives in JSON so it can be added without
// touching engine code; this module is the one place that casts it to engine types.
import carsJson from './cars.json';
import trafficJson from './traffic.json';
import namesJson from './names.json';
import minami from './tracks/minami.json';
import skidpad from './tracks/skidpad.json';
import openroad from './tracks/openroad.json';
import tsukinami from './tracks/tsukinami.json';
import port from './tracks/port.json';
import type { CarPhysicsSpec } from '../physics/types';
import type { TrackDef } from '../world/track';
import type { ModelDef } from '../vehicles/modelLoader';
import type { PaintFinish } from '../vehicles/paint';

export interface CarVisualSpec {
  /** 'glb' for an imported model, otherwise the id of a procedural body shape (e.g. 's15') */
  model: string;
  glb?: ModelDef & { popups?: string };
  defaultPaint: string;
  defaultFinish?: PaintFinish;
  /** how far the body sits below its stock height (m) so the tires tuck into the arches */
  stance?: number;
  wheel?: string;
  wheelDiameterIn?: number;
}

export interface CarDef {
  id: string;
  physics: CarPhysicsSpec;
  visual: CarVisualSpec;
  price: number;
  level: number;
  archetype: string;
  signature: string;
  year?: number;
}

export interface TrafficDef {
  id: string;
  glb: ModelDef;
  paint?: string;
  weight: number;
  kind: 'car' | 'van' | 'truck' | 'parked' | 'show';
}

type RawCar = Omit<CarDef, 'id' | 'physics'> & { physics: Partial<CarPhysicsSpec> };
const RAW = carsJson as unknown as Record<string, RawCar> & { _base: Omit<CarPhysicsSpec, 'id'> };
export const NAMES = namesJson;

function deepMerge<T>(base: T, over: Partial<T>): T {
  const out = structuredClone(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = out[k];
    // null in a car's overrides removes a base field (e.g. "turbo": null for NA engines)
    if (v === null) { delete out[k]; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b)) out[k] = deepMerge(b, v as Partial<typeof b>);
    else out[k] = structuredClone(v);
  }
  return out as T;
}

export const CARS: Record<string, CarDef> = {};
for (const [id, raw] of Object.entries(RAW)) {
  if (id.startsWith('_')) continue;
  const r = raw as RawCar;
  CARS[id] = { ...r, id, physics: { ...deepMerge(RAW._base as CarPhysicsSpec, r.physics), id } } as CarDef;
}

/** Car ids in dealer order (cheapest first). */
export const CAR_ORDER = Object.keys(CARS).sort((a, b) => CARS[a].price - CARS[b].price);

export const TRAFFIC: Record<string, TrafficDef> = {};
for (const [id, raw] of Object.entries(trafficJson as Record<string, unknown>)) {
  if (id.startsWith('_')) continue;
  TRAFFIC[id] = { ...(raw as Omit<TrafficDef, 'id'>), id };
}

export function carDef(id: string): CarDef {
  const c = CARS[id];
  if (!c) throw new Error(`Unknown car ${id}`);
  return c;
}

/** A deep copy of a car's physics so parts and tuning can modify it freely. */
export function carPhysics(id: string): CarPhysicsSpec {
  return structuredClone(carDef(id).physics);
}

export function carName(id: string): string {
  return (NAMES.cars as Record<string, { name: string }>)[id]?.name ?? id;
}

export function carTagline(id: string): string {
  return (NAMES.cars as Record<string, { tagline: string }>)[id]?.tagline ?? '';
}

/** The same layout driven the other way round: road points reversed, spawn turned around. */
function reversed(def: TrackDef, id: string): TrackDef {
  const out = structuredClone(def);
  out.id = id;
  for (const r of out.roads) {
    r.points.reverse();
    // flip each wall's side and fraction range
    r.walls = (r.walls ?? []).map((w) => ({ ...w, side: w.side === 'left' ? 'right' : 'left', from: 1 - w.to, to: 1 - w.from }));
  }
  out.spawn = { ...def.spawn, yaw: def.spawn.yaw + Math.PI };
  return out;
}

export const TRACKS: Record<string, TrackDef> = {
  minami: minami as unknown as TrackDef,
  minami_rev: reversed(minami as unknown as TrackDef, 'minami_rev'),
  skidpad: skidpad as unknown as TrackDef,
  openroad: openroad as unknown as TrackDef,
  tsukinami: tsukinami as unknown as TrackDef,
  port: port as unknown as TrackDef,
};

/** Drift Track venues in menu order. */
export const DRIFT_VENUES = ['minami', 'minami_rev', 'tsukinami', 'port'];

export function trackName(id: string): { name: string; jp: string; region: string } {
  return (NAMES.tracks as Record<string, { name: string; jp: string; region: string }>)[id] ?? { name: id, jp: '', region: '' };
}
