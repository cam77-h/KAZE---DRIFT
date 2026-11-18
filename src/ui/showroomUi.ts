import { CARS, CAR_ORDER, carName, carTagline, type CarDef } from '../data';
import { formatYen } from '../core/progression';
import type { OwnedCar, SaveData } from '../core/save';
import { measure } from '../physics/performance';
import type { CarPhysicsSpec } from '../physics/types';
import { rate, CLASSES, type ClassId, type StatBars } from '../garage/rating';
import type { Showroom, ShowroomCar } from '../render/showroom';
import type { PaintFinish } from '../vehicles/paint';
import './showroom.css';

// Update 4 §2: the showroom overlay used for Car Select, the Dealer and My Cars.
// The 3D car is rendered by render/showroom.ts behind this panel.

export type ShowroomMode = 'select' | 'dealer' | 'mycars';

export interface ShowroomCallbacks {
  click(): void;
  toast(msg: string): void;
  /** car select: drive this car */
  choose(uid: string): void;
  buy(carId: string, paint: string, finish: PaintFinish): OwnedCar | string;
  testDrive(carId: string, paint: string, finish: PaintFinish): void;
  upgrades(uid: string): void;
  close(): void;
}

interface Entry {
  car: ShowroomCar;
  def: CarDef;
  owned?: OwnedCar;
}

export const PAINTS = ['#c8102e', '#f2efe6', '#101215', '#1d4e9e', '#f2a900', '#2f7d4c', '#7b8189', '#e85d04', '#5a2a82', '#b5d4e8', '#3d2b1f', '#d6336c'];
const FINISH_LIST: PaintFinish[] = ['gloss', 'metallic', 'pearl', 'matte', 'candy'];
const BAR_NAMES: [keyof StatBars, string][] = [['speed', 'SPEED'], ['handling', 'HANDLING'], ['acceleration', 'ACCELERATION'], ['launch', 'LAUNCH'], ['braking', 'BRAKING'], ['drift', 'DRIFT']];
const DRIVE_BADGE: Record<string, string> = { RWD: 'FR', AWD: 'AWD', FWD: 'FF' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export function ownedToShowroom(o: OwnedCar): ShowroomCar {
  return { key: `${o.uid}|${o.paint.body}|${o.paint.finish}|${JSON.stringify(o.parts)}|${JSON.stringify(o.tune)}`, def: CARS[o.carId], paint: o.paint.body, finish: (o.paint.finish as PaintFinish) ?? 'metallic', build: o.parts, tune: o.tune };
}

export class ShowroomUi {
  readonly root: HTMLElement;
  private mode: ShowroomMode = 'select';
  private entries: Entry[] = [];
  private all: Entry[] = [];
  private index = 0;
  private panel: HTMLElement;
  private filtersEl: HTMLElement;
  private counter: HTMLElement;
  private titleEl: HTMLElement;
  private filters = { owned: false, cls: 'all', drive: 'all', price: 'all' };
  private paint = PAINTS[0];
  private finish: PaintFinish = 'metallic';
  private perfToken = 0;
  private padPrev = [false, false];
  open = false;

  constructor(
    parent: HTMLElement,
    private showroom: Showroom,
    private save: () => SaveData,
    private cb: ShowroomCallbacks,
  ) {
    this.root = el('div', 'screen showroom');
    this.root.id = 'showroom';
    const top = el('div', 'sr-top');
    this.titleEl = el('div', 'sr-title');
    this.filtersEl = el('div', 'sr-filters');
    const close = el('button', 'sr-close', '✕ <span>BACK</span>');
    close.addEventListener('click', () => this.cb.close());
    top.append(this.titleEl, this.filtersEl, close);
    const left = el('button', 'sr-arrow left', '‹');
    const right = el('button', 'sr-arrow right', '›');
    left.setAttribute('aria-label', 'Previous car');
    right.setAttribute('aria-label', 'Next car');
    left.addEventListener('click', () => this.step(-1));
    right.addEventListener('click', () => this.step(1));
    this.panel = el('div', 'sr-panel');
    this.counter = el('div', 'sr-counter');
    // swipe anywhere on the lower strip
    let sx = 0;
    this.counter.addEventListener('pointerdown', (e) => (sx = e.clientX));
    this.counter.addEventListener('pointerup', (e) => {
      if (Math.abs(e.clientX - sx) > 50) this.step(e.clientX < sx ? 1 : -1);
    });
    this.root.append(top, left, right, this.panel, this.counter);
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyQ') this.step(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyE') this.step(1);
      else if (e.code === 'Escape') this.cb.close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  show(mode: ShowroomMode, focusCarId?: string): void {
    this.mode = mode;
    this.open = true;
    this.showroom.active = true;
    this.root.classList.add('on');
    const sv = this.save();
    this.titleEl.innerHTML = mode === 'dealer' ? '<b>DEALER</b><span>ディーラー · Kaze Motors</span>' : mode === 'mycars' ? '<b>MY CARS</b><span>マイカー</span>' : '<b>CAR SELECT</b><span>車両選択</span>';
    if (mode === 'dealer') {
      this.all = CAR_ORDER.map((id) => {
        const def = CARS[id];
        return { def, owned: sv.garage.cars.find((c) => c.carId === id), car: { key: `dealer|${id}`, def, paint: def.visual.defaultPaint, finish: (def.visual.defaultFinish as PaintFinish) ?? 'metallic', build: {} } };
      });
    } else {
      this.all = sv.garage.cars.filter((o) => CARS[o.carId]).map((o) => ({ def: CARS[o.carId], owned: o, car: ownedToShowroom(o) }));
    }
    this.renderFilters();
    this.applyFilters();
    const focus = focusCarId ?? (mode === 'dealer' ? undefined : sv.garage.selected);
    const i = this.entries.findIndex((e) => (focusCarId && e.def.id === focusCarId) || (focus && e.owned?.uid === focus));
    this.index = Math.max(0, i);
    void this.present(0);
  }

  hide(): void {
    this.open = false;
    this.showroom.active = false;
    this.root.classList.remove('on');
  }

  /** gamepad bumpers browse (called every frame while open) */
  pollPad(): void {
    const pad = navigator.getGamepads?.().find((p) => p);
    if (!pad) return;
    const lb = !!pad.buttons[4]?.pressed, rb = !!pad.buttons[5]?.pressed;
    if (lb && !this.padPrev[0]) this.step(-1);
    if (rb && !this.padPrev[1]) this.step(1);
    this.padPrev = [lb, rb];
  }

  private step(d: number): void {
    if (this.entries.length < 2) return;
    this.cb.click();
    this.index = (this.index + d + this.entries.length) % this.entries.length;
    void this.present(d);
  }

  private renderFilters(): void {
    const f = this.filtersEl;
    f.innerHTML = '';
    const sel = (key: 'cls' | 'drive' | 'price', label: string, opts: [string, string][]) => {
      const s = el('select', 'sr-sel');
      s.setAttribute('aria-label', label);
      for (const [v, t] of opts) {
        const o = el('option', '', t);
        o.value = v;
        s.append(o);
      }
      s.value = this.filters[key];
      s.addEventListener('change', () => {
        this.filters[key] = s.value;
        this.applyFilters();
        this.index = 0;
        void this.present(0);
      });
      f.append(s);
    };
    if (this.mode === 'dealer') {
      const b = el('button', 'sr-chip' + (this.filters.owned ? ' on' : ''), 'OWNED');
      b.addEventListener('click', () => {
        this.filters.owned = !this.filters.owned;
        b.classList.toggle('on', this.filters.owned);
        this.applyFilters();
        this.index = 0;
        void this.present(0);
      });
      f.append(b);
    }
    sel('cls', 'Class', [['all', 'ALL CLASSES'], ...CLASSES.map((c) => [c.id, `CLASS ${c.id}`] as [string, string])]);
    sel('drive', 'Drivetrain', [['all', 'ALL DRIVE'], ['RWD', 'RWD'], ['AWD', 'AWD']]);
    if (this.mode === 'dealer') sel('price', 'Price', [['all', 'ANY PRICE'], ['lo', 'UNDER ¥50,000'], ['mid', '¥50,000–100,000'], ['hi', 'OVER ¥100,000']]);
  }

  private applyFilters(): void {
    const f = this.filters;
    this.entries = this.all.filter((e) => {
      if (f.owned && !e.owned) return false;
      const spec = e.def.physics;
      if (f.drive !== 'all' && spec.layout !== f.drive) return false;
      if (f.cls !== 'all' && rate(spec).cls !== (f.cls as ClassId)) return false;
      const p = e.def.price;
      if (f.price === 'lo' && p >= 50000) return false;
      if (f.price === 'mid' && (p < 50000 || p > 100000)) return false;
      if (f.price === 'hi' && p <= 100000) return false;
      return true;
    });
    if (!this.entries.length) this.entries = this.all.slice();
  }

  private async present(dir: number): Promise<void> {
    const e = this.entries[this.index];
    if (!e) return;
    if (this.mode === 'dealer') {
      this.paint = e.def.visual.defaultPaint;
      this.finish = (e.def.visual.defaultFinish as PaintFinish) ?? 'metallic';
    }
    this.counter.innerHTML = this.entries.map((x, i) => `<i class="${i === this.index ? 'on' : ''}"></i>`).join('') + `<span>${this.index + 1} / ${this.entries.length} · ← → to browse</span>`;
    this.renderPanel(e, e.def.physics);
    const spec = await this.showroom.show(e.car, dir);
    if (this.entries[this.index] !== e) return;
    this.renderPanel(e, spec);
    // preload the neighbours so swapping is instant
    const n = this.entries.length;
    this.showroom.preload([this.entries[(this.index + 1) % n].car, this.entries[(this.index - 1 + n) % n].car]);
  }

  private renderPanel(e: Entry, spec: CarPhysicsSpec): void {
    const sv = this.save();
    const r = rate(spec);
    const def = e.def;
    const locked = this.mode === 'dealer' && sv.profile.level < def.level;
    const year = (def as CarDef & { year?: number }).year;
    const p = this.panel;
    p.innerHTML = `
      <div class="sr-head">
        <div class="sr-class" style="--c:${r.color}"><b>${r.cls}</b><span>${r.rating}</span></div>
        <div><h2>${carName(def.id)}</h2>
        <div class="sr-meta">${year ? year + ' · ' : ''}${def.archetype} <em class="sr-drive">${DRIVE_BADGE[spec.layout] ?? spec.layout}</em></div></div>
      </div>
      <p class="sr-tag">${carTagline(def.id)}</p>
      <div class="sr-bars">${BAR_NAMES.map(([k, n]) => `<div class="sr-bar"><span>${n}</span><i><b style="width:${r.bars[k] * 10}%"></b></i><em>${r.bars[k].toFixed(1)}</em></div>`).join('')}</div>
      <div class="sr-specs">
        <div><span>POWER</span><b>${Math.round(r.hp)} hp</b></div>
        <div><span>TORQUE</span><b>${Math.round(r.torque)} N·m</b></div>
        <div><span>WEIGHT</span><b>${Math.round(r.mass)} kg</b></div>
        <div><span>FRONT</span><b>${Math.round(r.frontPct * 100)}%</b></div>
        <div><span>0–100 KM/H</span><b class="sr-t100">…</b></div>
        <div><span>TOP SPEED</span><b class="sr-topspeed">…</b></div>
      </div>
      <div class="sr-state"></div>
      <div class="sr-paint"></div>
      <div class="sr-actions"></div>`;
    // honest numbers from the physics, computed off the click
    const token = ++this.perfToken;
    setTimeout(() => {
      if (token !== this.perfToken) return;
      const m = measure(spec);
      const mph = sv.settings.gameplay.units === 'mph';
      const t = p.querySelector('.sr-t100'), tp = p.querySelector('.sr-topspeed');
      if (t) t.textContent = `${m.zeroTo100.toFixed(1)} s`;
      if (tp) tp.textContent = mph ? `${Math.round(m.topSpeed / 1.609)} mph` : `${Math.round(m.topSpeed)} km/h`;
    }, 40);

    const state = p.querySelector('.sr-state') as HTMLElement;
    const actions = p.querySelector('.sr-actions') as HTMLElement;
    const btn = (label: string, cls: string, fn: () => void) => {
      const b = el('button', 'sbtn ' + cls, label);
      b.addEventListener('click', () => {
        this.cb.click();
        fn();
      });
      actions.append(b);
      return b;
    };
    if (this.mode === 'dealer') {
      const owned = sv.garage.cars.filter((c) => c.carId === def.id).length;
      state.innerHTML = locked ? `<span class="lock">LOCKED – LEVEL ${def.level}</span>` : `<b class="price">${def.price ? formatYen(def.price) : 'STARTER'}</b>${owned ? `<span class="owned">OWNED${owned > 1 ? ' ×' + owned : ''}</span>` : ''}`;
      if (!locked) this.renderPaint(p.querySelector('.sr-paint') as HTMLElement);
      const buy = btn(owned ? 'BUY ANOTHER' : 'BUY', 'primary', () => {
        const res = this.cb.buy(def.id, this.paint, this.finish);
        if (typeof res === 'string') this.cb.toast(res);
        else {
          this.cb.toast(`${carName(def.id).toUpperCase()} · BOUGHT`);
          e.owned = res;
          this.renderPanel(e, spec);
        }
      });
      buy.disabled = locked || sv.profile.credits < def.price;
      btn('TEST DRIVE', '', () => this.cb.testDrive(def.id, this.paint, this.finish));
    } else {
      const o = e.owned!;
      const parts = Object.values(o.parts).filter((v) => v && v !== 'stock').length;
      state.innerHTML = `<span class="owned">OWNED</span><span class="sr-sub">${parts} part${parts === 1 ? '' : 's'} installed · ${Math.round(o.mileage / 1000)} km</span>`;
      if (this.mode === 'select') btn('SELECT', 'primary', () => this.cb.choose(o.uid));
      else {
        btn(sv.garage.selected === o.uid ? 'CURRENT CAR' : 'SET AS CURRENT', 'primary', () => {
          sv.garage.selected = o.uid;
          this.cb.toast(`${carName(o.carId).toUpperCase()} · SELECTED`);
          this.renderPanel(e, spec);
        });
      }
      btn('UPGRADES & TUNING', '', () => this.cb.upgrades(o.uid));
    }
  }

  private renderPaint(box: HTMLElement): void {
    box.innerHTML = '<span class="sr-lbl">PAINT PREVIEW</span>';
    const row = el('div', 'sr-swatches');
    for (const c of PAINTS) {
      const s = el('button', 'sr-sw' + (c === this.paint ? ' on' : ''));
      s.style.background = c;
      s.setAttribute('aria-label', `Paint ${c}`);
      s.addEventListener('click', () => {
        this.paint = c;
        this.showroom.previewPaint(this.paint, this.finish);
        row.querySelectorAll('.sr-sw').forEach((x) => x.classList.toggle('on', x === s));
      });
      row.append(s);
    }
    const fin = el('div', 'sr-finishes');
    for (const f of FINISH_LIST) {
      const b = el('button', 'sr-chip' + (f === this.finish ? ' on' : ''), f.toUpperCase());
      b.addEventListener('click', () => {
        this.finish = f;
        this.showroom.previewPaint(this.paint, this.finish);
        fin.querySelectorAll('.sr-chip').forEach((x) => x.classList.toggle('on', x === b));
      });
      fin.append(b);
    }
    box.append(row, fin);
  }
}
