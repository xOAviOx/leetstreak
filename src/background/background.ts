/**
 * Service worker (ephemeral). Phase 2 responsibility: take an accepted
 * submission from the content bridge and push it to the user's GitHub repo as a
 * commit — deduping so each submission is pushed at most once, and queuing for
 * retry when we can't push right now (offline, not configured, rate-limited).
 *
 * The worker is killed and respawned constantly, so NEVER keep state in memory
 * between events. chrome.storage.local is the single source of truth — the
 * dedupe set, settings, stats, and retry queue all live there.
 */
import type {
  AcceptedSubmissionPayload,
  RuntimeMessage,
  BackgroundToContent,
  Settings,
  SyncRecord,
  QueueItem,
  ToastState,
} from '../lib/types.ts';
import {
  getSettings,
  setSettings,
  isConfigured,
  claimSubmission,
  getStats,
  recordSync,
  getQueue,
  setQueue,
  enqueue,
} from '../lib/storage.ts';
import {
  getRepo,
  getContentSha,
  putContent,
  GitHubError,
  type PutResult,
} from '../lib/github.ts';
import {
  buildFilePath,
  buildCommitMessage,
  toBase64Utf8,
  titleFromSlug,
  DEFAULT_COMMIT_TEMPLATE,
} from '../lib/format.ts';
import { fetchSubmissionCode } from '../lib/leetcode.ts';

/** Give up on a queued push after this many failed attempts. */
const MAX_ATTEMPTS = 5;

console.debug('[LeetStreak] service worker booted');

chrome.runtime.onInstalled.addListener((details) => {
  console.debug('[LeetStreak] onInstalled:', details.reason);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  switch (message?.type) {
    case 'PING':
      sendResponse({ ok: true });
      return false;

    case 'SUBMISSION_ACCEPTED':
      // Fire-and-forget: the content script doesn't await a response.
      void handleAccepted(message.payload, sender);
      return false;

    case 'GET_STATE':
      void getState().then(sendResponse);
      return true; // async response

    case 'SYNC_NOW':
      void drainQueue().then(sendResponse);
      return true; // async response

    default:
      return false;
  }
});

/** The intercepted accepted submission -> a commit, or a queued retry. */
async function handleAccepted(
  payload: AcceptedSubmissionPayload,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  console.log('[LeetStreak] SW received SUBMISSION_ACCEPTED:', payload.submissionId, payload.titleSlug);

  const settings = await getSettings();

  // Master switch: when paused, do nothing — don't claim, queue, or push, so a
  // later re-enable + re-submit behaves cleanly.
  if (!settings.enabled) {
    console.debug('[LeetStreak] paused; ignoring submission:', payload.submissionId);
    return;
  }

  // Dedupe — storage-backed so it survives SW restarts and repeated polls.
  const isNew = await claimSubmission(payload.submissionId);
  if (!isNew) {
    console.debug('[LeetStreak] duplicate submission ignored:', payload.submissionId);
    return;
  }

  // Not connected yet, or the user turned auto-sync off: park it so nothing is
  // lost. A later "Sync now" (or Phase 5's drain) picks it up. Keep the claim —
  // the queue owns this id now, and dedupe by id stays valid.
  if (!isConfigured(settings)) {
    await enqueue(payload, 'GitHub not connected');
    toast(sender, 'queued', 'Saved to sync later', 'Connect GitHub in LeetStreak settings.', payload.submissionId);
    return;
  }
  if (!settings.autoSync) {
    await enqueue(payload, 'Auto-sync off');
    toast(sender, 'queued', 'Queued', 'Auto-sync is off — press Sync in the popup.', payload.submissionId);
    return;
  }

  toast(sender, 'syncing', 'Syncing to GitHub…', payload.titleSlug, payload.submissionId);
  try {
    const { commitUrl, path } = await pushSubmission(payload, settings);
    await recordSync(recordFor(payload, commitUrl));
    console.log('[LeetStreak] ✅ pushed:', path, '->', commitUrl);
    toast(sender, 'success', 'Pushed to GitHub', path, payload.submissionId, commitUrl);
  } catch (err) {
    const msg = messageFor(err);
    await enqueue(payload, msg); // keep the claim; the queue retries later
    console.error('[LeetStreak] push failed, queued for retry:', msg);
    toast(sender, 'error', 'Sync failed', msg, payload.submissionId);
  }
}

interface PushOutcome extends PutResult {
  /** The repo-relative path we wrote, surfaced for the toast/log. */
  path: string;
}

/**
 * Do the actual GitHub write for one submission. Impure: reads/persists
 * settings, may hit LeetCode for the source fallback, and calls GitHub. Throws
 * GitHubError (or Error) on failure so the caller decides whether to queue.
 */
async function pushSubmission(
  payload: AcceptedSubmissionPayload,
  settings: Settings,
): Promise<PushOutcome> {
  // isConfigured guarantees these three are set.
  const token = settings.token as string;
  const owner = settings.repoOwner as string;
  const repo = settings.repoName as string;

  // Resolve (and cache) the default branch the first time we push.
  let branch = settings.branch;
  if (!branch) {
    branch = (await getRepo(token, owner, repo)).defaultBranch;
    await setSettings({ branch });
  }

  // The v2 check response sometimes omits the code — fall back to GraphQL.
  let code = payload.code;
  if (!code) {
    code = (await fetchSubmissionCode(payload.submissionId)) ?? '';
  }
  if (!code) {
    throw new Error('No source code available for this submission yet.');
  }

  const path = buildFilePath({
    slug: payload.titleSlug,
    lang: payload.lang,
    frontendId: null, // human-facing number arrives with metadata in Phase 4
  });
  const message = buildCommitMessage(DEFAULT_COMMIT_TEMPLATE, {
    lang: payload.lang,
    slug: payload.titleSlug,
    runtimePct: payload.runtimePercentile,
    memoryPct: payload.memoryPercentile,
  });
  const contentB64 = toBase64Utf8(code);

  // Updating an existing file requires its current sha; creating one must omit
  // it. getContentSha returns null (404) for a brand-new path.
  const sha = (await getContentSha(token, owner, repo, path, branch)) ?? undefined;
  const put = await putContent(token, owner, repo, path, { message, contentB64, branch, sha });
  return { ...put, path };
}

/** Best-effort attempt to push everything sitting in the retry queue. */
async function drainQueue(): Promise<{ drained: number; remaining: number; error?: string }> {
  const settings = await getSettings();
  if (!isConfigured(settings)) {
    return { drained: 0, remaining: (await getQueue()).length, error: 'GitHub not connected' };
  }

  const queue = await getQueue();
  const remaining: QueueItem[] = [];
  let drained = 0;

  for (const item of queue) {
    try {
      const { commitUrl } = await pushSubmission(item.payload, settings);
      await recordSync(recordFor(item.payload, commitUrl));
      drained++;
    } catch (err) {
      const attempts = item.attempts + 1;
      if (attempts < MAX_ATTEMPTS) {
        remaining.push({ ...item, attempts, lastError: messageFor(err) });
      } else {
        console.warn('[LeetStreak] giving up on submission after retries:', item.payload.submissionId);
      }
    }
  }

  await setQueue(remaining);
  console.log(`[LeetStreak] drain complete: ${drained} pushed, ${remaining.length} still queued`);
  return { drained, remaining: remaining.length };
}

/** Snapshot for the popup/options UI. Never leaks the raw token. */
async function getState(): Promise<{
  configured: boolean;
  settings: Omit<Settings, 'token'> & { hasToken: boolean };
  stats: Awaited<ReturnType<typeof getStats>>;
  queueLength: number;
}> {
  const [settings, stats, queue] = await Promise.all([getSettings(), getStats(), getQueue()]);
  const { token, ...rest } = settings;
  return {
    configured: isConfigured(settings),
    settings: { ...rest, hasToken: Boolean(token) },
    stats,
    queueLength: queue.length,
  };
}

function recordFor(payload: AcceptedSubmissionPayload, commitUrl: string | null): SyncRecord {
  return {
    submissionId: payload.submissionId,
    slug: payload.titleSlug,
    title: titleFromSlug(payload.titleSlug),
    commitUrl,
    at: Date.now(),
  };
}

function messageFor(err: unknown): string {
  if (err instanceof GitHubError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Sync failed.';
}

/**
 * Drive the on-page toast in the originating tab. Best-effort: the content
 * script only starts listening for these in Phase 4, so a missing receiver is
 * expected and swallowed.
 */
function toast(
  sender: chrome.runtime.MessageSender,
  state: ToastState,
  title: string,
  detail?: string,
  submissionId?: string,
  commitUrl?: string,
): void {
  const tabId = sender?.tab?.id;
  if (tabId == null) return;
  const msg: BackgroundToContent = { type: 'TOAST', state, title, detail, commitUrl, submissionId };
  void Promise.resolve(chrome.tabs.sendMessage(tabId, msg)).catch(() => {
    /* no receiver yet (pre-Phase 4) — nothing to do */
  });
}

export {};
