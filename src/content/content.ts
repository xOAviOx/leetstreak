/**
 * ISOLATED-world bridge, injected at document_start.
 *
 * Responsibilities:
 *   1. Inject the MAIN-world interceptor into the page (it needs the page's own
 *      window.fetch / XMLHttpRequest, which this isolated world can't reach).
 *   2. Receive the interceptor's postMessage, validate it hard, relay to the SW.
 *   3. Host the on-page toast (added in Phase 4).
 */
import { PAGE_MSG } from '../lib/types.ts';
import type { PageMessage, RuntimeMessage, BackgroundToContent } from '../lib/types.ts';
import { showToast } from './toast.ts';

const TRUSTED_ORIGIN = 'https://leetcode.com';

console.log('[LeetStreak] content script running @', location.href);
injectInterceptor();
listenForAccepted();
listenForToasts();

/**
 * Load the interceptor into the page's MAIN world via a <script> tag. Because
 * interceptor.js is a web_accessible_resource, this is exempt from the page CSP,
 * and its URL resolves against the extension origin. LeetCode's submit requests
 * happen long after page load, so slight async loading here is harmless.
 */
function injectInterceptor(): void {
  try {
    const src = chrome.runtime.getURL('interceptor.js');
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => {
      console.log('[LeetStreak] interceptor script loaded');
      script.remove();
    };
    script.onerror = (e) => console.error('[LeetStreak] interceptor script FAILED to load:', src, e);
    (document.head || document.documentElement).appendChild(script);
    console.log('[LeetStreak] injecting interceptor:', src);
  } catch (err) {
    console.error('[LeetStreak] failed to inject interceptor:', err);
  }
}

function listenForAccepted(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    // Only accept messages this page posted to itself.
    if (event.source !== window) return;
    if (event.origin !== TRUSTED_ORIGIN) return;

    const data = event.data as Partial<PageMessage> | null;
    if (!data || data[PAGE_MSG] !== true) return;
    if (data.type !== 'SUBMISSION_ACCEPTED' || !data.payload) return;

    const message: RuntimeMessage = {
      type: 'SUBMISSION_ACCEPTED',
      payload: data.payload,
    };

    console.log('[LeetStreak] relaying accepted -> service worker:', data.payload.submissionId);
    chrome.runtime.sendMessage(message).catch((err: unknown) => {
      // SW normally wakes on sendMessage; a reject here means the context is
      // gone (e.g. extension reloaded). Nothing user-facing to do here yet.
      console.error('[LeetStreak] relay failed:', err);
    });
  });

  console.log('[LeetStreak] content bridge listening (ISOLATED world)');
}

/**
 * Receive TOAST messages from the service worker and render them on the page.
 * Returns false (no async response) so the message channel closes immediately.
 */
function listenForToasts(): void {
  chrome.runtime.onMessage.addListener((message: BackgroundToContent) => {
    if (message?.type === 'TOAST') {
      try {
        showToast(message);
      } catch (err) {
        console.error('[LeetStreak] toast render failed:', err);
      }
    }
    return false;
  });
}

export {};
