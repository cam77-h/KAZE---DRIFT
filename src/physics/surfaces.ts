import type { SurfaceId } from './types';

export interface SurfaceProps {
  /** dry grip multiplier */
  grip: number;
  /** grip multiplier when fully wet */
  wetGrip: number;
  /** extra rolling drag coefficient (sand, grass) */
  drag: number;
  /** vertical noise amplitude in metres (rumble) */
  bump: number;
  /** what the tires throw up when sliding */
  particle: 'smoke' | 'dust' | 'grass' | 'snow' | 'none';
  /** does sliding on it leave rubber marks */
  marks: boolean;
}

export const SURFACES: Record<SurfaceId, SurfaceProps> = {
  asphalt: { grip: 1.0, wetGrip: 0.72, drag: 0, bump: 0, particle: 'smoke', marks: true },
  concrete: { grip: 0.95, wetGrip: 0.7, drag: 0, bump: 0, particle: 'smoke', marks: true },
  paint: { grip: 0.94, wetGrip: 0.58, drag: 0, bump: 0, particle: 'smoke', marks: true },
  kerb: { grip: 0.9, wetGrip: 0.55, drag: 0.004, bump: 0.008, particle: 'smoke', marks: true },
  gravel: { grip: 0.62, wetGrip: 0.55, drag: 0.06, bump: 0.012, particle: 'dust', marks: false },
  dirt: { grip: 0.66, wetGrip: 0.5, drag: 0.03, bump: 0.008, particle: 'dust', marks: false },
  grass: { grip: 0.5, wetGrip: 0.38, drag: 0.05, bump: 0.01, particle: 'grass', marks: false },
  snow: { grip: 0.42, wetGrip: 0.4, drag: 0.03, bump: 0.004, particle: 'snow', marks: false },
  ice: { grip: 0.16, wetGrip: 0.12, drag: 0, bump: 0, particle: 'none', marks: false },
};

/** Grip for a surface at a given wetness (0 dry .. 1 soaked). */
export function surfaceGrip(id: SurfaceId, wetness: number): number {
  const s = SURFACES[id];
  return s.grip + (s.wetGrip - s.grip) * Math.min(1, Math.max(0, wetness));
}
