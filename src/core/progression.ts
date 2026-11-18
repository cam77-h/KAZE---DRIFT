import economy from '../data/economy.json';
import type { SaveData } from './save';

// Money (¥), XP → driver level, and skill points. Pure functions over the save data so
// they're easy to test and the pacing can be simulated headless.

export const ECONOMY = economy;

/** XP needed to go from level n to level n+1. */
export function xpForLevel(n: number): number {
  return Math.round(ECONOMY.xp.levelBase * Math.pow(n, ECONOMY.xp.levelExponent));
}

export function formatYen(n: number): string {
  return '¥' + Math.round(n).toLocaleString('en-US');
}

export interface LevelUp {
  level: number;
  yen: number;
  sp: number;
  milestone: boolean;
}

/** Add XP and return any level-ups (each grants SP and money; every 5th is a milestone). */
export function addXp(save: SaveData, xp: number): LevelUp[] {
  const ups: LevelUp[] = [];
  save.profile.xp += Math.max(0, Math.round(xp));
  while (save.profile.xp >= xpForLevel(save.profile.level)) {
    save.profile.xp -= xpForLevel(save.profile.level);
    save.profile.level++;
    const milestone = save.profile.level % ECONOMY.levelUp.milestoneEvery === 0;
    const up: LevelUp = { level: save.profile.level, yen: ECONOMY.levelUp.yen, sp: ECONOMY.levelUp.sp, milestone };
    save.profile.credits += up.yen;
    save.profile.sp = (save.profile.sp ?? 0) + up.sp;
    ups.push(up);
  }
  return ups;
}

export function addMoney(save: SaveData, yen: number): number {
  const v = Math.round(yen * moneyMultiplier(save));
  save.profile.credits += v;
  save.stats.moneyEarned += Math.max(0, v);
  return v;
}

export function canAfford(save: SaveData, price: number): boolean {
  return save.profile.credits >= price;
}

/** Perks that raise earnings (skill tree, Money branch). */
export function moneyMultiplier(save: SaveData): number {
  const p = save.perks ?? {};
  return 1 + 0.05 * (p.earn ?? 0);
}

export type Medal = 'bronze' | 'silver' | 'gold' | 'platinum';
export const MEDALS: Medal[] = ['bronze', 'silver', 'gold', 'platinum'];
export const MEDAL_LABEL: Record<Medal, string> = { bronze: 'BRONZE', silver: 'SILVER', gold: 'GOLD', platinum: 'PLATINUM' };

export function medalFor(score: number, targets: Record<Medal, number>, lowerIsBetter = false): Medal | null {
  let best: Medal | null = null;
  for (const m of MEDALS) if (lowerIsBetter ? score > 0 && score <= targets[m] : score >= targets[m]) best = m;
  return best;
}
