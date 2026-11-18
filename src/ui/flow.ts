import { CARS, CAR_ORDER, DRIFT_VENUES, TRACKS, carName, carTagline, trackName } from '../data';
import { formatYen, xpForLevel, MEDAL_LABEL, type Medal } from '../core/progression';
import type { SaveData } from '../core/save';
import type { EventKind, ModeId, SessionConfig, SessionResult } from '../modes/types';
import { bestRecord } from '../modes/rewards';
import { fmtTime } from '../modes/driftEvent';
import { peakPower } from '../physics/drivetrain';
import { Track } from '../world/track';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export interface FlowCallbacks {
  start(cfg: SessionConfig): void;
  openSettings(): void;
  openGarage(): void;
  openDealer(): void;
  openRecords(): void;
  openHowTo(): void;
  retry(): void;
  click(): void;
  selectCar(uid: string): void;
}

const MODE_CARDS: { id: ModeId; title: string; jp: string; line: string; art: string }[] = [
  { id: 'openroad', title: 'OPEN ROAD', jp: 'オープンロード', line: 'Free drifting on a 9 km loop with traffic. Earn money as you go. No time limit.', art: 'mode-openroad.jpg' },
  { id: 'drift', title: 'DRIFT TRACK', jp: 'ドリフトコース', line: 'Judged drift events and time attacks on closed courses. Medals, records, bigger payouts.', art: 'mode-drift.jpg' },
  { id: 'practice', title: 'PRACTICE', jp: '練習', line: 'The skidpad. No money, no pressure, just you and the throttle.', art: 'mode-practice.jpg' },
];

const EVENT_INFO: Record<Exclude<EventKind, 'free'>, { title: string; jp: string; line: string }> = {
  driftattack: { title: 'DRIFT ATTACK', jp: 'ドリフトアタック', line: 'One lap, score as much as you can. Hit the glowing clipping points.' },
  timeattack: { title: 'TIME ATTACK', jp: 'タイムアタック', line: 'Three laps against the clock and your own ghost. Sector splits and delta.' },
  tandem: { title: 'TANDEM CHASE', jp: 'ツイン走行', line: 'Follow the lead car. Judged on proximity and how well your angle matches.' },
};

const BASE = import.meta.env.BASE_URL ?? './';

/** Main menu, mode select, car select, event select and results. */
export class Flow {
  private screens: Record<string, HTMLElement> = {};
  private pending: Partial<SessionConfig> = {};
  private chipEls: HTMLElement[] = [];
  private results!: HTMLElement;
  lastResult: SessionResult | null = null;

  constructor(
    private parent: HTMLElement,
    private save: () => SaveData,
    private cb: FlowCallbacks,
  ) {
    this.buildMain();
    this.buildModes();
    this.screen('cars');
    this.screen('events');
    this.results = this.screen('results');
  }

  private screen(id: string): HTMLElement {
    const s = el('div', 'screen flow');
    s.id = id;
    s.append(el('div', 'speedlines'));
    const chip = el('div', 'profile-chip');
    this.chipEls.push(chip);
    s.append(chip);
    this.parent.appendChild(s);
    this.screens[id] = s;
    return s;
  }

  refreshChips(): void {
    const sv = this.save();
    const need = xpForLevel(sv.profile.level);
    const html = `<span class="lv">LV ${sv.profile.level}<i style="width:${Math.min(100, (sv.profile.xp / need) * 100)}%"></i></span><b>${formatYen(sv.profile.credits)}</b><span class="sp">${sv.profile.sp} SP</span>`;
    for (const c of this.chipEls) c.innerHTML = html;
  }

  owns(id: string | null): boolean {
    return !!id && id in this.screens;
  }

  show(id: string | null): void {
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('on', k === id);
    if (id === 'cars') this.renderCars();
    if (id === 'events') this.renderEvents();
    this.refreshChips();
    const first = id ? this.screens[id]?.querySelector<HTMLElement>('.mbtn, .card, .sbtn') : null;
    first?.focus({ preventScroll: true });
  }

  get visible(): string | null {
    for (const [k, s] of Object.entries(this.screens)) if (s.classList.contains('on')) return k;
    return null;
  }

  private btn(label: string, sub: string, fn: () => void, cls = 'mbtn'): HTMLButtonElement {
    const b = el('button', cls, `${label}${sub ? `<small>${sub}</small>` : ''}`);
    b.addEventListener('click', () => {
      this.cb.click();
      fn();
    });
    return b;
  }

  private title(s: HTMLElement, chip: string, h: string, kana: string): void {
    const t = el('div', 'panel-title');
    t.append(el('span', 'chip', chip), el('h2', '', h), el('div', 'kana', kana));
    s.append(t);
  }

  private back(s: HTMLElement, to: string): void {
    const b = el('div', 'back');
    b.append(this.btn('BACK', '戻る', () => this.show(to)));
    s.append(b);
  }

  // ---------------------------------------------------------------- main
  private buildMain(): void {
    const s = this.screen('main');
    const logo = el('div', 'logo small');
    logo.append(el('div', 'kanji', '風'), el('h1', '', 'KAZE <span>DRIFT</span>'));
    s.append(logo);
    const menu = el('div', 'menu');
    menu.append(
      this.btn('PLAY', 'プレイ', () => this.show('modes')),
      this.btn('GARAGE', 'ガレージ', () => this.cb.openGarage()),
      this.btn('DEALER', 'ディーラー', () => this.cb.openDealer()),
      this.btn('RECORDS', '記録', () => this.cb.openRecords()),
      this.btn('SETTINGS', '設定', () => this.cb.openSettings()),
      this.btn('HOW TO DRIFT', '操作', () => this.cb.openHowTo()),
    );
    s.append(menu);
  }

  // ---------------------------------------------------------------- modes
  private buildModes(): void {
    const s = this.screen('modes');
    this.title(s, 'PLAY', 'Choose a mode', 'モードセレクト');
    const cards = el('div', 'cards modes');
    for (const m of MODE_CARDS) {
      const card = el('button', 'card mode');
      const art = el('div', 'art');
      art.style.backgroundImage = `url(${BASE}assets/ui/${m.art})`;
      art.append(el('span', 'artkana', m.jp));
      const body = el('div', 'body');
      body.append(el('h3', '', m.title), el('p', '', m.line));
      card.append(art, body);
      card.addEventListener('click', () => {
        this.cb.click();
        this.pending = { mode: m.id };
        this.show('cars');
      });
      cards.append(card);
    }
    s.append(cards);
    this.back(s, 'main');
  }

  // ---------------------------------------------------------------- cars
  private renderCars(): void {
    const s = this.screens.cars;
    s.querySelectorAll('.panel-title, .cars, .back').forEach((e) => e.remove());
    this.title(s, 'CAR SELECT', 'Choose your car', '車両選択');
    const sv = this.save();
    const list = el('div', 'cards cars');
    for (const owned of sv.garage.cars) {
      const def = CARS[owned.carId];
      if (!def) continue;
      const hp = Math.round(peakPower(def.physics.engine).hp);
      const card = el('button', 'card carcard' + (owned.uid === sv.garage.selected ? ' sel' : ''));
      const sw = el('div', 'swatch');
      sw.style.background = owned.paint.body;
      card.append(sw);
      const body = el('div', 'body');
      body.append(el('h3', '', carName(owned.carId)), el('div', 'jp', def.archetype.toUpperCase()), el('p', '', `${hp} hp · ${def.physics.mass} kg · ${def.physics.layout} · ${Object.keys(owned.parts).length} parts`), el('p', 'tag', carTagline(owned.carId)));
      card.append(body);
      card.addEventListener('click', () => {
        this.cb.click();
        this.cb.selectCar(owned.uid);
        if (this.pending.mode === 'openroad') this.cb.start({ mode: 'openroad', location: 'openroad', event: 'free' });
        else if (this.pending.mode === 'practice') this.cb.start({ mode: 'practice', location: 'skidpad', event: 'free' });
        else this.show('events');
      });
      list.append(card);
    }
    s.append(list);
    this.back(s, 'modes');
  }

  // ---------------------------------------------------------------- events
  private renderEvents(): void {
    const s = this.screens.events;
    s.querySelectorAll('.panel-title, .venues, .back').forEach((e) => e.remove());
    this.title(s, 'DRIFT TRACK', 'Choose an event', 'イベント');
    const sv = this.save();
    const wrap = el('div', 'venues');
    for (const id of DRIFT_VENUES) {
      const n = trackName(id);
      const t = previewTrack(id);
      const road = t.roads[0];
      const ys = road.samples.map((p) => p.y);
      const card = el('div', 'venue');
      const cv = el('canvas');
      cv.width = 360;
      cv.height = 220;
      drawMap(cv, t);
      const info = el('div', 'vinfo');
      info.append(el('h3', '', n.name), el('div', 'jp', `${n.jp} · ${(road.length / 1000).toFixed(2)} km · ${(Math.max(...ys) - Math.min(...ys)).toFixed(0)} m elevation`));
      const evs = el('div', 'evs');
      for (const ev of ['driftattack', 'timeattack', 'tandem'] as const) {
        const key = `${id}|${ev}`;
        const best = bestRecord(sv, key);
        const medal = sv.records.medals[key] as Medal | undefined;
        const b = el('button', 'evbtn');
        b.innerHTML = `<b>${EVENT_INFO[ev].title}</b><span>${EVENT_INFO[ev].line}</span><em>${best ? (ev === 'timeattack' ? 'BEST ' + fmtTime(best.score / 1000) : 'BEST ' + best.score.toLocaleString('en-US')) : 'NO RECORD'}${medal ? ` · <i class="m-${medal}">${MEDAL_LABEL[medal]}</i>` : ''}</em>`;
        b.addEventListener('click', () => {
          this.cb.click();
          this.cb.start({ mode: 'drift', location: id, event: ev });
        });
        evs.append(b);
      }
      info.append(evs);
      card.append(cv, info);
      wrap.append(card);
    }
    s.append(wrap);
    this.back(s, 'cars');
  }

  // ---------------------------------------------------------------- results
  showResults(r: SessionResult): void {
    this.lastResult = r;
    const s = this.results;
    s.querySelectorAll('.res').forEach((e) => e.remove());
    const box = el('div', 'res');
    const head = el('div', 'res-head');
    head.append(el('span', 'chip', r.subtitle.toUpperCase()), el('h2', '', r.title));
    if (r.verdict) head.append(el('div', 'verdict', r.verdict));
    box.append(head);
    if (r.newRecord) box.append(el('div', 'newrec', 'NEW RECORD · 新記録'));
    const score = el('div', 'res-score');
    score.append(el('span', '', r.scoreLabel), el('b', '', r.scoreLabel === 'BEST LAP' ? fmtTime(r.score / 1000) : r.score.toLocaleString('en-US')));
    if (r.medal) score.append(el('i', `medal m-${r.medal}`, MEDAL_LABEL[r.medal]));
    box.append(score);
    const table = el('div', 'res-lines');
    for (const l of r.lines) table.append(el('div', 'rl' + (l.emphasis ? ' em' : ''), `<span>${l.label}</span><b>${l.value}</b>`));
    box.append(table);
    const pay = el('div', 'res-pay');
    pay.append(el('div', '', `<span>MONEY</span><b>+${formatYen(r.money)}</b>`), el('div', '', `<span>XP</span><b>+${r.xp.toLocaleString('en-US')}</b>`), el('div', '', `<span>SKILL POINTS</span><b>+${r.sp}</b>`));
    box.append(pay);
    for (const up of r.levelUps) box.append(el('div', 'levelup' + (up.milestone ? ' big' : ''), `LEVEL ${up.level}${up.milestone ? ' · MILESTONE' : ''} · +${formatYen(up.yen)} · +${up.sp} SP`));
    const actions = el('div', 'res-actions');
    actions.append(this.btn('RETRY', 'R', () => this.cb.retry(), 'sbtn primary'), this.btn('GARAGE', '', () => this.cb.openGarage(), 'sbtn'), this.btn('CONTINUE', '', () => this.show('main'), 'sbtn'));
    box.append(actions);
    s.append(box);
    this.show('results');
  }
}

const previewCache = new Map<string, Track>();
function previewTrack(id: string): Track {
  let t = previewCache.get(id);
  if (!t) previewCache.set(id, (t = new Track(TRACKS[id])));
  return t;
}

function drawMap(cv: HTMLCanvasElement, t: Track): void {
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0d1a2b';
  g.fillRect(0, 0, cv.width, cv.height);
  const road = t.roads[0];
  const xs = road.samples.map((p) => p.x), zs = road.samples.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const sc = Math.min((cv.width - 40) / (maxX - minX), (cv.height - 40) / (maxZ - minZ));
  const ox = (cv.width - (maxX - minX) * sc) / 2, oz = (cv.height - (maxZ - minZ) * sc) / 2;
  for (const [w, c] of [[10, '#e8202f'], [4, '#f2efe6']] as const) {
    g.strokeStyle = c;
    g.lineWidth = w;
    g.lineJoin = 'round';
    g.beginPath();
    road.samples.forEach((p, i) => (i ? g.lineTo(ox + (p.x - minX) * sc, oz + (p.z - minZ) * sc) : g.moveTo(ox + (p.x - minX) * sc, oz + (p.z - minZ) * sc)));
    g.closePath();
    g.stroke();
  }
  const p0 = road.samples[0];
  g.fillStyle = '#f39c32';
  g.fillRect(ox + (p0.x - minX) * sc - 5, oz + (p0.z - minZ) * sc - 5, 10, 10);
}

export { CAR_ORDER };
