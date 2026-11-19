import { carName, carPhysics } from '../data';
import { formatYen } from '../core/progression';
import type { OwnedCar, SaveData } from '../core/save';
import { measure } from '../physics/performance';
import type { CarPhysicsSpec } from '../physics/types';
import { applyBuild, availableOptions, CATEGORIES, optionOf, SLOT_BY_ID, SLOTS, TIER_NAMES, TUNES, tuneDefault, tuneUnlocked, type Build, type CategoryId, type PartOption } from '../garage/parts';
import { classOf, rate, type CarRating, type ClassId, type StatBars } from '../garage/rating';
import { applyQuickPlan, conversionLosses, exportBuildCode, installedCount, installPart, inventory, loadPreset, parseBuildCode, partPrice, quickUpgrade, renamePreset, savePreset, type QuickStyle } from '../garage/build';
import { mechanicalBalance } from '../garage/balance';
import './showroom.css';
import './upgrade.css';

// Update 4 §3.3: Upgrades & Tuning. Home tiles → category slots → tier cards (hover = live
// preview with ghost stat bars and the rating ticking) → Buy & Install confirmation.

export interface UpgradeCallbacks {
  click(): void;
  toast(msg: string): void;
  changed(): void;
  /** live preview of a build on the 3D car (Section 4 shows the part itself) */
  preview(o: OwnedCar, build: Build | null, slot?: string): void;
  /** play the install animation, resolve when done */
  install(o: OwnedCar, slot: string): Promise<void>;
  paint(o: OwnedCar): void;
  close(): void;
}

const BARS: [keyof StatBars, string][] = [['speed', 'SPEED'], ['handling', 'HANDLING'], ['acceleration', 'ACCEL'], ['launch', 'LAUNCH'], ['braking', 'BRAKING'], ['drift', 'DRIFT']];
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class UpgradeShop {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private footer: HTMLElement;
  private header: HTMLElement;
  private car!: OwnedCar;
  private base!: CarPhysicsSpec;
  private view: { kind: 'home' } | { kind: 'cat'; cat: CategoryId; slot?: string } | { kind: 'tune' } | { kind: 'quick' } | { kind: 'presets' } = { kind: 'home' };
  open = false;

  constructor(
    parent: HTMLElement,
    private save: () => SaveData,
    private cb: UpgradeCallbacks,
  ) {
    this.root = el('div', 'screen upgrades');
    this.root.id = 'upgrades';
    this.header = el('div', 'up-header');
    this.body = el('div', 'up-body');
    this.footer = el('div', 'up-footer');
    this.root.append(this.header, this.body, this.footer);
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (!this.open || e.code !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.back();
    }, true);
  }

  show(o: OwnedCar): void {
    this.car = o;
    this.base = carPhysics(o.carId);
    this.open = true;
    this.root.classList.add('on');
    this.view = { kind: 'home' };
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('on');
  }

  private back(): void {
    this.cb.click();
    this.cb.preview(this.car, null);
    if (this.view.kind === 'cat' && this.view.slot) this.view = { kind: 'cat', cat: this.view.cat };
    else if (this.view.kind !== 'home') this.view = { kind: 'home' };
    else return this.cb.close();
    this.render();
  }

  private spec(build: Build = this.car.parts, tune = this.car.tune): CarPhysicsSpec {
    return applyBuild(this.base, build, tune);
  }

  private render(): void {
    const sv = this.save();
    const r = rate(this.spec());
    this.header.innerHTML = '';
    const back = el('button', 'sr-close', '‹ <span>BACK</span>');
    back.addEventListener('click', () => this.back());
    const title = el('div', 'sr-title', `<b>UPGRADES &amp; TUNING</b><span>${carName(this.car.carId).toUpperCase()} · アップグレード</span>`);
    const right = el('div', 'up-hright', `<div class="sr-class" style="--c:${r.color}"><b>${r.cls}</b><span class="up-rating">${r.rating}</span></div><b class="up-money">${formatYen(sv.profile.credits)}</b>`);
    this.header.append(back, title, right);
    this.renderFooter(r, null);
    this.body.innerHTML = '';
    if (this.view.kind === 'home') this.renderHome();
    else if (this.view.kind === 'cat') this.renderCategory(this.view.cat, this.view.slot);
    else if (this.view.kind === 'tune') this.renderTune();
    else if (this.view.kind === 'quick') this.renderQuick();
    else this.renderPresets();
  }

  /** bottom strip: stat bars with ghost before→after segments, key specs */
  private renderFooter(now: CarRating, next: CarRating | null, t100?: [number, number | null]): void {
    const f = this.footer;
    f.innerHTML = '';
    const bars = el('div', 'up-bars');
    for (const [k, n] of BARS) {
      const a = now.bars[k], b = next ? next.bars[k] : a;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      bars.append(el('div', 'sr-bar', `<span>${n}</span><i><b style="width:${lo * 10}%"></b>${hi > lo ? `<b class="${b > a ? 'gain' : 'loss'}" style="left:${lo * 10}%;width:${(hi - lo) * 10}%"></b>` : ''}</i><em>${b.toFixed(1)}</em>`));
    }
    const d = (x: number, y: number, unit: string, digits = 0) => (Math.abs(y - x) > 0.01 ? ` <i class="${y > x ? 'up' : 'down'}">→ ${y.toFixed(digits)}${unit}</i>` : '');
    const specs = el('div', 'up-specs');
    const n = next ?? now;
    specs.innerHTML = `<div><span>POWER</span><b>${Math.round(now.hp)} hp${d(now.hp, n.hp, ' hp')}</b></div>
      <div><span>WEIGHT</span><b>${Math.round(now.mass)} kg${d(now.mass, n.mass, ' kg')}</b></div>
      <div><span>PWR/WT</span><b>${Math.round(now.pwr)}${d(now.pwr, n.pwr, '')} hp/t</b></div>
      <div><span>0–100</span><b class="up-t100">${t100 ? `${t100[0].toFixed(2)} s${t100[1] !== null ? d(t100[0], t100[1], ' s', 2) : ''}` : '…'}</b></div>
      <div><span>RATING</span><b>${now.cls} ${now.rating}${next && next.rating !== now.rating ? ` <i class="${next.rating > now.rating ? 'up' : 'down'}" style="color:${next.color}">→ ${next.cls} ${next.rating}</i>` : ''}</b></div>`;
    f.append(bars, specs);
    if (!t100) {
      const spec = this.spec();
      setTimeout(() => {
        const t = f.querySelector('.up-t100');
        if (t && !next) t.textContent = `${measure(spec).zeroTo100.toFixed(2)} s`;
      }, 30);
    }
  }

  private renderHome(): void {
    const grid = el('div', 'up-tiles');
    const tile = (name: string, jp: string, count: string, fn: () => void, cls = '') => {
      const t = el('button', 'up-tile ' + cls, `<b>${name}</b><span>${jp}</span><em>${count}</em>`);
      t.addEventListener('click', () => {
        this.cb.click();
        fn();
      });
      grid.append(t);
    };
    for (const c of CATEGORIES) {
      const total = SLOTS.filter((s) => s.category === c.id).length;
      tile(c.name.toUpperCase(), c.jp, `${installedCount(this.car, c.id)} / ${total} installed`, () => {
        this.view = { kind: 'cat', cat: c.id };
        this.render();
      }, 'cat-' + c.id);
    }
    const unlocked = TUNES.filter((t) => tuneUnlocked(t, this.car.parts)).length;
    tile('TUNING', 'チューニング', `${unlocked} / ${TUNES.length} settings unlocked`, () => {
      this.view = { kind: 'tune' };
      this.render();
    }, 'tune');
    tile('PAINT & LIVERY', 'ペイント', 'Colour, finish', () => this.cb.paint(this.car), 'paint');
    tile('QUICK UPGRADE', 'おまかせ', 'Pick a class or style', () => {
      this.view = { kind: 'quick' };
      this.render();
    }, 'quick');
    tile('BUILD PRESETS', 'プリセット', `${this.car.presets?.length ?? 0} saved · build codes`, () => {
      this.view = { kind: 'presets' };
      this.render();
    }, 'presets');
    this.body.append(grid);
  }

  private renderCategory(cat: CategoryId, slotId?: string): void {
    const wrap = el('div', 'up-cat');
    const list = el('div', 'up-slots');
    const catDef = CATEGORIES.find((c) => c.id === cat)!;
    list.append(el('div', 'up-sub', `${catDef.name.toUpperCase()} · ${catDef.jp}${cat === 'conversion' ? '<br><small>Conversions first: they reset some engine and drivetrain parts.</small>' : ''}`));
    for (const sd of SLOTS.filter((s) => s.category === cat)) {
      const cur = optionOf(sd.id, this.car.parts[sd.id]);
      const b = el('button', 'up-slot' + (sd.id === slotId ? ' on' : ''), `<b>${sd.name}</b><span class="tier t-${cur.tier}">${cur.id === 'stock' ? 'STOCK' : TIER_NAMES[cur.tier].toUpperCase()}</span><em>${cur.id === 'stock' ? '' : cur.name}</em>`);
      b.addEventListener('click', () => {
        this.cb.click();
        this.view = { kind: 'cat', cat, slot: sd.id };
        this.render();
      });
      list.append(b);
    }
    wrap.append(list);
    if (slotId) wrap.append(this.tierCards(slotId));
    this.body.append(wrap);
    if (slotId) this.cb.preview(this.car, this.car.parts, slotId);
  }

  private tierCards(slotId: string): HTMLElement {
    const sv = this.save();
    const sd = SLOT_BY_ID[slotId];
    const box = el('div', 'up-cards');
    const now = rate(this.spec());
    const opts = availableOptions(this.base, this.car.parts, slotId);
    const inv = inventory(this.car);
    for (const opt of opts) {
      const installed = (this.car.parts[slotId] ?? 'stock') === opt.id;
      const locked = sv.profile.level < opt.level;
      const price = partPrice(this.car, slotId, opt, sv.perks.discount ? 0.1 * sv.perks.discount : 0);
      const build = { ...this.car.parts, [slotId]: opt.id };
      const next = rate(this.spec(build));
      const delta = next.rating - now.rating;
      const card = el('button', `up-card t-${opt.tier}` + (installed ? ' installed' : '') + (locked ? ' locked' : ''));
      card.innerHTML = `<div class="up-ctier">${opt.id === 'stock' ? 'STOCK' : TIER_NAMES[opt.tier].toUpperCase()}</div>
        <b>${opt.name}</b><span class="up-brand">${opt.brand}</span>
        <p>${opt.desc}</p>
        <div class="up-cfoot">${installed ? '<em class="inst">INSTALLED</em>' : locked ? `<em class="lock">LEVEL ${opt.level}</em>` : `<em>${price === 0 ? (inv.has(`${slotId}.${opt.id}`) ? 'OWNED · FREE' : 'FREE') : formatYen(price)}</em>`}
        <i class="${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta === 0 ? '±0' : (delta > 0 ? '+' : '') + delta} PI${next.cls !== now.cls ? ` · <span style="color:${next.color}">${next.cls}</span>` : ''}</i></div>`;
      const hover = () => {
        this.renderFooter(now, next, undefined);
        this.cb.preview(this.car, build, slotId);
        this.header.querySelector('.up-rating')!.textContent = String(next.rating);
        (this.header.querySelector('.sr-class') as HTMLElement).style.setProperty('--c', next.color);
        (this.header.querySelector('.sr-class b') as HTMLElement).textContent = next.cls;
      };
      const unhover = () => {
        this.renderFooter(now, null);
        this.cb.preview(this.car, this.car.parts, slotId);
        this.header.querySelector('.up-rating')!.textContent = String(now.rating);
        (this.header.querySelector('.sr-class') as HTMLElement).style.setProperty('--c', now.color);
        (this.header.querySelector('.sr-class b') as HTMLElement).textContent = now.cls;
      };
      card.addEventListener('pointerenter', hover);
      card.addEventListener('focus', hover);
      card.addEventListener('pointerleave', unhover);
      card.addEventListener('blur', unhover);
      card.addEventListener('click', () => {
        this.cb.click();
        if (installed || locked) return;
        this.confirm(slotId, opt, price);
      });
      box.append(card);
    }
    void sd;
    return box;
  }

  private confirm(slotId: string, opt: PartOption, price: number): void {
    const sv = this.save();
    const before = this.spec();
    const build = { ...this.car.parts, [slotId]: opt.id };
    for (const r of conversionLosses(this.car, slotId, opt.id)) delete build[r];
    const after = this.spec(build);
    const a = rate(before), b = rate(after);
    const ma = measure(before), mb = measure(after);
    const losses = conversionLosses(this.car, slotId, opt.id);
    const modal = el('div', 'up-modal');
    const box = el('div', 'up-confirm');
    const ch = (x: number, y: number, unit: string, dg = 0, lowerBetter = false) => `${x.toFixed(dg)} → <b class="${(y > x) !== lowerBetter ? 'up' : y === x ? '' : 'down'}">${y.toFixed(dg)}</b>${unit}`;
    box.innerHTML = `<div class="sr-title"><b>${opt.id === 'stock' ? 'REMOVE PART' : 'BUY &amp; INSTALL'}</b><span>${SLOT_BY_ID[slotId].name.toUpperCase()}</span></div>
      <h3>${opt.name}</h3><p>${opt.desc}</p>
      ${losses.length ? `<p class="warn">⚠ This conversion removes: ${losses.map((l) => SLOT_BY_ID[l].name).join(', ')}.</p>` : ''}
      <div class="up-cgrid">
        <span>COST</span><b>${price ? formatYen(price) : 'FREE'}</b>
        <span>RATING</span><b><i style="color:${a.color}">${a.cls} ${a.rating}</i> → <i style="color:${b.color}">${b.cls} ${b.rating}</i></b>
        <span>POWER</span><b>${ch(a.hp, b.hp, ' hp')}</b>
        <span>PWR / WT</span><b>${ch(a.pwr, b.pwr, ' hp/t')}</b>
        <span>0–100</span><b>${ch(ma.zeroTo100, mb.zeroTo100, ' s', 2, true)}</b>
        <span>TOP SPEED</span><b>${ch(ma.topSpeed, mb.topSpeed, ' km/h')}</b>
      </div>
      <div class="up-bars mini">${BARS.map(([k, n]) => `<div class="sr-bar"><span>${n}</span><i><b style="width:${Math.min(a.bars[k], b.bars[k]) * 10}%"></b>${b.bars[k] !== a.bars[k] ? `<b class="${b.bars[k] > a.bars[k] ? 'gain' : 'loss'}" style="left:${Math.min(a.bars[k], b.bars[k]) * 10}%;width:${Math.abs(b.bars[k] - a.bars[k]) * 10}%"></b>` : ''}</i><em>${b.bars[k].toFixed(1)}</em></div>`).join('')}</div>`;
    const row = el('div', 'sr-actions row');
    const ok = el('button', 'sbtn primary', opt.id === 'stock' ? 'REMOVE' : 'INSTALL');
    ok.disabled = sv.profile.credits < price;
    const cancel = el('button', 'sbtn', 'CANCEL');
    row.append(ok, cancel);
    box.append(row);
    modal.append(box);
    this.root.append(modal);
    ok.focus();
    cancel.addEventListener('click', () => {
      this.cb.click();
      modal.remove();
    });
    ok.addEventListener('click', async () => {
      const res = installPart(sv, this.car, slotId, opt.id, sv.perks.discount ? 0.1 * sv.perks.discount : 0);
      modal.remove();
      if (!res.ok) return this.cb.toast(res.msg);
      this.cb.changed();
      await this.cb.install(this.car, slotId);
      this.cb.toast(res.msg.toUpperCase());
      this.render();
    });
  }

  // ---------------------------------------------------------------- tuning
  private renderTune(): void {
    const wrap = el('div', 'up-tune');
    const spec0 = applyBuild(this.base, this.car.parts);
    const meter = el('div', 'up-balance');
    const drawMeter = () => {
      const m = mechanicalBalance(this.spec());
      const label = m < 0.53 ? 'UNDERSTEER' : m > 0.62 ? 'LOOSE REAR' : 'BALANCED';
      meter.innerHTML = `<span>MECHANICAL BALANCE</span><div class="bal"><i class="zone"></i><b style="left:${Math.min(100, Math.max(0, ((m - 0.4) / 0.35) * 100))}%"></b></div><em>${m.toFixed(2)} · ${label}</em>`;
      this.renderFooter(rate(this.spec()), null);
    };
    wrap.append(meter);
    let group = '';
    for (const def of TUNES) {
      if (def.group !== group) {
        group = def.group;
        wrap.append(el('div', 'up-sub', group.toUpperCase()));
      }
      const unlocked = tuneUnlocked(def, this.car.parts);
      const val = this.car.tune[def.key] ?? tuneDefault(def, spec0);
      const row = el('label', 'up-slider' + (unlocked ? '' : ' locked'));
      const input = el('input');
      input.type = 'range';
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      input.value = String(val < def.min ? tuneDefault(def, spec0) : val);
      input.disabled = !unlocked;
      const out = el('em', '', unlocked ? `${(+input.value).toFixed(2)}${def.unit}` : def.needsLabel);
      input.addEventListener('input', () => {
        this.car.tune[def.key] = +input.value;
        out.textContent = `${(+input.value).toFixed(2)}${def.unit}`;
        drawMeter();
      });
      input.addEventListener('change', () => this.cb.changed());
      row.append(el('span', '', def.label), input, out);
      wrap.append(row);
    }
    const reset = el('button', 'sbtn', 'RESET TUNE');
    reset.addEventListener('click', () => {
      this.car.tune = {};
      this.cb.changed();
      this.render();
    });
    wrap.append(reset);
    this.body.append(wrap);
    drawMeter();
  }

  // ---------------------------------------------------------------- quick upgrade
  private renderQuick(): void {
    const sv = this.save();
    const wrap = el('div', 'up-quick');
    wrap.append(el('div', 'up-sub', 'QUICK UPGRADE · pick a target and the shop plans the best affordable build'));
    const now = rate(this.spec());
    const opts = el('div', 'up-qopts');
    const planBox = el('div', 'up-plan');
    const show = (label: string, o: { cls?: ClassId; style?: QuickStyle }) => {
      const plan = quickUpgrade(sv, this.car, o);
      planBox.innerHTML = `<h3>${label}</h3>` + (plan.steps.length
        ? `<ol>${plan.steps.map((s) => `<li><b>${s.opt.name}</b><span>${SLOT_BY_ID[s.slot].name}</span><em>${s.cost ? formatYen(s.cost) : 'OWNED'}</em></li>`).join('')}</ol>
           <div class="up-cgrid"><span>TOTAL</span><b>${formatYen(plan.total)}</b><span>RESULT</span><b><i style="color:${now.color}">${now.cls} ${now.rating}</i> → <i style="color:${classOf(plan.rating).color}">${plan.cls} ${plan.rating}</i></b></div>`
        : '<p>Nothing affordable moves the car toward that target right now.</p>');
      if (!plan.steps.length) return;
      const go = el('button', 'sbtn primary', `CONFIRM · ${formatYen(plan.total)}`);
      go.addEventListener('click', async () => {
        const err = applyQuickPlan(sv, this.car, plan);
        if (err) return this.cb.toast(err);
        this.cb.changed();
        await this.cb.install(this.car, plan.steps[plan.steps.length - 1].slot);
        this.cb.toast(`QUICK UPGRADE · ${plan.cls} ${plan.rating}`);
        this.view = { kind: 'home' };
        this.render();
      });
      planBox.append(go);
    };
    const nowIdx = ['D', 'C', 'B', 'A', 'S1', 'S2', 'R'].indexOf(now.cls);
    for (const c of ['C', 'B', 'A', 'S1', 'S2', 'R'] as ClassId[]) {
      if (['D', 'C', 'B', 'A', 'S1', 'S2', 'R'].indexOf(c) < nowIdx) continue;
      const b = el('button', 'sr-chip', `MAKE IT ${c}-CLASS`);
      b.addEventListener('click', () => show(`Make it ${c}-class`, { cls: c }));
      opts.append(b);
    }
    for (const st of ['drift', 'grip', 'balanced'] as QuickStyle[]) {
      const b = el('button', 'sr-chip', `${st.toUpperCase()} BUILD`);
      b.addEventListener('click', () => show(`${st[0].toUpperCase() + st.slice(1)} build (within budget)`, { style: st }));
      opts.append(b);
    }
    wrap.append(opts, planBox);
    this.body.append(wrap);
  }

  // ---------------------------------------------------------------- presets
  private renderPresets(): void {
    const sv = this.save();
    const wrap = el('div', 'up-presets');
    wrap.append(el('div', 'up-sub', 'BUILD PRESETS · save, load and share builds for this car'));
    const list = el('div', 'up-plist');
    for (const p of this.car.presets ?? []) {
      const row = el('div', 'up-prow');
      const name = el('input', 'up-pname');
      name.value = p.name;
      name.addEventListener('change', () => {
        renamePreset(this.car, p.name, name.value.slice(0, 24) || p.name);
        this.cb.changed();
      });
      const load = el('button', 'sbtn', 'LOAD');
      load.addEventListener('click', async () => {
        const r = loadPreset(sv, this.car, p);
        if (r.msg) return this.cb.toast(r.msg);
        this.cb.changed();
        await this.cb.install(this.car, 'engineSwap');
        this.cb.toast(`${p.name.toUpperCase()} LOADED${r.cost ? ' · ' + formatYen(r.cost) : ''}`);
        this.render();
      });
      row.append(name, el('span', '', `${Object.keys(p.parts).length} parts · ${rate(applyBuild(this.base, p.parts, p.tune)).cls} ${rate(applyBuild(this.base, p.parts, p.tune)).rating}`), load);
      list.append(row);
    }
    const saveBtn = el('button', 'sbtn primary', 'SAVE CURRENT BUILD');
    saveBtn.addEventListener('click', () => {
      savePreset(this.car, `Build ${(this.car.presets?.length ?? 0) + 1}`);
      this.cb.changed();
      this.render();
    });
    const code = el('div', 'up-code');
    const out = el('input', 'up-codebox');
    out.readOnly = true;
    out.value = exportBuildCode(this.car);
    const copy = el('button', 'sbtn', 'COPY CODE');
    copy.addEventListener('click', () => {
      out.select();
      void navigator.clipboard?.writeText(out.value);
      this.cb.toast('BUILD CODE COPIED');
    });
    const inp = el('input', 'up-codebox');
    inp.placeholder = 'Paste a KZ1- build code';
    const imp = el('button', 'sbtn', 'IMPORT');
    imp.addEventListener('click', async () => {
      const d = parseBuildCode(inp.value);
      if (!d) return this.cb.toast('THAT CODE DOES NOT LOOK RIGHT');
      if (d.carId !== this.car.carId) return this.cb.toast(`THAT BUILD IS FOR THE ${carName(d.carId).toUpperCase()}`);
      const r = loadPreset(sv, this.car, { parts: d.parts, tune: d.tune });
      if (r.msg) return this.cb.toast(r.msg);
      this.cb.changed();
      await this.cb.install(this.car, 'engineSwap');
      this.cb.toast('BUILD IMPORTED');
      this.render();
    });
    code.append(el('span', 'sr-lbl', 'EXPORT'), out, copy, el('span', 'sr-lbl', 'IMPORT'), inp, imp);
    wrap.append(list, saveBtn, code);
    this.body.append(wrap);
  }
}
