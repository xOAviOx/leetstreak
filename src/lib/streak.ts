/**
 * Pure streak + heatmap math over the set of local day-keys ('YYYY-MM-DD') that
 * had at least one sync. No DOM / chrome, so it's fully unit-testable. Day
 * stepping goes through Date so it stays correct across DST boundaries (a "day"
 * isn't always 24h).
 */
import { localDateKey } from './format.ts';

/** Shift a 'YYYY-MM-DD' key by whole local days. */
function stepDays(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDateKey(dt.getTime());
}

/**
 * Length of the consecutive run of synced days ending today — or yesterday, so
 * the streak isn't considered broken until a full day passes without a sync.
 */
export function currentStreak(dates: Iterable<string>, now: number = Date.now()): number {
  const set = dates instanceof Set ? dates : new Set(dates);
  if (set.size === 0) return 0;

  const today = localDateKey(now);
  let cursor: string;
  if (set.has(today)) cursor = today;
  else {
    const yesterday = stepDays(today, -1);
    if (set.has(yesterday)) cursor = yesterday;
    else return 0;
  }

  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = stepDays(cursor, -1);
  }
  return streak;
}

/** Longest consecutive run anywhere in the history. */
export function longestStreak(dates: Iterable<string>): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of sorted) {
    run = prev && stepDays(prev, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }
  return best;
}

export interface HeatCell {
  /** 'YYYY-MM-DD' local key for this cell. */
  date: string;
  /** True if a solution synced on this day. */
  active: boolean;
  /** True for cells after today (padding to complete the last week column). */
  future: boolean;
  /** True for today's cell (for the highlight ring). */
  today: boolean;
}

/**
 * Build a GitHub-style contribution grid: `weeks` columns (oldest → newest),
 * each a Sunday→Saturday run of 7 cells, with the last column containing today.
 */
export function buildHeatmap(
  dates: Iterable<string>,
  weeks = 20,
  now: number = Date.now(),
): HeatCell[][] {
  const set = dates instanceof Set ? dates : new Set(dates);
  const todayKey = localDateKey(now);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  // Sunday of the current week, then rewind to the first visible column.
  const firstSunday = new Date(today);
  firstSunday.setDate(firstSunday.getDate() - firstSunday.getDay() - (weeks - 1) * 7);

  const grid: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let day = 0; day < 7; day++) {
      const cell = new Date(firstSunday);
      cell.setDate(firstSunday.getDate() + w * 7 + day);
      const key = localDateKey(cell.getTime());
      col.push({
        date: key,
        active: set.has(key),
        future: key > todayKey,
        today: key === todayKey,
      });
    }
    grid.push(col);
  }
  return grid;
}
