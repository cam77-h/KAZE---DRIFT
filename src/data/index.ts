// Typed access to the JSON data files. Content lives in JSON so it can be added without
// touching engine code; this module is the one place that casts it to engine types.
import carsJson from './cars.json';
import namesJson from './names.json';
import minami from './tracks/minami.json';
import skidpad from './tracks/skidpad.json';
import type { CarPhysicsSpec } from '../physics/types';
import type { TrackDef } from '../world/track';

export interface CarVisualSpec {
  model: string;
  glb: string;
  defaultPaint: string;
  wheel: string;
  wheelDiameterIn: number;
}

export interface CarDef {
  id: string;
  physics: CarPhysicsSpec;
  visual: CarVisualSpec;
}

export const CARS = carsJson as unknown as Record<string, CarDef>;
export const NAMES = namesJson;

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

export const TRACKS: Record<string, TrackDef> = {
  minami: minami as unknown as TrackDef,
  skidpad: skidpad as unknown as TrackDef,
};

export function trackName(id: string): { name: string; jp: string; region: string } {
  return (NAMES.tracks as Record<string, { name: string; jp: string; region: string }>)[id] ?? { name: id, jp: '', region: '' };
}
