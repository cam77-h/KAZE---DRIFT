import { ACTIONS, applyPreset, assistPreset, type Action, type Settings } from '../core/settings';
import { PAD_LABELS, keyLabel, type InputManager } from '../input/input';
import { TRACKS, trackName } from '../data';
import { Track } from '../world/track';
import { exportSave, importSave, type SaveData } from '../core/save';
import { CREDITS } from '../data/credits';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export interface MenuCallbacks {
  onFreeDrive(): void;
  onSelectLocation(id: string): void;
  onResume(): void;
  onReset(): void;
  onChangeLocation(): void;
  onQuit(): void;
  onSettingsChanged(section: string): void;
  onImportSave(data: SaveData): void;
  onResetSave(): void;
  click(): void;
}

const TIPS = [
  ['FEINT', 'Flick the wheel away from the corner, then back in. The weight swing pulls the rear loose without touching the handbrake.'],
  ['THROTTLE IS STEERING', 'In a slide, more throttle means more angle. Ease off to straighten up, feed it in to swing the rear wider.'],
  ['COUNTER-STEER', 'Point the front wheels where you want to go. Drift assist helps, but the Expert preset leaves it all to you.'],
  ['CLUTCH KICK', 'Hold the clutch for a moment at full throttle, then dump it. The revs snap the rear tires loose.'],
  ['E-BRAKE ENTRY', 'A short tap of the handbrake at turn-in locks the rears and swings the car. Hold it too long and you scrub all your speed.'],
  ['LIFT-OFF', 'Lifting the throttle mid-corner shifts weight forward. The front bites, the rear goes light.'],
];

/** All full-screen menus. */
export class Menus {
  private screens: Record<string, HTMLElement> = {};
  private settingsTab = 'graphics';
  private returnTo: string = 'title';
  onClose: ((to: string) => void) | null = null;
  private loadingBar!: HTMLElement;
  private loadingText!: HTMLElement;
  private loadName!: HTMLElement;
  private loadJp!: HTMLElement;
  private loadTip!: HTMLElement;

  constructor(
    private parent: HTMLElement,
    private settings: Settings,
    private input: InputManager,
    private save: () => SaveData,
    private cb: MenuCallbacks,
  ) {
    this.buildTitle();
    this.buildSelect();
    this.buildPause();
    this.buildSettings();
    this.buildLoading();
  }

  private screen(id: string): HTMLElement {
    const s = el('div', 'screen');
    s.id = id;
    s.appendChild(el('div', 'speedlines'));
    this.parent.appendChild(s);
    this.screens[id] = s;
    return s;
  }

  show(id: string | null): void {
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('on', k === id);
    if (id === 'settings') this.renderSettings();
    const first = id ? this.screens[id]?.querySelector<HTMLElement>('.mbtn, .card, .sbtn') : null;
    first?.focus({ preventScroll: true });
  }

  get visible(): string | null {
    for (const [k, s] of Object.entries(this.screens)) if (s.classList.contains('on')) return k;
    return null;
  }

  private button(label: string, sub: string, fn: () => void): HTMLButtonElement {
    const b = el('button', 'mbtn', `${label}<small>${sub}</small>`);
    b.addEventListener('click', () => {
      this.cb.click();
      fn();
    });
    return b;
  }

  // ---------------------------------------------------------------- title
  private buildTitle(): void {
    const s = this.screen('title');
    s.append(el('div', 'vkana', 'カゼドリフト・ストリートカルチャー'));
    const logo = el('div', 'logo');
    logo.append(el('div', 'kanji', '風'), el('h1', '', 'KAZE <span>DRIFT</span>'), el('div', 'tag', '峠 · 首都高 · ドリフト — a love letter to the night meets'));
    s.append(logo);
    const press = el('button', 'press mbtn', 'PRESS ANY KEY<small>スタート</small>');
    press.style.cssText = 'background:none;width:auto;';
    press.addEventListener('click', () => this.cb.onFreeDrive());
    s.append(press);
    s.append(el('div', 'hint', 'UPDATE 2 · v0.3<br><kbd>W A S D</kbd> drive · <kbd>Space</kbd> handbrake · gamepad supported'));
  }

  // ---------------------------------------------------------------- location select
  private buildSelect(): void {
    const s = this.screen('select');
    const t = el('div', 'panel-title');
    t.append(el('span', 'chip', 'FREE DRIVE'), el('h2', '', 'Choose a location'), el('div', 'kana', 'ロケーション'));
    s.append(t);
    const cards = el('div', 'cards');
    const blurbs: Record<string, string> = {
      minami: 'A tight mountain drift park: a downhill sweeper, a 16 m hairpin, a long concrete wall to clip and a guardrail-lined last corner. 1.0 km, 22 m of elevation.',
      skidpad: 'Wide open proving ground with painted rings and cone gates. The place to learn throttle control, donuts and figure eights.',
    };
    for (const id of ['minami', 'skidpad']) {
      const n = trackName(id);
      const card = el('button', 'card');
      const cv = el('canvas');
      cv.width = 760;
      cv.height = 380;
      card.append(cv);
      const body = el('div', 'body');
      body.append(el('span', 'chip', n.region.toUpperCase()), el('h3', '', n.name), el('div', 'jp', n.jp), el('p', '', blurbs[id] ?? ''));
      card.append(body);
      card.addEventListener('click', () => {
        this.cb.click();
        this.cb.onSelectLocation(id);
      });
      cards.append(card);
      // preview map, drawn lazily
      requestAnimationFrame(() => drawPreview(cv, id));
    }
    s.append(cards);
    const back = el('div', 'back');
    back.append(this.button('BACK', '戻る', () => this.show('title')));
    s.append(back);
  }

  // ---------------------------------------------------------------- pause
  private buildPause(): void {
    const s = this.screen('pause');
    const t = el('div', 'panel-title');
    t.append(el('span', 'chip', 'PAUSED'), el('h2', '', 'Pit stop'), el('div', 'kana', '一時停止'));
    s.append(t);
    const menu = el('div', 'menu');
    menu.append(
      this.button('RESUME', '再開', () => this.cb.onResume()),
      this.button('RESET CAR', 'リセット', () => this.cb.onReset()),
      this.button('END RUN', '終了 · see results', () => this.cb.onChangeLocation()),
      this.button('SETTINGS', '設定', () => this.openSettings('pause')),
      this.button('QUIT TO MENU', 'メニューへ · no rewards', () => this.cb.onQuit()),
    );
    s.append(menu);
  }

  openSettings(from: string, tab?: string): void {
    this.returnTo = from;
    if (tab) this.settingsTab = tab;
    this.show('settings');
  }

  // ---------------------------------------------------------------- settings
  private sbody!: HTMLElement;
  private tabBar!: HTMLElement;
  private buildSettings(): void {
    const s = this.screen('settings');
    const t = el('div', 'panel-title');
    t.append(el('span', 'chip', 'SETTINGS'), el('h2', '', 'Setup'), el('div', 'kana', 'セッティング'));
    s.append(t);
    this.tabBar = el('div', 'tabs');
    s.append(this.tabBar);
    this.sbody = el('div', 'sbody');
    s.append(this.sbody);
    const actions = el('div', 'actions');
    const back = el('button', 'sbtn primary', 'DONE');
    back.addEventListener('click', () => {
      this.cb.click();
      if (this.onClose) this.onClose(this.returnTo);
      else this.show(this.returnTo);
    });
    actions.append(back);
    s.append(actions);
  }

  private renderSettings(): void {
    const tabs: [string, string][] = [['graphics', 'GRAPHICS'], ['controls', 'CONTROLS'], ['assists', 'ASSISTS'], ['audio', 'AUDIO'], ['gameplay', 'GAMEPLAY'], ['save', 'SAVE'], ['credits', 'CREDITS']];
    this.tabBar.innerHTML = '';
    for (const [id, label] of tabs) {
      const b = el('button', 'tab' + (id === this.settingsTab ? ' on' : ''), label);
      b.addEventListener('click', () => {
        this.cb.click();
        this.settingsTab = id;
        this.renderSettings();
      });
      this.tabBar.append(b);
    }
    const body = this.sbody;
    body.innerHTML = '';
    const S = this.settings;
    const changed = (section: string) => this.cb.onSettingsChanged(section);

    const row = (label: string, control: HTMLElement, desc?: string, val?: HTMLElement) => {
      const r = el('div', 'row');
      r.append(el('label', '', label), control, val ?? el('span'));
      if (desc) r.append(el('div', 'desc', desc));
      body.append(r);
      return r;
    };
    const toggle = (get: () => boolean, set: (v: boolean) => void, section: string) => {
      const b = el('button', 'toggle' + (get() ? ' on' : ''));
      b.addEventListener('click', () => {
        set(!get());
        b.classList.toggle('on', get());
        this.cb.click();
        changed(section);
      });
      return b;
    };
    const slider = (min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string, section: string) => {
      const i = el('input');
      i.type = 'range';
      i.min = String(min);
      i.max = String(max);
      i.step = String(step);
      i.value = String(get());
      const v = el('span', 'val', fmt(get()));
      i.addEventListener('input', () => {
        set(Number(i.value));
        v.textContent = fmt(Number(i.value));
        changed(section);
      });
      return [i, v] as const;
    };
    const seg = (opts: [string, string][], get: () => string, set: (v: string) => void, section: string) => {
      const d = el('div', 'seg');
      for (const [id, label] of opts) {
        const b = el('button', id === get() ? 'on' : '', label);
        b.addEventListener('click', () => {
          set(id);
          this.cb.click();
          changed(section);
          this.renderSettings();
        });
        d.append(b);
      }
      return d;
    };

    if (this.settingsTab === 'graphics') {
      const g = S.graphics;
      row('Preset', seg([['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA'], ['custom', 'CUSTOM']], () => g.preset, (v) => { if (v !== 'custom') applyPreset(g, v as 'low'); else g.preset = 'custom'; }, 'graphics'), 'Medium targets 60 fps on a mid-range laptop.');
      const custom = (fn: () => void) => () => { fn(); g.preset = 'custom'; };
      row('Shadows', toggle(() => g.shadows, (v) => custom(() => (g.shadows = v))(), 'graphics'));
      row('Shadow quality', seg([['1', 'LOW'], ['2', 'MED'], ['3', 'HIGH']], () => String(g.shadowQuality), (v) => custom(() => (g.shadowQuality = Number(v) as 1))(), 'graphics'));
      row('Ambient occlusion (SSAO)', toggle(() => g.ssao, (v) => custom(() => (g.ssao = v))(), 'graphics'));
      row('Bloom', toggle(() => g.bloom, (v) => custom(() => (g.bloom = v))(), 'graphics'));
      row('Motion blur', toggle(() => g.motionBlur, (v) => custom(() => (g.motionBlur = v))(), 'graphics'));
      row('Anti-aliasing (SMAA)', toggle(() => g.antialias, (v) => custom(() => (g.antialias = v))(), 'graphics'));
      row('Film grain & vignette', toggle(() => g.grain, (v) => custom(() => (g.grain = v))(), 'graphics'));
      const [rs, rsv] = slider(0.5, 1.5, 0.05, () => g.renderScale, (v) => custom(() => (g.renderScale = v))(), (v) => `${Math.round(v * 100)}%`, 'graphics');
      row('Render scale', rs, undefined, rsv);
      const [pd, pdv] = slider(0.2, 1.5, 0.1, () => g.particles, (v) => custom(() => (g.particles = v))(), (v) => `${Math.round(v * 100)}%`, 'graphics');
      row('Particle density', pd, 'Applies on the next location load.', pdv);
      const [dd, ddv] = slider(0.5, 1.5, 0.05, () => g.drawDistance, (v) => custom(() => (g.drawDistance = v))(), (v) => `${Math.round(v * 100)}%`, 'graphics');
      row('Draw distance', dd, undefined, ddv);
    } else if (this.settingsTab === 'controls') {
      const c = S.controls;
      body.append(el('div', 'row', '<label>How to drift</label><span></span><span></span><div class="desc">Throttle W / ↑ · Brake & reverse S / ↓ · Steer A D / ← → · Handbrake Space · Clutch L-Shift · Shift E / Q (manual) · Camera C · Look back B · Reset R · Pause Esc. Gamepad: RT throttle, LT brake, left stick steer, A handbrake, LB clutch, B/X shift, Y camera.</div>'));
      for (const a of ACTIONS) {
        const wrap = el('div', 'bind');
        const keys = c.keys[a.id];
        keys.forEach((code, i) => {
          const b = el('button', '', keyLabel(code));
          b.title = 'Click, then press a key. Press Backspace to clear.';
          b.addEventListener('click', () => {
            b.classList.add('wait');
            b.textContent = '…';
            this.input.captureNextKey((k) => {
              if (k === 'Backspace') keys.splice(i, 1);
              else keys[i] = k;
              changed('controls');
              this.renderSettings();
            });
          });
          wrap.append(b);
        });
        const add = el('button', '', '+');
        add.title = 'Add another key';
        add.addEventListener('click', () => {
          add.classList.add('wait');
          add.textContent = '…';
          this.input.captureNextKey((k) => {
            if (k !== 'Backspace' && !keys.includes(k)) keys.push(k);
            changed('controls');
            this.renderSettings();
          });
        });
        wrap.append(add);
        const pad = el('button', '', (c.pad[a.id] ?? []).map((i) => PAD_LABELS[i] ?? `B${i}`).join(' / ') || '—');
        pad.title = 'Click, then press a gamepad button';
        pad.addEventListener('click', () => {
          pad.classList.add('wait');
          pad.textContent = 'press…';
          waitPadButton((btn) => {
            c.pad[a.id as Action] = [btn];
            changed('controls');
            this.renderSettings();
          });
        });
        row(a.label, wrap, undefined, pad);
      }
      const [s1, v1] = slider(0.5, 2, 0.05, () => c.steerSensitivity, (v) => (c.steerSensitivity = v), (v) => v.toFixed(2), 'controls');
      row('Steering sensitivity', s1, 'Gamepad and touch. Higher reaches full lock sooner.', v1);
      const [s2, v2] = slider(1, 3, 0.05, () => c.steerLinearity, (v) => (c.steerLinearity = v), (v) => v.toFixed(2), 'controls');
      row('Steering linearity', s2, '1.0 is linear. Higher values give finer control near the centre.', v2);
      const [s3, v3] = slider(0, 0.3, 0.01, () => c.deadzone, (v) => (c.deadzone = v), (v) => `${Math.round(v * 100)}%`, 'controls');
      row('Stick deadzone', s3, undefined, v3);
      const [s4, v4] = slider(0.5, 2, 0.05, () => c.keyboardSteerSpeed, (v) => (c.keyboardSteerSpeed = v), (v) => v.toFixed(2), 'controls');
      row('Keyboard steering speed', s4, undefined, v4);
      row('Vibration', toggle(() => c.vibration, (v) => (c.vibration = v), 'controls'));
    } else if (this.settingsTab === 'assists') {
      const a = S.assists;
      row('Preset', seg([['friendly', 'FRIENDLY'], ['expert', 'EXPERT']], () => (a.driftAssist === 0 && !a.abs && !a.steeringAssist ? 'expert' : 'friendly'), (v) => Object.assign(a, assistPreset(v as 'friendly')), 'assists'), 'Expert turns every assist off and uses the manual gearbox.');
      row('Transmission', seg([['auto', 'AUTOMATIC'], ['manual', 'MANUAL']], () => a.transmission, (v) => (a.transmission = v as 'auto'), 'assists'), 'Manual: E / Q (or B / X on a gamepad). The clutch works in both.');
      row('ABS', toggle(() => a.abs, (v) => (a.abs = v), 'assists'), 'Stops the wheels locking under braking.');
      row('Traction control', toggle(() => a.tcs, (v) => (a.tcs = v), 'assists'), 'Cuts power when the rear wheels spin. Turn it off to drift.');
      row('Stability control', toggle(() => a.stability, (v) => (a.stability = v), 'assists'), 'Fights big slides. Off by default in a drift game.');
      const [d1, dv] = slider(0, 1, 0.05, () => a.driftAssist, (v) => (a.driftAssist = v), (v) => `${Math.round(v * 100)}%`, 'assists');
      row('Drift assist', d1, 'Counter-steer help and yaw damping while sliding. 55% is the tuned default.', dv);
      row('Steering assist', toggle(() => a.steeringAssist, (v) => (a.steeringAssist = v), 'assists'), 'Less lock at speed, full lock when counter-steering.');
    } else if (this.settingsTab === 'audio') {
      const au = S.audio;
      for (const [k, label] of [['master', 'Master'], ['engine', 'Engine'], ['effects', 'Effects'], ['music', 'Music (radio arrives in Phase 6)'], ['ambience', 'Ambience']] as const) {
        const [i, v] = slider(0, 1, 0.05, () => au[k], (x) => (au[k] = x), (x) => `${Math.round(x * 100)}%`, 'audio');
        row(label, i, undefined, v);
      }
      row('Mute', toggle(() => au.muted, (v) => (au.muted = v), 'audio'));
    } else if (this.settingsTab === 'gameplay') {
      const gp = S.gameplay;
      row('Units', seg([['kmh', 'KM/H'], ['mph', 'MPH']], () => gp.units, (v) => (gp.units = v as 'kmh'), 'gameplay'));
      row('Default camera', seg([['0', 'CHASE'], ['1', 'FAR'], ['2', 'HOOD'], ['3', 'BUMPER']], () => String(gp.camera), (v) => (gp.camera = Number(v)), 'gameplay'));
      const [h1, hv] = slider(0.7, 1.3, 0.05, () => gp.hudScale, (v) => (gp.hudScale = v), (v) => `${Math.round(v * 100)}%`, 'gameplay');
      row('HUD scale', h1, undefined, hv);
      const [c1, cv] = slider(0, 1.5, 0.05, () => gp.cameraShake, (v) => (gp.cameraShake = v), (v) => `${Math.round(v * 100)}%`, 'gameplay');
      row('Camera shake', c1, undefined, cv);
      row('Classic physics', toggle(() => gp.physicsModel === 'classic', (v) => (gp.physicsModel = v ? 'classic' : 'sim'), 'gameplay'), 'The Update 1–4 handling model. Off = the 360 Hz sim model (sim tires, relaxation, heat and wear). Applies on the next drive.');
      row('Telemetry overlay', toggle(() => gp.showTelemetry, (v) => (gp.showTelemetry = v), 'gameplay'), 'Per-wheel load, slip and surface. For tuners.');
    } else if (this.settingsTab === 'credits') {
      body.append(el('div', 'row', '<label>Kaze Drift</label><span></span><span></span><div class="desc">All car, brand and place names are fictional. Real badges on imported models are hidden and plates replaced. CC-BY models are credited below as their licenses require.</div>'));
      for (const c of CREDITS) {
        const link = el('a', '', c.url.replace(/^https?:\/\//, ''));
        link.href = c.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.style.color = 'var(--sakura)';
        const r = row(`${c.title}`, el('span', 'desc', `${c.author} · ${c.license} · ${c.use}`), undefined, link);
        r.querySelector('.desc')!.setAttribute('style', 'margin:0');
      }
    } else if (this.settingsTab === 'save') {
      const box = el('textarea', 'codebox');
      box.placeholder = 'Your save code appears here. Paste a code to import it.';
      const exp = el('button', 'sbtn', 'EXPORT CODE');
      exp.addEventListener('click', async () => {
        box.value = await exportSave(this.save());
        box.select();
        try {
          await navigator.clipboard.writeText(box.value);
          exp.textContent = 'COPIED';
        } catch {
          exp.textContent = 'SELECT & COPY';
        }
      });
      const imp = el('button', 'sbtn', 'IMPORT CODE');
      const msg = el('span', 'val', '');
      imp.addEventListener('click', async () => {
        try {
          const data = await importSave(box.value);
          this.cb.onImportSave(data);
          msg.textContent = 'IMPORTED';
        } catch (e) {
          msg.textContent = (e as Error).message;
        }
      });
      const wipe = el('button', 'sbtn', 'RESET PROGRESS');
      wipe.addEventListener('click', () => {
        if (wipe.dataset.confirm) {
          this.cb.onResetSave();
          wipe.textContent = 'DONE';
        } else {
          wipe.dataset.confirm = '1';
          wipe.textContent = 'CLICK AGAIN TO CONFIRM';
        }
      });
      const btns = el('div', 'seg');
      btns.append(exp, imp, wipe);
      row('Save code', btns, 'Move your progress to another browser: export here, import there.', msg);
      body.append(box);
    }
  }

  // ---------------------------------------------------------------- loading
  private buildLoading(): void {
    const s = this.screen('loading');
    const w = el('div', 'where');
    this.loadName = el('h2');
    this.loadJp = el('div', 'jp');
    w.append(el('span', 'chip', 'LOADING'), this.loadName, this.loadJp);
    this.loadTip = el('div', 'tip');
    this.loadingBar = el('div', 'loadbar');
    for (let i = 0; i < 40; i++) this.loadingBar.append(el('i'));
    this.loadingText = el('div', 'loadrpm', '0 RPM');
    s.append(w, this.loadTip, this.loadingBar, this.loadingText);
  }

  showLoading(id: string): void {
    const n = trackName(id);
    this.loadName.textContent = n.name;
    this.loadJp.textContent = n.jp;
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.loadTip.innerHTML = `<b>${tip[0]}</b>${tip[1]}`;
    this.setProgress(0);
    this.show('loading');
  }

  setProgress(f: number): void {
    const bars = this.loadingBar.children;
    const n = Math.round(f * bars.length);
    for (let i = 0; i < bars.length; i++) bars[i].className = i < n ? (i >= bars.length * 0.85 ? 'on red' : 'on') : '';
    this.loadingText.textContent = `${Math.round(f * 8000)} RPM`;
  }
}

function waitPadButton(fn: (i: number) => void): void {
  const start = performance.now();
  const prev = new Set<number>();
  const pads = navigator.getGamepads?.() ?? [];
  for (const p of pads) p?.buttons.forEach((b, i) => b.pressed && prev.add(i));
  const tick = () => {
    if (performance.now() - start > 8000) return;
    for (const p of navigator.getGamepads?.() ?? []) {
      if (!p) continue;
      for (let i = 0; i < p.buttons.length; i++) if (p.buttons[i].pressed && !prev.has(i)) return fn(i);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const previewTracks = new Map<string, Track>();
function drawPreview(cv: HTMLCanvasElement, id: string): void {
  let t = previewTracks.get(id);
  if (!t) previewTracks.set(id, (t = new Track(TRACKS[id])));
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0d1a2b';
  g.fillRect(0, 0, cv.width, cv.height);
  // diagonal hatching
  g.strokeStyle = 'rgba(242,239,230,0.04)';
  for (let x = -cv.height; x < cv.width; x += 18) {
    g.beginPath();
    g.moveTo(x, cv.height);
    g.lineTo(x + cv.height, 0);
    g.stroke();
  }
  const pts: [number, number][] = [];
  for (const r of t.roads) for (const p of r.samples) pts.push([p.x, p.z]);
  for (const p of t.def.pads) {
    const rr = p.shape === 'circle' ? p.r ?? 0 : Math.max(p.w ?? 0, p.d ?? 0) / 2;
    pts.push([p.x - rr, p.z - rr], [p.x + rr, p.z + rr]);
  }
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const sc = Math.min((cv.width - 80) / (maxX - minX), (cv.height - 60) / (maxZ - minZ));
  const ox = (cv.width - (maxX - minX) * sc) / 2, oz = (cv.height - (maxZ - minZ) * sc) / 2;
  const P = (x: number, z: number): [number, number] => [ox + (x - minX) * sc, oz + (z - minZ) * sc];
  for (const p of t.def.pads) {
    g.fillStyle = 'rgba(242,239,230,0.18)';
    if (p.shape === 'circle') {
      const [cx, cz] = P(p.x, p.z);
      g.beginPath();
      g.arc(cx, cz, (p.r ?? 1) * sc, 0, Math.PI * 2);
      g.fill();
    } else {
      const [x0, z0] = P(p.x - (p.w ?? 0) / 2, p.z - (p.d ?? 0) / 2);
      g.fillRect(x0, z0, (p.w ?? 0) * sc, (p.d ?? 0) * sc);
    }
  }
  for (const r of t.roads) {
    for (const [w, c] of [[14, '#e8202f'], [6, '#f2efe6']] as const) {
      g.strokeStyle = c;
      g.lineWidth = w;
      g.lineJoin = 'round';
      g.beginPath();
      r.samples.forEach((p, i) => {
        const [x, z] = P(p.x, p.z);
        if (i) g.lineTo(x, z);
        else g.moveTo(x, z);
      });
      if (r.def.closed) g.closePath();
      g.stroke();
    }
  }
  if (!t.roads.length) {
    g.strokeStyle = '#f2efe6';
    g.lineWidth = 3;
    for (const rr of [24, 46]) {
      const [cx, cz] = P(0, 0);
      g.beginPath();
      g.arc(cx, cz, rr * sc, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = '#e8202f';
    for (const x of [-58, 58]) {
      const [cx, cz] = P(x, 0);
      g.beginPath();
      g.arc(cx, cz, 18 * sc, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

/** On-screen touch controls: an analog steering slider plus pedal buttons. */
export class TouchControls {
  readonly root: HTMLElement;
  constructor(parent: HTMLElement, input: InputManager) {
    this.root = el('div');
    this.root.id = 'touch';
    const pad = el('div', 'tpad');
    const rail = el('div', 'rail');
    const knob = el('div', 'knob');
    pad.append(rail, knob);
    const place = (v: number) => {
      const r = rail.getBoundingClientRect(), p = pad.getBoundingClientRect();
      knob.style.left = `${r.left - p.left + ((v + 1) / 2) * r.width}px`;
    };
    let pid = -1;
    const move = (e: PointerEvent) => {
      const r = rail.getBoundingClientRect();
      const v = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      input.touch.steer = Math.sign(v) * Math.pow(Math.abs(v), input.settings.steerLinearity * 0.8);
      place(v);
    };
    pad.addEventListener('pointerdown', (e) => {
      pid = e.pointerId;
      pad.setPointerCapture(pid);
      move(e);
    });
    pad.addEventListener('pointermove', (e) => e.pointerId === pid && move(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = -1;
      input.touch.steer = 0;
      place(0);
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    requestAnimationFrame(() => place(0));

    const btns = el('div', 'tbtns');
    const mk = (label: string, key: 'throttle' | 'brake' | 'handbrake', cls = '') => {
      const b = el('div', 'tb ' + cls, label);
      const on = (e: PointerEvent) => {
        e.preventDefault();
        input.touch[key] = 1;
        b.classList.add('down');
        input.lastDevice = 'touch';
      };
      const off = (e: PointerEvent) => {
        e.preventDefault();
        input.touch[key] = 0;
        b.classList.remove('down');
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      return b;
    };
    const cam = el('div', 'tb', 'CAM');
    cam.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.press('camera');
    });
    btns.append(mk('E-BRAKE', 'handbrake'), mk('GAS', 'throttle', 'gas'), mk('BRAKE', 'brake'), cam);
    this.root.append(pad, btns);
    parent.appendChild(this.root);
  }
  setVisible(on: boolean): void {
    this.root.classList.toggle('on', on);
  }
}
