/**
 * On-page sync toast, hosted by the content script (ISOLATED world). Rendered
 * inside a Shadow DOM so LeetCode's stylesheet can't touch it and ours can't
 * leak out. The background drives it via TOAST messages: a 'syncing' toast is
 * updated in place to 'success'/'error' using the shared submissionId, so each
 * solve shows a single toast that transitions rather than stacking.
 */
import type { ToastMessage, ToastState } from '../lib/types.ts';

const HOST_ID = '__leetstreak-toast-host';

let shadow: ShadowRoot | null = null;
let stack: HTMLElement | null = null;
/** submissionId (or 'default') -> live toast element + dismiss timer. */
const toasts = new Map<string, { el: HTMLElement; timer: number | null }>();

/** How long a toast stays before auto-dismiss. 'syncing' never auto-dismisses
 *  (it gets replaced by the terminal state). */
function dismissMs(state: ToastState): number {
  switch (state) {
    case 'success':
      return 6000;
    case 'queued':
      return 7000;
    case 'error':
      return 10000;
    case 'syncing':
    default:
      return 0;
  }
}

const ICONS: Record<ToastState, string> = {
  syncing: '<div class="spinner" aria-hidden="true"></div>',
  success:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  queued:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

const STYLES = `
:host {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  pointer-events: none;
  color-scheme: dark;
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
.toast {
  pointer-events: auto;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  box-sizing: border-box;
  width: 320px;
  max-width: calc(100vw - 32px);
  padding: 12px 12px 12px 14px;
  background: #16191f;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 3px solid #f5a524;
  border-radius: 12px;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);
  font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #eceae4;
  opacity: 0;
  transform: translateX(24px);
  transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 260ms cubic-bezier(0.16, 1, 0.3, 1);
}
.toast--in { opacity: 1; transform: translateX(0); }
.toast--out { opacity: 0; transform: translateX(24px); }
.toast[data-state="error"] { border-left-color: #f26d6d; }
.toast[data-state="queued"] { border-left-color: #9ba1ad; }
.toast[data-state="syncing"] { border-left-color: #ff7a1a; }
.icon {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  color: #f5a524;
  display: flex;
  align-items: center;
  justify-content: center;
}
.toast[data-state="error"] .icon { color: #f26d6d; }
.toast[data-state="queued"] .icon { color: #9ba1ad; }
.icon svg { width: 100%; height: 100%; display: block; }
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(245, 165, 36, 0.25);
  border-top-color: #f5a524;
  border-radius: 50%;
  animation: ls-spin 0.7s linear infinite;
}
@keyframes ls-spin { to { transform: rotate(360deg); } }
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.brand {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
}
.title { font-size: 13px; font-weight: 600; line-height: 1.3; }
.detail { font-size: 12px; color: #9ba1ad; line-height: 1.35; word-break: break-word; }
.link {
  align-self: flex-start;
  margin-top: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #f5a524;
  text-decoration: none;
}
.link:hover { text-decoration: underline; }
.close {
  flex: none;
  appearance: none;
  background: transparent;
  border: 0;
  color: #6b7280;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px;
  border-radius: 4px;
}
.close:hover { color: #eceae4; }
@media (prefers-reduced-motion: reduce) {
  .toast { transition-duration: 1ms; }
  .spinner { animation-duration: 2.4s; }
}
`;

function ensureStack(): HTMLElement | null {
  if (stack) return stack;
  const parent = document.body || document.documentElement;
  if (!parent) return null;

  const host = document.createElement('div');
  host.id = HOST_ID;
  shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  const container = document.createElement('div');
  container.className = 'stack';
  shadow.append(style, container);
  parent.appendChild(host);

  stack = container;
  return stack;
}

/** Only allow https links (the commit URL) — never render arbitrary schemes. */
function isSafeUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function paint(el: HTMLElement, msg: ToastMessage): void {
  el.dataset.state = msg.state;
  el.replaceChildren();

  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.innerHTML = ICONS[msg.state]; // trusted, module-local SVG constants

  const body = document.createElement('div');
  body.className = 'body';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.textContent = 'LeetStreak';
  body.appendChild(brand);

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = msg.title;
  body.appendChild(title);

  if (msg.detail) {
    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.textContent = msg.detail;
    body.appendChild(detail);
  }

  if (msg.commitUrl && isSafeUrl(msg.commitUrl)) {
    const link = document.createElement('a');
    link.className = 'link';
    link.href = msg.commitUrl;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = 'View commit ↗';
    body.appendChild(link);
  }

  const close = document.createElement('button');
  close.className = 'close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '✕';
  const key = el.dataset.key ?? 'default';
  close.addEventListener('click', () => dismiss(key));

  el.append(icon, body, close);
}

function dismiss(key: string): void {
  const entry = toasts.get(key);
  if (!entry) return;
  if (entry.timer != null) window.clearTimeout(entry.timer);
  toasts.delete(key);

  const { el } = entry;
  el.classList.remove('toast--in');
  el.classList.add('toast--out');
  let removed = false;
  const remove = (): void => {
    if (removed) return;
    removed = true;
    el.remove();
  };
  el.addEventListener('transitionend', remove, { once: true });
  window.setTimeout(remove, 400); // fallback if transitionend doesn't fire
}

/** Show or update the toast for this message (keyed by submissionId). */
export function showToast(msg: ToastMessage): void {
  const container = ensureStack();
  if (!container) return;

  const key = msg.submissionId || 'default';
  let entry = toasts.get(key);

  if (!entry) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.key = key;
    container.appendChild(el);
    // Next frame so the enter transition runs from the initial (hidden) state.
    requestAnimationFrame(() => el.classList.add('toast--in'));
    entry = { el, timer: null };
    toasts.set(key, entry);
  } else {
    entry.el.classList.add('toast--in');
    entry.el.classList.remove('toast--out');
  }

  paint(entry.el, msg);

  if (entry.timer != null) window.clearTimeout(entry.timer);
  const ttl = dismissMs(msg.state);
  entry.timer = ttl > 0 ? window.setTimeout(() => dismiss(key), ttl) : null;
}
