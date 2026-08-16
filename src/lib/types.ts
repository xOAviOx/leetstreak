/**
 * Shared types across all four worlds (interceptor / content / background / UI).
 * The message protocol is the contract that lets the ephemeral service worker,
 * the isolated content script, and the MAIN-world interceptor cooperate.
 */

// ----- Interceptor -> content (window.postMessage) -----

export const PAGE_MSG = '__leetstreak' as const;

export interface AcceptedSubmissionPayload {
  /** LeetCode submission id — our dedupe key end-to-end. */
  submissionId: string;
  /** The exact source that was accepted (read from the check response, never the DOM). */
  code: string;
  /** LeetCode language slug, e.g. "python3", "cpp". */
  lang: string;
  /** Internal question id from the check response (NOT the human-facing number). */
  questionId: string | number | null;
  /** Slug parsed from the page URL, e.g. "two-sum". */
  titleSlug: string;
  runtimePercentile: number | null;
  memoryPercentile: number | null;
  runtimeDisplay: string | null;
  memoryDisplay: string | null;
  /** Page URL at capture time, for provenance. */
  url: string;
}

export interface PageMessage {
  [PAGE_MSG]: true;
  type: 'SUBMISSION_ACCEPTED';
  payload: AcceptedSubmissionPayload;
}

// ----- Content -> background (chrome.runtime.sendMessage) -----

export type RuntimeMessage =
  | { type: 'SUBMISSION_ACCEPTED'; payload: AcceptedSubmissionPayload }
  | { type: 'GET_STATE' }
  | { type: 'SYNC_NOW' }
  | { type: 'PING' };

// ----- Background -> content (toast driving) -----

export type ToastState = 'syncing' | 'success' | 'error' | 'queued';

export interface ToastMessage {
  type: 'TOAST';
  state: ToastState;
  title: string;
  detail?: string;
  commitUrl?: string;
  /** Identifies which submission this toast is about, so we can update in place. */
  submissionId?: string;
}

export type BackgroundToContent = ToastMessage;

// ----- Persisted state (chrome.storage.local) -----

export interface Settings {
  /** Fine-grained GitHub PAT. Lives ONLY here; never logged or sent elsewhere. */
  token: string | null;
  repoOwner: string | null;
  repoName: string | null;
  /** Resolved default branch (main/master). Null until first resolved. */
  branch: string | null;
  /** Resolved GitHub login for the token, for display. */
  githubLogin: string | null;
  autoSync: boolean;
  /** Master switch. When false, accepted submissions are ignored entirely. */
  enabled: boolean;
}

export interface SyncRecord {
  submissionId: string;
  slug: string;
  title: string;
  commitUrl: string | null;
  at: number; // epoch ms
}

export interface Stats {
  totalSynced: number;
  last: SyncRecord | null;
  /** 'YYYY-MM-DD' (local) per synced day — powers streak + heatmap (Phase 5). */
  syncedDates: string[];
}

/** A push that failed and is waiting for retry (Phase 5 drains this). */
export interface QueueItem {
  payload: AcceptedSubmissionPayload;
  attempts: number;
  lastError: string | null;
  enqueuedAt: number;
}
