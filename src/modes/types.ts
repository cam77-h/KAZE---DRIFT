import type * as THREE from 'three';
import type { Vehicle } from '../physics/vehicle';
import type { Track } from '../world/track';
import type { SkillChain } from '../scoring/skillChain';
import type { SaveData } from '../core/save';
import type { Medal, LevelUp } from '../core/progression';

export type ModeId = 'openroad' | 'drift' | 'practice';
export type EventKind = 'free' | 'driftattack' | 'timeattack' | 'tandem';

export interface SessionConfig {
  mode: ModeId;
  location: string;
  event: EventKind;
}

export interface ResultLine {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface SessionResult {
  config: SessionConfig;
  title: string;
  subtitle: string;
  lines: ResultLine[];
  score: number;
  scoreLabel: string;
  medal: Medal | null;
  money: number;
  xp: number;
  sp: number;
  levelUps: LevelUp[];
  newRecord: boolean;
  recordKey: string;
  verdict?: string;
}

/** What a mode needs from the game. */
export interface GameApi {
  scene: THREE.Scene;
  save: SaveData;
  chain: SkillChain;
  track: Track;
  vehicle: Vehicle;
  carId: string;
  /** distance along the main road, wrapped */
  playerS(): number;
  toast(text: string, seconds?: number): void;
  banner(title: string, sub: string, color?: string): void;
  sound(kind: 'star' | 'record' | 'honk' | 'checkpoint' | 'crack'): void;
  resetToStart(): void;
  addMarker(kind: 'zone' | 'trap' | 'danger' | 'clip' | 'lead', x: number, z: number): void;
  setObjective(text: string): void;
  finish(): void;
}

export interface ModeController {
  readonly config: SessionConfig;
  /** shown in the HUD corner */
  readonly title: string;
  setup(api: GameApi): Promise<void>;
  /** fixed physics step */
  step(dt: number): void;
  /** once per rendered frame (HUD text etc.) */
  frame(dt: number): void;
  onImpact(speed: number, material: string): void;
  /** true once the event has a natural end (lap complete, etc.) */
  done: boolean;
  /** build the results (also applies money/XP/records to the save) */
  result(): SessionResult;
  dispose(): void;
}

export function eventKey(c: SessionConfig): string {
  return `${c.location}|${c.event}`;
}
