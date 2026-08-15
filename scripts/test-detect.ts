/**
 * Detection-pipeline test. Runs the REAL interceptor module against mocked
 * network primitives to prove:
 *   1. Non-check requests are ignored.
 *   2. Pending / non-accepted verdicts are ignored.
 *   3. An accepted verdict emits exactly one postMessage with the right fields.
 *   4. The same submission polled repeatedly still emits only once (dedupe).
 *   5. The XHR path works as well as the fetch path.
 *
 * Run: npm test   (node strips the TypeScript types on the fly)
 */
import assert from 'node:assert/strict';
import { extractAccepted } from '../src/lib/detect.ts';

const ORIGIN = 'https://leetcode.com';
const PROBLEM_PATH = '/problems/two-sum/';
const checkUrl = (id: string): string => `${ORIGIN}/submissions/detail/${id}/check/`;

function acceptedBody(id: number): string {
  return JSON.stringify({
    state: 'SUCCESS',
    status_msg: 'Accepted',
    submission_id: id,
    question_id: 1,
    code: 'class Solution:\n    def twoSum(self, nums, target):\n        # 日本語コメント 🚀\n        return [0, 1]\n',
    lang: 'python3',
    pretty_lang: 'Python3',
    runtime_percentile: 87.34,
    memory_percentile: 45.1,
    status_runtime: '52 ms',
    status_memory: '16.5 MB',
  });
}
const pendingBody = JSON.stringify({ state: 'STARTED' });
const wrongBody = JSON.stringify({ state: 'SUCCESS', status_msg: 'Wrong Answer', submission_id: 1 });

// ---- Part A: pure extractor unit checks -------------------------------------

const ctx = { href: ORIGIN + PROBLEM_PATH, pathname: PROBLEM_PATH };

assert.equal(extractAccepted(`${ORIGIN}/graphql`, acceptedBody(1), ctx), null, 'non-check URL ignored');
assert.equal(extractAccepted(checkUrl('1'), pendingBody, ctx), null, 'pending state ignored');
assert.equal(extractAccepted(checkUrl('1'), wrongBody, ctx), null, 'wrong answer ignored');
assert.equal(extractAccepted(checkUrl('1'), '{not json', ctx), null, 'malformed body ignored');

const parsed = extractAccepted(checkUrl('123456789'), acceptedBody(123456789), ctx);
assert.ok(parsed, 'accepted verdict produces a payload');
assert.equal(parsed.submissionId, '123456789');
assert.equal(parsed.titleSlug, 'two-sum');
assert.equal(parsed.questionId, 1);
assert.equal(parsed.lang, 'python3');
assert.equal(parsed.runtimePercentile, 87.34);
assert.equal(parsed.runtimeDisplay, '52 ms');
assert.ok(parsed.code.includes('🚀'), 'unicode code preserved');
console.log('  ✓ pure extractor: url/state/verdict filtering + field extraction');

// ---- Part B: drive the real interceptor with mocked primitives --------------

const posted: Array<{ type: string; payload: { submissionId: string; titleSlug: string; code: string } }> = [];

function fakeResponse(body: string): { clone(): { text(): Promise<string> } } {
  return { clone: () => ({ text: () => Promise.resolve(body) }) };
}

// The "original" fetch the interceptor will wrap: serves queued bodies for
// check URLs, empty JSON otherwise.
const fetchQueue: string[] = [];
function originalFetch(input: unknown): Promise<unknown> {
  const url = String(input);
  const body = /\/check\/?$/.test(url) ? (fetchQueue.shift() ?? '{}') : '{}';
  return Promise.resolve(fakeResponse(body));
}

class FakeXHR {
  private onLoad: (() => void) | null = null;
  responseText = '';
  open(_method: string, _url: string | URL): void {}
  send(): void {}
  addEventListener(type: string, cb: () => void): void {
    if (type === 'load') this.onLoad = cb;
  }
  fireLoad(body: string): void {
    this.responseText = body;
    this.onLoad?.();
  }
}

const fakeWindow = {
  __leetstreakInterceptorInstalled: false,
  location: { href: ORIGIN + PROBLEM_PATH, pathname: PROBLEM_PATH, origin: ORIGIN },
  fetch: originalFetch,
  postMessage: (msg: unknown) => {
    posted.push(msg as (typeof posted)[number]);
  },
};

const g = globalThis as unknown as { window: unknown; XMLHttpRequest: unknown };
g.window = fakeWindow;
g.XMLHttpRequest = FakeXHR;

await import('../src/interceptor/interceptor.ts');
const patchedFetch = fakeWindow.fetch as (input: unknown) => Promise<unknown>;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// fetch path, submission A (123456789): graphql noise, then pending/pending/accepted/accepted
await patchedFetch(`${ORIGIN}/graphql`);
fetchQueue.push(pendingBody, pendingBody, acceptedBody(123456789), acceptedBody(123456789));
for (let i = 0; i < 4; i++) await patchedFetch(checkUrl('123456789'));
await flush();
assert.equal(posted.length, 1, 'fetch path: accepted emits exactly once across polls');
assert.equal(posted[0].type, 'SUBMISSION_ACCEPTED');
assert.equal(posted[0].payload.submissionId, '123456789');
assert.equal(posted[0].payload.titleSlug, 'two-sum');
assert.ok(posted[0].payload.code.includes('🚀'));
console.log('  ✓ fetch path: accepted verdict emits exactly once (dedupe holds across polls)');

// XHR path, submission B (987654321): distinct id so its own dedupe is exercised
for (const body of [pendingBody, acceptedBody(987654321), acceptedBody(987654321)]) {
  const xhr = new FakeXHR();
  xhr.open('GET', checkUrl('987654321'));
  xhr.send();
  xhr.fireLoad(body);
}
await flush();
assert.equal(posted.length, 2, 'xhr path: second accepted submission emits exactly once');
assert.equal(posted[1].payload.submissionId, '987654321');
console.log('  ✓ xhr path: accepted verdict emits exactly once');

console.log('\nAll detection tests passed.');
