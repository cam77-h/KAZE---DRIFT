import { addMoney, addXp, ECONOMY, MEDALS, type LevelUp, type Medal } from '../core/progression';
import type { RecordEntry, SaveData } from '../core/save';

/** Insert into a top-10 table. Returns the rank (0 = new best) or -1 if it didn't place. */
export function submitRecord(save: SaveData, key: string, entry: RecordEntry, lowerIsBetter = false): number {
  const list = (save.records.tables[key] ??= []);
  list.push(entry);
  list.sort((a, b) => (lowerIsBetter ? a.score - b.score : b.score - a.score));
  const rank = list.indexOf(entry);
  list.length = Math.min(list.length, 10);
  return rank < 10 ? rank : -1;
}

export function bestRecord(save: SaveData, key: string): RecordEntry | undefined {
  return save.records.tables[key]?.[0];
}

/** First-time medal bonuses: every medal tier newly reached pays once. */
export function medalBonus(save: SaveData, key: string, medal: Medal | null, table: Record<Medal, number>): number {
  if (!medal) return 0;
  const paid = (save.records.medalsPaid[key] ??= []);
  let yen = 0;
  const upto = MEDALS.indexOf(medal);
  const firstPerk = 1 + 0.25 * (save.perks.firstMedal ?? 0);
  for (let i = 0; i <= upto; i++) {
    const m = MEDALS[i];
    if (!paid.includes(m)) {
      paid.push(m);
      yen += table[m] * firstPerk;
    }
  }
  const prev = save.records.medals[key];
  if (!prev || MEDALS.indexOf(medal) > MEDALS.indexOf(prev as Medal)) save.records.medals[key] = medal;
  return yen;
}

export interface Payout {
  money: number;
  xp: number;
  sp: number;
  levelUps: LevelUp[];
}

/** Pay money and XP into the save, returning what was actually granted. */
export function payout(save: SaveData, yen: number, xp: number): Payout {
  const money = addMoney(save, yen);
  const spBefore = save.profile.sp;
  const levelUps = addXp(save, xp);
  return { money, xp: Math.round(xp), sp: save.profile.sp - spBefore, levelUps };
}

export function xpForPoints(points: number): number {
  return points / ECONOMY.xp.pointsPerXp;
}
