/**
 * Sync-pipeline test. Drives the REAL background service worker against a mocked
 * chrome + fetch to prove the Phase 2 contract end-to-end:
 *   1. A configured, accepted submission is pushed to GitHub exactly once, at
 *      the right path, with the right commit message and (UTF-8) content.
 *   2. Success is folded into stats (count, last record, synced date).
 *   3. Re-delivery of the same submission id is deduped — no second push.
 *   4. When GitHub isn't connected, the submission is queued, not dropped.
 *   5. SYNC_NOW later drains that queue once configured.
 *
 * Run: npm test   (node strips the TypeScript types on the fly)
 */
import assert from 'node:assert/strict';

// ---- fakes ------------------------------------------------------------------

type Listener = (msg: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => boolean | void;

const store = new Map<string, unknown>();
let onMessage: Listener | null = null;
const toasts: Array<{ tabId: number; msg: { type: string; state: string; commitUrl?: string } }> = [];
const calls: Array<{ method: string; url: string; body: Record<string, unknown> | undefined }> = [];

const SENDER = { tab: { id: 7 } };

function httpResponse(status: number, json: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (_h: string) => null },
    json: async () => json,
  };
}

async function fetchMock(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
  calls.push({ method, url, body });

  if (url.includes('api.github.com') && url.includes('/contents/')) {
    // File lookup: pretend nothing exists yet (create path). Write: 201 commit.
    if (method === 'GET') return httpResponse(404, { message: 'Not Found' });
    if (method === 'PUT') {
      return httpResponse(201, {
        commit: { sha: 'deadbeef', html_url: 'https://github.com/o/r/commit/deadbeef' },
        content: { html_url: 'https://github.com/o/r/blob/main/two-sum/two-sum.py' },
      });
    }
  }
  if (url.includes('api.github.com') && /\/repos\/[^/]+\/[^/]+$/.test(url)) {
    return httpResponse(200, {
      full_name: 'o/r',
      default_branch: 'main',
      private: true,
      html_url: 'https://github.com/o/r',
      owner: { login: 'o' },
      name: 'r',
    });
  }
  if (url.includes('leetcode.com/graphql')) {
    return httpResponse(200, { data: { submissionDetails: { code: 'FALLBACK' } } });
  }
  return httpResponse(200, {});
}

const chromeMock = {
  runtime: {
    onInstalled: { addListener(_fn: (d: unknown) => void): void {} },
    onMessage: {
      addListener(fn: Listener): void {
        onMessage = fn;
      },
    },
  },
  tabs: {
    sendMessage(tabId: number, msg: unknown): Promise<void> {
      toasts.push({ tabId, msg: msg as { type: string; state: string; commitUrl?: string } });
      return Promise.resolve();
    },
  },
  storage: {
    local: {
      async get(keys: string): Promise<Record<string, unknown>> {
        return store.has(keys) ? { [keys]: store.get(keys) } : {};
      },
      async set(obj: Record<string, unknown>): Promise<void> {
        for (const [k, v] of Object.entries(obj)) store.set(k, v);
      },
    },
  },
};

const g = globalThis as unknown as { chrome: unknown; fetch: unknown };
g.chrome = chromeMock;
g.fetch = fetchMock as unknown;

// ---- helpers ----------------------------------------------------------------

const configured = {
  token: 'ghp_test',
  repoOwner: 'o',
  repoName: 'r',
  branch: 'main',
  githubLogin: 'o',
  autoSync: true,
};

function acceptedMessage(id: string) {
  return {
    type: 'SUBMISSION_ACCEPTED' as const,
    payload: {
      submissionId: id,
      code: 'class Solution:\n    def twoSum(self):\n        # 日本語 🚀\n        return [0, 1]\n',
      lang: 'python3',
      questionId: 1,
      titleSlug: 'two-sum',
      runtimePercentile: 90.1,
      memoryPercentile: 55.5,
      runtimeDisplay: '10 ms',
      memoryDisplay: '16 MB',
      url: 'https://leetcode.com/problems/two-sum/',
    },
  };
}

function dispatch(msg: unknown, sendResponse: (r?: unknown) => void = () => {}): void {
  assert.ok(onMessage, 'background registered an onMessage listener');
  onMessage(msg, SENDER, sendResponse);
}

async function waitFor(pred: () => boolean, label: string, ms = 1000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const putCalls = () => calls.filter((c) => c.method === 'PUT');
const getStore = <T>(k: string): T => store.get(k) as T;

// ---- boot the worker --------------------------------------------------------

await import('../src/background/background.ts');
assert.ok(onMessage, 'service worker installed its message listener on import');

// ---- 1 + 2: configured push writes the file and records stats ---------------

store.set('settings', { ...configured });
dispatch(acceptedMessage('111'));
await waitFor(() => putCalls().length === 1, 'first PUT to GitHub');

const put = putCalls()[0];
assert.ok(put.url.endsWith('/repos/o/r/contents/two-sum/two-sum.py'), 'path is <slug>/<slug>.<ext>');
assert.equal(put.body?.message, 'Solve Two Sum', 'commit message collapses cleanly pre-metadata');
assert.equal(put.body?.branch, 'main', 'targets the resolved default branch');
assert.equal(put.body?.sha, undefined, 'no sha on create');
const decoded = Buffer.from(String(put.body?.content), 'base64').toString('utf8');
assert.ok(decoded.includes('🚀'), 'content is UTF-8 base64 (unicode survives the round-trip)');

const stats = getStore<{ totalSynced: number; last: { commitUrl: string | null; submissionId: string }; syncedDates: string[] }>('stats');
assert.equal(stats.totalSynced, 1, 'stats: one synced');
assert.equal(stats.last.submissionId, '111');
assert.equal(stats.last.commitUrl, 'https://github.com/o/r/commit/deadbeef');
assert.equal(stats.syncedDates.length, 1, 'stats: one synced day recorded');
assert.ok(toasts.some((t) => t.msg.state === 'success' && t.msg.commitUrl), 'success toast carries the commit url');
console.log('  ✓ configured push: correct path/message/content + stats + success toast');

// ---- 3: same submission id is deduped (no second push) ----------------------

dispatch(acceptedMessage('111'));
await new Promise((r) => setTimeout(r, 30));
assert.equal(putCalls().length, 1, 'a re-delivered submission id does not push again');
console.log('  ✓ dedupe: re-delivery of the same submission id is a no-op');

// ---- 4: not connected -> queued, not dropped --------------------------------

store.set('settings', { token: null, repoOwner: null, repoName: null, branch: null, githubLogin: null, autoSync: true });
dispatch(acceptedMessage('222'));
await waitFor(() => getStore<unknown[]>('retryQueue')?.length === 1, 'submission queued while unconfigured');
assert.equal(putCalls().length, 1, 'no push attempted while unconfigured');
const queued = getStore<Array<{ payload: { submissionId: string } }>>('retryQueue');
assert.equal(queued[0].payload.submissionId, '222', 'the unpushed submission is preserved in the queue');
console.log('  ✓ not connected: submission is queued, never dropped');

// ---- 5: SYNC_NOW drains the queue once configured ---------------------------

store.set('settings', { ...configured });
let syncResult: { drained: number; remaining: number } | undefined;
dispatch({ type: 'SYNC_NOW' }, (r) => {
  syncResult = r as { drained: number; remaining: number };
});
await waitFor(() => syncResult !== undefined, 'SYNC_NOW responded');
assert.deepEqual(syncResult, { drained: 1, remaining: 0 }, 'the queued submission drains');
assert.equal(putCalls().length, 2, 'draining performed the deferred push');
assert.equal(getStore<unknown[]>('retryQueue').length, 0, 'queue is empty after a clean drain');
assert.equal(getStore<{ totalSynced: number }>('stats').totalSynced, 2, 'drained push counts toward stats');
console.log('  ✓ SYNC_NOW: drains the retry queue once GitHub is connected');

console.log('\nAll sync tests passed.');
