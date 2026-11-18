import { CARS, CAR_ORDER, carName, carTagline } from '../data';
import { ECONOMY, formatYen } from '../core/progression';
import type { OwnedCar, SaveData } from '../core/save';
import { peakPower } from '../physics/drivetrain';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export interface Perk {
  id: string;
  branch: 'style' | 'money' | 'mechanic';
  name: string;
  desc: string;
  ranks: number;
  requires?: string;
}

/** The skill tree: 15 ranks across three branches. Each rank costs 1 SP. */
export const PERKS: Perk[] = [
  { id: 'bank', branch: 'style', name: 'Patient Hands', desc: 'Bank timer +0.5 s per rank', ranks: 2 },
  { id: 'mult', branch: 'style', name: 'Chain Reaction', desc: 'Multiplier cap +1 per rank', ranks: 2, requires: 'bank' },
  { id: 'nearmiss', branch: 'style', name: 'Mirror Kisser', desc: 'Near-miss points +25%', ranks: 1, requires: 'mult' },
  { id: 'earn', branch: 'money', name: 'Sponsor Decals', desc: 'All earnings +5% per rank', ranks: 3 },
  { id: 'discount', branch: 'money', name: 'Trade Account', desc: 'Parts cost 10% less', ranks: 1, requires: 'earn' },
  { id: 'firstMedal', branch: 'money', name: 'Podium Habit', desc: 'First-time medal bonus +25%', ranks: 1, requires: 'discount' },
  { id: 'freePaint', branch: 'mechanic', name: 'Spray Booth', desc: 'Paint jobs are free', ranks: 1 },
  { id: 'freeTune', branch: 'mechanic', name: 'Setup Sheet', desc: 'Tune resets are free', ranks: 1, requires: 'freePaint' },
  { id: 'testDrive', branch: 'mechanic', name: 'Shakedown', desc: 'Test drives pay ¥500', ranks: 1, requires: 'freeTune' },
  { id: 'sellback', branch: 'mechanic', name: 'Haggler', desc: 'Sell cars for 70% instead of 60%', ranks: 1, requires: 'testDrive' },
  { id: 'quickShift', branch: 'mechanic', name: 'Flat Shift', desc: 'Gear changes 30% faster', ranks: 1, requires: 'sellback' },
];

export function sellValue(save: SaveData, car: OwnedCar): number {
  const r = ECONOMY.sellReturn + (save.perks.sellback ? 0.1 : 0);
  return Math.round(car.paid * r);
}

export function buyCar(save: SaveData, carId: string): OwnedCar | string {
  const def = CARS[carId];
  if (!def) return 'Unknown car.';
  if (save.profile.level < def.level) return `Reach level ${def.level} first.`;
  if (save.profile.credits < def.price) return 'Not enough money.';
  save.profile.credits -= def.price;
  const owned: OwnedCar = {
    uid: `car-${save.garage.nextUid++}`,
    carId,
    parts: {},
    tune: {},
    paint: { body: def.visual.defaultPaint, finish: def.visual.defaultFinish ?? 'metallic', wheels: '#c9ccd1', calipers: '#d21f2b' },
    livery: [],
    mileage: 0,
    paid: def.price,
  };
  save.garage.cars.push(owned);
  save.garage.selected = owned.uid;
  return owned;
}

export function sellCar(save: SaveData, uid: string): number | string {
  if (save.garage.cars.length <= 1) return 'You need at least one car.';
  const i = save.garage.cars.findIndex((c) => c.uid === uid);
  if (i < 0) return 'Not found.';
  const v = sellValue(save, save.garage.cars[i]);
  save.garage.cars.splice(i, 1);
  save.profile.credits += v;
  if (save.garage.selected === uid) save.garage.selected = save.garage.cars[0].uid;
  return v;
}

export function buyPerk(save: SaveData, id: string): string | null {
  const p = PERKS.find((x) => x.id === id);
  if (!p) return 'Unknown perk.';
  const rank = save.perks[id] ?? 0;
  if (rank >= p.ranks) return 'Maxed out.';
  if (p.requires && !save.perks[p.requires]) return 'Unlock the perk above first.';
  if (save.profile.sp < 1) return 'No skill points. Level up to earn more.';
  save.profile.sp--;
  save.perks[id] = rank + 1;
  return null;
}

const bar = (v: number) => `<i class="statbar"><i style="width:${Math.max(4, Math.min(100, v))}%"></i></i>`;

/** Dealer and skill-tree screens. */
export class Shop {
  readonly dealer: HTMLElement;
  readonly skills: HTMLElement;

  constructor(
    private parent: HTMLElement,
    private save: () => SaveData,
    private cb: { changed(): void; back(): void; click(): void; toast(t: string): void; chip(): HTMLElement },
  ) {
    this.dealer = this.screen('dealer');
    this.skills = this.screen('skills');
  }

  private screen(id: string): HTMLElement {
    const s = el('div', 'screen flow');
    s.id = id;
    this.parent.append(s);
    return s;
  }

  hide(): void {
    this.dealer.classList.remove('on');
    this.skills.classList.remove('on');
  }

  private head(s: HTMLElement, chip: string, h: string, kana: string): void {
    s.innerHTML = '';
    s.append(el('div', 'speedlines'), this.cb.chip());
    const t = el('div', 'panel-title');
    t.append(el('span', 'chip', chip), el('h2', '', h), el('div', 'kana', kana));
    s.append(t);
    const b = el('div', 'back');
    const btn = el('button', 'mbtn', 'BACK<small>戻る</small>');
    btn.addEventListener('click', () => {
      this.cb.click();
      this.cb.back();
    });
    b.append(btn);
    s.append(b);
  }

  showDealer(): void {
    const s = this.dealer;
    this.head(s, 'DEALER', 'Kaze Motors', 'ディーラー');
    const sv = this.save();
    const grid = el('div', 'dealer-grid');
    const maxHp = Math.max(...CAR_ORDER.map((id) => peakPower(CARS[id].physics.engine).hp));
    for (const id of CAR_ORDER) {
      const d = CARS[id];
      const hp = peakPower(d.physics.engine).hp;
      const owned = sv.garage.cars.filter((c) => c.carId === id);
      const locked = sv.profile.level < d.level;
      const card = el('div', 'dcard' + (locked ? ' locked' : ''));
      card.innerHTML = `<div class="dtop"><h3>${carName(id)}</h3><span class="price">${d.price ? formatYen(d.price) : 'STARTER'}</span></div>
        <div class="jp">${d.archetype.toUpperCase()} · ${d.physics.layout}</div><p>${carTagline(id)}</p>
        <div class="stats"><span>POWER ${Math.round(hp)} hp</span>${bar((hp / maxHp) * 100)}<span>WEIGHT ${d.physics.mass} kg</span>${bar(100 - (d.physics.mass - 900) / 8)}<span>PWR / WT</span>${bar((hp / d.physics.mass) * 420)}</div>`;
      const row = el('div', 'drow');
      if (locked) row.append(el('span', 'lock', `LEVEL ${d.level}`));
      else {
        const buy = el('button', 'sbtn primary', owned.length ? 'BUY ANOTHER' : 'BUY');
        buy.disabled = sv.profile.credits < d.price;
        buy.addEventListener('click', () => {
          const r = buyCar(this.save(), id);
          if (typeof r === 'string') this.cb.toast(r);
          else {
            this.cb.toast(`${carName(id).toUpperCase()} · BOUGHT`);
            this.cb.changed();
          }
          this.showDealer();
        });
        row.append(buy);
      }
      for (const o of owned) {
        const sell = el('button', 'sbtn', `SELL ${formatYen(sellValue(sv, o))}`);
        sell.addEventListener('click', () => {
          if (!sell.dataset.confirm) {
            sell.dataset.confirm = '1';
            sell.textContent = 'CONFIRM SELL';
            return;
          }
          const r = sellCar(this.save(), o.uid);
          this.cb.toast(typeof r === 'string' ? r : `SOLD · +${formatYen(r)}`);
          this.cb.changed();
          this.showDealer();
        });
        row.append(sell);
      }
      card.append(row);
      grid.append(card);
    }
    s.append(grid);
    s.classList.add('on');
  }

  showSkills(): void {
    const s = this.skills;
    this.head(s, 'SKILL TREE', 'Driver skills', 'スキルツリー');
    const sv = this.save();
    const tree = el('div', 'tree');
    const names = { style: ['STYLE', 'スタイル'], money: ['MONEY', 'マネー'], mechanic: ['MECHANIC', 'メカニック'] };
    for (const br of ['style', 'money', 'mechanic'] as const) {
      const col = el('div', 'branch');
      col.append(el('h3', '', `${names[br][0]} <small>${names[br][1]}</small>`));
      for (const p of PERKS.filter((x) => x.branch === br)) {
        const rank = sv.perks[p.id] ?? 0;
        const avail = !p.requires || !!sv.perks[p.requires];
        const node = el('button', 'perk' + (rank >= p.ranks ? ' max' : rank ? ' some' : '') + (avail ? '' : ' locked'));
        node.innerHTML = `<b>${p.name}</b><span>${p.desc}</span><em>${'◆'.repeat(rank)}${'◇'.repeat(p.ranks - rank)}</em>`;
        node.addEventListener('click', () => {
          const err = buyPerk(this.save(), p.id);
          this.cb.toast(err ?? `${p.name.toUpperCase()} · RANK ${(this.save().perks[p.id] ?? 0)}`);
          if (!err) {
            this.cb.click();
            this.cb.changed();
          }
          this.showSkills();
        });
        col.append(node);
      }
      tree.append(col);
    }
    s.append(tree, el('div', 'sp-left', `${sv.profile.sp} SKILL POINTS · earn 1 per level`));
    s.classList.add('on');
  }
}
