import type { ChainEvent, SkillChain } from '../scoring/skillChain';

const TIER_COLORS = ['#f2efe6', '#f39c32', '#f6a5c0', '#e8202f', '#7cf3ff'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Skill-chain HUD: chain value, multiplier tier, banking ring, popups and the CHAIN BROKEN flash. */
export class ChainHud {
  readonly root: HTMLElement;
  private value: HTMLElement;
  private mult: HTMLElement;
  private ring: SVGCircleElement;
  private live: HTMLElement;
  private pops: HTMLElement;
  private totalBox: HTMLElement;
  private totalVal: HTMLElement;
  private moneyVal: HTMLElement;
  private broken: HTMLElement;
  private shown = 0;
  private total = 0;
  private money = 0;
  private moneyShown = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'chain');
    const box = el('div', 'chain-box');
    const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ringSvg.setAttribute('viewBox', '0 0 44 44');
    ringSvg.classList.add('chain-ring');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bg.setAttribute('cx', '22');
    bg.setAttribute('cy', '22');
    bg.setAttribute('r', '18');
    bg.setAttribute('class', 'bg');
    this.ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.ring.setAttribute('cx', '22');
    this.ring.setAttribute('cy', '22');
    this.ring.setAttribute('r', '18');
    this.ring.setAttribute('class', 'fg');
    ringSvg.append(bg, this.ring);
    this.mult = el('div', 'chain-mult', '×1');
    const ringWrap = el('div', 'chain-ringwrap');
    ringWrap.append(ringSvg, this.mult);
    this.value = el('div', 'chain-val', '0');
    this.live = el('div', 'chain-live', '');
    const txt = el('div', 'chain-txt');
    txt.append(this.value, this.live);
    box.append(ringWrap, txt);
    this.pops = el('div', 'chain-pops');
    this.root.append(box, this.pops);
    this.totalBox = el('div', 'session');
    this.totalVal = el('b', '', '0');
    this.moneyVal = el('b', 'yen', '¥0');
    this.totalBox.append(el('span', '', 'SKILL'), this.totalVal, el('span', '', 'EARNED'), this.moneyVal);
    this.broken = el('div', 'chain-broken', '<b>CHAIN BROKEN</b><span></span>');
    parent.append(this.root, this.totalBox, this.broken);
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
    this.totalBox.style.display = on ? '' : 'none';
  }

  reset(): void {
    this.total = 0;
    this.money = 0;
    this.moneyShown = 0;
    this.shown = 0;
    this.pops.innerHTML = '';
  }

  setMoney(yen: number): void {
    this.money = yen;
  }

  handle(e: ChainEvent): void {
    if (e.type === 'skill') {
      const p = el('div', 'pop', `<b>${e.label}</b> +${(e.points ?? 0).toLocaleString('en-US')}`);
      this.pops.prepend(p);
      while (this.pops.children.length > 5) this.pops.lastElementChild?.remove();
      setTimeout(() => p.classList.add('fly'), 900);
      setTimeout(() => p.remove(), 1500);
    } else if (e.type === 'bank') {
      this.total = e.total ?? this.total;
      const p = el('div', 'pop bank', `BANKED +${(e.points ?? 0).toLocaleString('en-US')}`);
      this.pops.prepend(p);
      setTimeout(() => p.classList.add('fly'), 700);
      setTimeout(() => p.remove(), 1300);
      this.totalBox.classList.remove('bump');
      void this.totalBox.offsetWidth;
      this.totalBox.classList.add('bump');
    } else if (e.type === 'break') {
      this.broken.querySelector('span')!.textContent = `${e.reason} · −${(e.points ?? 0).toLocaleString('en-US')}`;
      this.broken.classList.remove('on');
      void this.broken.offsetWidth;
      this.broken.classList.add('on');
    } else if (e.type === 'tier') {
      this.mult.classList.remove('pulse');
      void this.mult.offsetWidth;
      this.mult.classList.add('pulse');
    }
  }

  update(c: SkillChain, dt: number): void {
    const v = c.value;
    this.shown += (v - this.shown) * Math.min(1, dt * 12);
    this.root.classList.toggle('on', c.active || c.driftPoints > 0);
    this.value.textContent = Math.round(this.shown).toLocaleString('en-US');
    this.mult.textContent = `×${c.multiplier.toFixed(1)}`;
    const col = TIER_COLORS[c.tier];
    this.mult.style.color = col;
    this.ring.style.stroke = col;
    const drifting = c.driftPoints > 0;
    const f = drifting ? 1 : Math.max(0, c.bankTimer / c.cfg.bankTime);
    const C = 2 * Math.PI * 18;
    this.ring.style.strokeDasharray = `${C}`;
    this.ring.style.strokeDashoffset = `${C * (1 - f)}`;
    this.live.textContent = drifting ? `DRIFT ${Math.round(c.driftPoints).toLocaleString('en-US')}` : c.active ? 'BANKING…' : '';
    this.totalVal.textContent = Math.round(this.total).toLocaleString('en-US');
    this.moneyShown += (this.money - this.moneyShown) * Math.min(1, dt * 6);
    this.moneyVal.textContent = '¥' + Math.round(this.moneyShown).toLocaleString('en-US');
  }
}
