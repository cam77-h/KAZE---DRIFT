import { defaultAssists, expertAssists, type AssistSettings } from '../physics/types';
import type { ProfileId, SteerProfile, WheelConfig } from '../input/steering';

export type Action =
  | 'throttle'
  | 'brake'
  | 'steerLeft'
  | 'steerRight'
  | 'handbrake'
  | 'clutch'
  | 'shiftUp'
  | 'shiftDown'
  | 'camera'
  | 'reset'
  | 'pause'
  | 'lookBack';

export const ACTIONS: { id: Action; label: string }[] = [
  { id: 'throttle', label: 'Throttle' },
  { id: 'brake', label: 'Brake / reverse' },
  { id: 'steerLeft', label: 'Steer left' },
  { id: 'steerRight', label: 'Steer right' },
  { id: 'handbrake', label: 'Handbrake' },
  { id: 'clutch', label: 'Clutch' },
  { id: 'shiftUp', label: 'Shift up' },
  { id: 'shiftDown', label: 'Shift down' },
  { id: 'camera', label: 'Change camera' },
  { id: 'lookBack', label: 'Look back' },
  { id: 'reset', label: 'Reset car' },
  { id: 'pause', label: 'Pause' },
];

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';

export interface GraphicsSettings {
  preset: GraphicsPreset;
  shadows: boolean;
  shadowQuality: 1 | 2 | 3;
  ssao: boolean;
  bloom: boolean;
  motionBlur: boolean;
  antialias: boolean;
  renderScale: number;
  particles: number;
  drawDistance: number;
  grain: boolean;
}

export interface AudioSettings {
  master: number;
  engine: number;
  effects: number;
  music: number;
  ambience: number;
  muted: boolean;
}

export interface ControlSettings {
  keys: Record<Action, string[]>;
  /** gamepad button indices per action (standard mapping) */
  pad: Record<Action, number[]>;
  steerSensitivity: number;
  steerLinearity: number;
  deadzone: number;
  vibration: boolean;
  /** keyboard steering speed (how fast digital steering ramps) */
  keyboardSteerSpeed: number;
  touchLayout: 'buttons' | 'tilt';
  /** Update 5 §5.2: per-device steering profiles (missing fields fall back to the defaults) */
  steerProfiles?: Partial<Record<ProfileId, Partial<SteerProfile>>>;
  /** steering wheel: 'auto' detects common wheels by name */
  wheelMode?: 'auto' | 'on' | 'off';
  wheel?: Partial<WheelConfig>;
}

export interface GameplaySettings {
  units: 'kmh' | 'mph';
  camera: number;
  hudScale: number;
  showTelemetry: boolean;
  cameraShake: number;
  /** hidden safety knob: multiplies every engine's torque (default 1.15, not shown in the UI) */
  arcadePower: number;
  /** Update 5: 'sim' (360 Hz sim tires) or 'classic' (the Update 1–4 model) */
  physicsModel: 'sim' | 'classic';
}

export interface Settings {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: ControlSettings;
  assists: AssistSettings;
  gameplay: GameplaySettings;
}

export const GRAPHICS_PRESETS: Record<Exclude<GraphicsPreset, 'custom'>, Omit<GraphicsSettings, 'preset'>> = {
  low: { shadows: false, shadowQuality: 1, ssao: false, bloom: false, motionBlur: false, antialias: false, renderScale: 0.75, particles: 0.4, drawDistance: 0.6, grain: false },
  medium: { shadows: true, shadowQuality: 1, ssao: true, bloom: true, motionBlur: true, antialias: true, renderScale: 1, particles: 0.7, drawDistance: 0.8, grain: true },
  high: { shadows: true, shadowQuality: 2, ssao: true, bloom: true, motionBlur: true, antialias: true, renderScale: 1, particles: 1, drawDistance: 1, grain: true },
  ultra: { shadows: true, shadowQuality: 3, ssao: true, bloom: true, motionBlur: true, antialias: true, renderScale: 1.25, particles: 1.3, drawDistance: 1.25, grain: true },
};

export function defaultKeys(): Record<Action, string[]> {
  return {
    throttle: ['KeyW', 'ArrowUp'],
    brake: ['KeyS', 'ArrowDown'],
    steerLeft: ['KeyA', 'ArrowLeft'],
    steerRight: ['KeyD', 'ArrowRight'],
    handbrake: ['Space'],
    clutch: ['ShiftLeft'],
    shiftUp: ['KeyE'],
    shiftDown: ['KeyQ'],
    camera: ['KeyC'],
    reset: ['KeyR'],
    pause: ['Escape', 'KeyP'],
    lookBack: ['KeyB'],
  };
}

/** Standard-mapping gamepad: A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 Back=8 Start=9 */
export function defaultPad(): Record<Action, number[]> {
  return {
    throttle: [7],
    brake: [6],
    steerLeft: [14],
    steerRight: [15],
    handbrake: [0],
    clutch: [4],
    shiftUp: [1],
    shiftDown: [2],
    camera: [3],
    reset: [8],
    pause: [9],
    lookBack: [5],
  };
}

export function detectPreset(): Exclude<GraphicsPreset, 'custom'> {
  if (typeof navigator === 'undefined') return 'medium';
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (coarse) return 'low';
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores >= 8 ? 'high' : 'medium';
}

export function defaultSettings(): Settings {
  const preset = detectPreset();
  return {
    graphics: { preset, ...GRAPHICS_PRESETS[preset] },
    audio: { master: 0.8, engine: 0.9, effects: 0.8, music: 0.6, ambience: 0.6, muted: false },
    controls: {
      keys: defaultKeys(),
      pad: defaultPad(),
      steerSensitivity: 1,
      steerLinearity: 1.3,
      deadzone: 0.08,
      vibration: true,
      keyboardSteerSpeed: 1,
      touchLayout: 'buttons',
    },
    assists: defaultAssists(),
    gameplay: { units: 'kmh', camera: 0, hudScale: 1, showTelemetry: false, cameraShake: 1, arcadePower: 1.15, physicsModel: 'classic' },
  };
}

export function applyPreset(g: GraphicsSettings, preset: Exclude<GraphicsPreset, 'custom'>): void {
  Object.assign(g, GRAPHICS_PRESETS[preset], { preset });
}

export function assistPreset(name: 'friendly' | 'expert'): AssistSettings {
  return name === 'expert' ? expertAssists() : defaultAssists();
}

/** Fill any missing fields from defaults (settings saved by older versions). */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Settings>;
  const out: Settings = {
    graphics: { ...d.graphics, ...(r.graphics ?? {}) },
    audio: { ...d.audio, ...(r.audio ?? {}) },
    controls: { ...d.controls, ...(r.controls ?? {}) },
    assists: { ...d.assists, ...(r.assists ?? {}) },
    gameplay: { ...d.gameplay, ...(r.gameplay ?? {}) },
  };
  out.controls.keys = { ...d.controls.keys, ...(r.controls?.keys ?? {}) };
  out.controls.pad = { ...d.controls.pad, ...(r.controls?.pad ?? {}) };
  return out;
}
