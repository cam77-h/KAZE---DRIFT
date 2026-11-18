import { defaultSettings, normalizeSettings, type Settings } from './settings';

// Versioned save stored in localStorage. Every structural change bumps SAVE_VERSION and adds
// a migration step below, so old saves always load. Export/import codes are the same JSON,
// deflated and base64url-encoded with a checksum, so progress can move between browsers.

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'kaze_drift_save';
const BACKUP_KEY = 'kaze_drift_save_backup';
const CODE_PREFIX = 'KZD';

export interface PaintJob {
  body: string;
  finish: 'gloss' | 'metallic' | 'pearl' | 'matte' | 'satin' | 'chrome' | 'candy' | 'shift';
  wheels: string;
  calipers: string;
}

export interface OwnedCar {
  uid: string;
  carId: string;
  parts: Record<string, string>;
  tune: Record<string, number>;
  paint: PaintJob;
  livery: unknown[];
  mileage: number;
}

export interface SaveData {
  version: number;
  createdAt: number;
  updatedAt: number;
  profile: { name: string; credits: number; xp: number; level: number };
  garage: { selected: string; cars: OwnedCar[] };
  records: {
    bestCombo: number;
    bestScores: Record<string, number>;
    bestTimes: Record<string, number>;
    medals: Record<string, string>;
    ghosts: Record<string, string>;
  };
  settings: Settings;
  world: { season: 'auto' | 'spring' | 'summer' | 'autumn' | 'winter'; time: 'auto' | 'dawn' | 'day' | 'golden' | 'dusk' | 'night'; lastLocation: string };
  progress: { introDone: boolean; badges: string[] };
}

export function starterCar(): OwnedCar {
  return {
    uid: 'car-1',
    carId: 'sakura_s15',
    parts: {},
    tune: {},
    paint: { body: '#c8102e', finish: 'metallic', wheels: '#c9ccd1', calipers: '#d21f2b' },
    livery: [],
    mileage: 0,
  };
}

export function newSave(): SaveData {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    profile: { name: 'Driver', credits: 15000, xp: 0, level: 1 },
    garage: { selected: 'car-1', cars: [starterCar()] },
    records: { bestCombo: 0, bestScores: {}, bestTimes: {}, medals: {}, ghosts: {} },
    settings: defaultSettings(),
    world: { season: 'auto', time: 'auto', lastLocation: 'minami' },
    progress: { introDone: false, badges: [] },
  };
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Migration steps: index i upgrades a version-i save to version i+1. */
const MIGRATIONS: ((s: Raw) => Raw)[] = [
  // v0 → v1: the v0.1 prototype kept loose localStorage keys; fold them into a save
  (old) => {
    const s = newSave() as unknown as Raw;
    s.version = 1;
    if (typeof old.kaze_best === 'number') s.records.bestCombo = old.kaze_best;
    if (typeof old.kaze_paint === 'string') s.garage.cars[0].paint.body = old.kaze_paint;
    if (old.kaze_tune && typeof old.kaze_tune === 'object') s.garage.cars[0].tune = { ...old.kaze_tune };
    if (typeof old.kaze_muted === 'boolean') s.settings.audio.muted = old.kaze_muted;
    delete s.records.bestScores;
    return s;
  },
  // v1 → v2: per-event best scores were added
  (s) => {
    s.records = { bestScores: {}, ...s.records };
    s.version = 2;
    return s;
  },
];

/** Bring any older save up to date and fill in missing fields. */
export function migrate(input: unknown): SaveData {
  let s: Raw = input && typeof input === 'object' ? { ...(input as Raw) } : {};
  let v = typeof s.version === 'number' ? s.version : 0;
  if (v > SAVE_VERSION) throw new Error(`Save is from a newer version (${v})`);
  while (v < SAVE_VERSION) {
    s = MIGRATIONS[v](s);
    v = s.version;
  }
  const d = newSave();
  const out: SaveData = {
    ...d,
    ...s,
    profile: { ...d.profile, ...(s.profile ?? {}) },
    garage: { ...d.garage, ...(s.garage ?? {}) },
    records: { ...d.records, ...(s.records ?? {}) },
    world: { ...d.world, ...(s.world ?? {}) },
    progress: { ...d.progress, ...(s.progress ?? {}) },
    settings: normalizeSettings(s.settings),
    version: SAVE_VERSION,
  } as SaveData;
  if (!Array.isArray(out.garage.cars) || out.garage.cars.length === 0) out.garage.cars = [starterCar()];
  if (!out.garage.cars.some((c) => c.uid === out.garage.selected)) out.garage.selected = out.garage.cars[0].uid;
  return out;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function storage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const k = '__kz_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

/** Load the save, migrating it if needed. Falls back to the backup, then to a new save. */
export function loadSave(store: StorageLike | null = storage()): SaveData {
  if (!store) return newSave();
  for (const key of [SAVE_KEY, BACKUP_KEY]) {
    try {
      const raw = store.getItem(key);
      if (raw) return migrate(JSON.parse(raw));
    } catch {
      /* try the next */
    }
  }
  // v0 prototype keys
  try {
    const old: Raw = {};
    let any = false;
    for (const k of ['kaze_best', 'kaze_paint', 'kaze_tune', 'kaze_muted']) {
      const v = store.getItem(k);
      if (v !== null) {
        old[k] = JSON.parse(v);
        any = true;
      }
    }
    if (any) return migrate(old);
  } catch {
    /* ignore */
  }
  return newSave();
}

export function writeSave(data: SaveData, store: StorageLike | null = storage()): boolean {
  if (!store) return false;
  try {
    data.updatedAt = Date.now();
    const prev = store.getItem(SAVE_KEY);
    if (prev) store.setItem(BACKUP_KEY, prev);
    store.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// ---------- export / import codes ----------

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart]);
  const res = new Response(blob.stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const hasCompression = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Pack any JSON value into a short shareable code. `kind` is a 1-letter tag (S = save, B = build). */
export async function encodeCode(value: unknown, kind = 'S'): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const packed = hasCompression() ? await pipe(json, new CompressionStream('deflate-raw')) : json;
  const flag = hasCompression() ? 'z' : 'p';
  const crc = crc32(json).toString(36).padStart(7, '0');
  return `${CODE_PREFIX}${kind}${flag}-${toB64Url(packed)}-${crc}`;
}

export async function decodeCode(code: string, kind = 'S'): Promise<unknown> {
  const clean = code.trim().replace(/\s+/g, '');
  const m = /^KZD([A-Z])([zp])-([A-Za-z0-9_-]+)-([0-9a-z]+)$/.exec(clean);
  if (!m) throw new Error('That does not look like a Kaze Drift code.');
  if (m[1] !== kind) throw new Error('That code is for something else.');
  let bytes = fromB64Url(m[3]);
  if (m[2] === 'z') {
    if (!hasCompression()) throw new Error('This browser cannot read compressed codes.');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  }
  if (crc32(bytes).toString(36).padStart(7, '0') !== m[4]) throw new Error('The code is damaged (checksum mismatch).');
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function exportSave(data: SaveData): Promise<string> {
  return encodeCode(data, 'S');
}

export async function importSave(code: string): Promise<SaveData> {
  return migrate(await decodeCode(code, 'S'));
}
