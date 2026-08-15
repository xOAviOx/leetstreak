/**
 * MAIN-world interceptor. Runs at document_start so it patches the page's
 * network primitives BEFORE LeetCode's app code captures references to them.
 *
 * Why MAIN world: content scripts run in an isolated world and cannot see the
 * page's own window.fetch / XMLHttpRequest. To observe LeetCode's submission
 * polling we must patch the real ones here, then relay results to the isolated
 * content script via window.postMessage (this world has no chrome.runtime).
 *
 * Source of truth for captured code is the check RESPONSE, never the editor DOM
 * — that avoids the race where a fast edit corrupts what we capture.
 *
 * The pure "is this an accepted submission?" decision lives in lib/detect so it
 * can be unit-tested; this file only does the impure patching, dedupe, relay.
 */
import { PAGE_MSG } from '../lib/types.ts';
import type { PageMessage } from '../lib/types.ts';
import { extractAccepted, CHECK_RE } from '../lib/detect.ts';

// Loud diagnostics while we lock down detection on the live site. Uses
// console.log (not console.debug, which DevTools hides by default). Flip off
// once the live gate passes.
const DEBUG = true;
// URLs worth surfacing during a submission, so endpoint drift is visible even
// if our precise CHECK_RE stops matching.
const HINT_RE = /submit|submission|check|interpret/i;
const log = (...a: unknown[]): void => {
  if (DEBUG) console.log('[LeetStreak]', ...a);
};

// Guard against double-injection (SPA navigations, HMR, etc.).
declare global {
  interface Window {
    __leetstreakInterceptorInstalled?: boolean;
  }
}

if (window.__leetstreakInterceptorInstalled) {
  // Already patched in this page context.
} else {
  window.__leetstreakInterceptorInstalled = true;
  install();
}

function install(): void {
  const seen = new Set<string>();

  const emit = (urlLike: string, bodyText: string): void => {
    // Diagnostic: we only reach here for check URLs. Show the verdict + the
    // full top-level shape so any v2 field renames are immediately visible.
    try {
      const d = JSON.parse(bodyText) as Record<string, unknown>;
      log('check response:', {
        url: urlLike,
        keys: Object.keys(d),
        state: d.state,
        status_msg: d.status_msg,
        status_code: d.status_code,
        hasCode: typeof d.code === 'string',
        codeLen: typeof d.code === 'string' ? d.code.length : 0,
      });
    } catch {
      log('check response (unparseable body):', urlLike);
    }

    const payload = extractAccepted(urlLike, bodyText, {
      href: window.location.href,
      pathname: window.location.pathname,
    });
    if (!payload) return;
    if (seen.has(payload.submissionId)) {
      log('duplicate accepted, skipping:', payload.submissionId);
      return;
    }
    seen.add(payload.submissionId);

    const message: PageMessage = {
      [PAGE_MSG]: true,
      type: 'SUBMISSION_ACCEPTED',
      payload,
    };
    log('✅ accepted, posting to bridge:', payload.submissionId, payload.titleSlug);
    window.postMessage(message, window.location.origin);
  };

  patchFetch(emit);
  patchXhr(emit);
  console.log('[LeetStreak] interceptor armed (MAIN world) @', window.location.href);
}

function patchFetch(emit: (url: string, body: string) => void): void {
  const original = window.fetch;
  window.fetch = async function patchedFetch(
    ...args: Parameters<typeof fetch>
  ): Promise<Response> {
    const res = await original.apply(this, args);
    try {
      const input = args[0];
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (url && HINT_RE.test(url)) log('fetch:', url);
      if (url && CHECK_RE.test(url)) {
        // Clone so we never consume the body the page still needs to read.
        res
          .clone()
          .text()
          .then((text) => emit(url, text))
          .catch((e) => log('fetch clone/read error:', e));
      }
    } catch (e) {
      log('fetch patch error:', e); // never let our observation break the page
    }
    return res;
  };
}

function patchXhr(emit: (url: string, body: string) => void): void {
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  // Stash the URL on the instance so the load handler can read it.
  proto.open = function patchedOpen(
    this: XMLHttpRequest & { __lsUrl?: string },
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this.__lsUrl = typeof url === 'string' ? url : url.href;
    return (originalOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  };

  proto.send = function patchedSend(
    this: XMLHttpRequest & { __lsUrl?: string },
    ...args: unknown[]
  ) {
    this.addEventListener('load', () => {
      try {
        const url = this.__lsUrl ?? '';
        if (!url) return;
        if (HINT_RE.test(url)) log('xhr:', url);
        if (!CHECK_RE.test(url)) return;
        // responseText throws when responseType is json/blob/arraybuffer, so
        // pick the right accessor for how LeetCode configured this request.
        const body = readXhrBody(this);
        if (body != null) emit(url, body);
      } catch (e) {
        log('xhr load handler error:', e);
      }
    });
    return (originalSend as (...a: unknown[]) => void).apply(this, args);
  };
}

/** Read an XHR body as text regardless of responseType. Null if not readable. */
function readXhrBody(xhr: XMLHttpRequest): string | null {
  const type = xhr.responseType;
  try {
    if (type === '' || type === 'text') return xhr.responseText;
    if (type === 'json') return JSON.stringify(xhr.response);
    return null; // blob / arraybuffer / document — not a check response we parse
  } catch {
    // Last resort: some engines still expose responseText.
    try {
      return xhr.responseText;
    } catch {
      return null;
    }
  }
}

export {};
