/**
 * Typed wrapper over chrome.storage.local — the single source of truth. The
 * service worker is ephemeral, so nothing lives in memory between events; it all
 * round-trips through here.
 */
import type {
  Settings,
  Stats,
  SyncRecord,
  QueueItem,
  AcceptedSubmissionPayload,
} from './types.ts';
import { localDateKey } from './format.ts';

const KEYS = {
  settings: 'settings',
  stats: 'stats',
  processed: 'processedSubmissionIds',
  queue: 'retryQueue',
} as const;

const PROCESSED_CAP = 500;

export const DEFAULT_SETTINGS: Settings = {
  token: null,
  repoOwner: null,
  repoName: null,
  branch: null,
  githubLogin: null,
  autoSync: true,
};

export const DEFAULT_STATS: Stats = {
  totalSynced: 0,
  last: null,
  syncedDates: [],
};

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...((r[KEYS.settings] as Partial<Settings>) ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export function isConfigured(s: Settings): boolean {
  return Boolean(s.token && s.repoOwner && s.repoName);
}

export async function getStats(): Promise<Stats> {
  const r = await chrome.storage.local.get(KEYS.stats);
  return { ...DEFAULT_STATS, ...((r[KEYS.stats] as Partial<Stats>) ?? {}) };
}

export async function setStats(next: Stats): Promise<void> {
  await chrome.storage.local.set({ [KEYS.stats]: next });
}

/**
 * Fold one successful push into the running stats: bump the counter, remember
 * it as the latest, and record its local day (idempotent per day) so Phase 5's
 * streak/heatmap has the data it needs. Returns the persisted Stats.
 */
export async function recordSync(rec: SyncRecord): Promise<Stats> {
  const stats = await getStats();
  const key = localDateKey(rec.at);
  const syncedDates = stats.syncedDates.includes(key)
    ? stats.syncedDates
    : [...stats.syncedDates, key];
  const next: Stats = {
    totalSynced: stats.totalSynced + 1,
    last: rec,
    syncedDates,
  };
  await setStats(next);
  return next;
}

/**
 * Atomically record a submission id as processed. Returns true only for the
 * first caller to see it. Storage-backed so it survives SW restarts.
 */
export async function claimSubmission(id: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(KEYS.processed);
  const list: string[] = Array.isArray(stored[KEYS.processed]) ? stored[KEYS.processed] : [];
  if (list.includes(id)) return false;
  const next = [...list, id];
  if (next.length > PROCESSED_CAP) next.splice(0, next.length - PROCESSED_CAP);
  await chrome.storage.local.set({ [KEYS.processed]: next });
  return true;
}

/** Undo a claim, so a failed push can be retried on a later identical event. */
export async function releaseSubmission(id: string): Promise<void> {
  const stored = await chrome.storage.local.get(KEYS.processed);
  const list: string[] = Array.isArray(stored[KEYS.processed]) ? stored[KEYS.processed] : [];
  const next = list.filter((x) => x !== id);
  if (next.length !== list.length) await chrome.storage.local.set({ [KEYS.processed]: next });
}

// --- retry queue (drained in Phase 5) ---------------------------------------

export async function getQueue(): Promise<QueueItem[]> {
  const r = await chrome.storage.local.get(KEYS.queue);
  return Array.isArray(r[KEYS.queue]) ? (r[KEYS.queue] as QueueItem[]) : [];
}

export async function setQueue(items: QueueItem[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.queue]: items });
}

/**
 * Add a submission to the retry queue, keyed by submission id so a re-poll of
 * the same accepted verdict can't stack duplicates. No-op if already queued.
 */
export async function enqueue(
  payload: AcceptedSubmissionPayload,
  error: string | null,
): Promise<void> {
  const q = await getQueue();
  if (q.some((i) => i.payload.submissionId === payload.submissionId)) return;
  q.push({ payload, attempts: 0, lastError: error, enqueuedAt: Date.now() });
  await setQueue(q);
}
