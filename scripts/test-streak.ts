/**
 * Streak + heatmap math tests. Pure functions, so we drive them with a fixed
 * `now` and build the expected day-keys with the same local-date logic the lib
 * uses (avoids timezone flakiness in CI).
 *
 * Run: npm test
 */
import assert from 'node:assert/strict';
import { currentStreak, longestStreak, buildHeatmap } from '../src/lib/streak.ts';
import { localDateKey } from '../src/lib/format.ts';

const NOW = new Date(2026, 1, 15, 12, 0, 0).getTime(); // 2026-02-15, midday local

/** Day-key `delta` days from NOW, built the same way the lib steps days. */
function key(delta: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + delta);
  return localDateKey(d.getTime());
}

// ---- currentStreak ----------------------------------------------------------

assert.equal(currentStreak([], NOW), 0, 'no dates -> 0');
assert.equal(currentStreak([key(0)], NOW), 1, 'today only -> 1');
assert.equal(currentStreak([key(0), key(-1), key(-2)], NOW), 3, 'today + 2 back -> 3');
// Anchored on yesterday when today has no sync yet (streak not yet broken).
assert.equal(currentStreak([key(-1), key(-2)], NOW), 2, 'yesterday-anchored streak survives');
// A gap at today AND yesterday breaks it.
assert.equal(currentStreak([key(-2), key(-3)], NOW), 0, 'gap of 2 days -> broken');
// Duplicates and unordered input are fine.
assert.equal(currentStreak([key(-1), key(0), key(0), key(-2)], NOW), 3, 'dupes/order tolerated');
console.log('  ✓ currentStreak: today/yesterday anchoring, gaps, dedupe');

// ---- longestStreak ----------------------------------------------------------

assert.equal(longestStreak([]), 0, 'empty -> 0');
assert.equal(longestStreak([key(-10), key(-2), key(-1), key(0), key(-20)]), 3, 'finds the 3-run');
assert.equal(longestStreak([key(-5), key(-3)]), 1, 'no adjacency -> 1');
console.log('  ✓ longestStreak: finds the longest consecutive run');

// ---- buildHeatmap -----------------------------------------------------------

const grid = buildHeatmap([key(0), key(-1)], 20, NOW);
assert.equal(grid.length, 20, '20 week-columns');
assert.ok(grid.every((c) => c.length === 7), 'each column has 7 days');

const flat = grid.flat();
const todayCell = flat.find((c) => c.today);
assert.ok(todayCell, "today's cell exists in the grid");
assert.equal(todayCell.date, localDateKey(NOW), "today's cell carries today's key");
assert.equal(todayCell.active, true, 'today is active (we synced today)');
assert.ok(
  flat.some((c) => c.date === key(-1) && c.active),
  'yesterday is marked active',
);
assert.ok(
  flat.some((c) => c.future),
  'grid pads future cells after today to finish the week',
);
assert.ok(
  !flat.some((c) => c.future && c.active),
  'future cells are never active',
);
console.log('  ✓ buildHeatmap: 20x7 grid, today/active/future flags');

console.log('\nAll streak tests passed.');
