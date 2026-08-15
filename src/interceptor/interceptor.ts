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
    const payload = extractAccepted(urlLike, bodyText, {
      href: window.location.href,
      pathname: window.location.pathname,
    });
    if (!payload) return;
    if (seen.has(payload.submissionId)) return;
    seen.add(payload.submissionId);

    const message: PageMessage = {
      [PAGE_MSG]: true,
      type: 'SUBMISSION_ACCEPTED',
      payload,
    };
    window.postMessage(message, window.location.origin);
  };

  patchFetch(emit);
  patchXhr(emit);
  console.debug('[LeetStreak] interceptor armed (MAIN world)');
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
      if (url && CHECK_RE.test(url)) {
        // Clone so we never consume the body the page still needs to read.
        res
          .clone()
          .text()
          .then((text) => emit(url, text))
          .catch(() => {});
      }
    } catch {
      /* never let our observation break the page's request */
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
        if (url && CHECK_RE.test(url)) emit(url, this.responseText);
      } catch {
        /* ignore */
      }
    });
    return (originalSend as (...a: unknown[]) => void).apply(this, args);
  };
}

export {};
