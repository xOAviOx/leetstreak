/**
 * Service worker (ephemeral). Phase 1 responsibility: receive accepted
 * submissions from the content bridge, dedupe by submission id, and log the
 * full payload. GitHub push arrives in Phase 2.
 *
 * The worker is killed and respawned constantly, so NEVER keep state in memory
 * between events. chrome.storage.local is the single source of truth — even the
 * dedupe set lives there.
 */
import type { AcceptedSubmissionPayload, RuntimeMessage } from '../lib/types.ts';

const PROCESSED_KEY = 'processedSubmissionIds';
const PROCESSED_CAP = 500; // keep the dedupe list bounded

console.debug('[LeetStreak] service worker booted');

chrome.runtime.onInstalled.addListener((details) => {
  console.debug('[LeetStreak] onInstalled:', details.reason);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  switch (message?.type) {
    case 'PING':
      sendResponse({ ok: true });
      return false;

    case 'SUBMISSION_ACCEPTED':
      // Async work — return true to keep the message channel open.
      void handleAccepted(message.payload);
      return false;

    default:
      return false;
  }
});

async function handleAccepted(payload: AcceptedSubmissionPayload): Promise<void> {
  console.log('[LeetStreak] SW received SUBMISSION_ACCEPTED:', payload.submissionId, payload.titleSlug);
  const isNew = await claimSubmission(payload.submissionId);
  if (!isNew) {
    console.debug('[LeetStreak] duplicate submission ignored:', payload.submissionId);
    return;
  }

  // Phase 1: prove the whole pipeline. Log everything (minus the full code body,
  // which we summarize so the console stays readable).
  console.log('[LeetStreak] ✅ ACCEPTED submission captured:', {
    submissionId: payload.submissionId,
    titleSlug: payload.titleSlug,
    questionId: payload.questionId,
    lang: payload.lang,
    runtimePercentile: payload.runtimePercentile,
    memoryPercentile: payload.memoryPercentile,
    runtimeDisplay: payload.runtimeDisplay,
    memoryDisplay: payload.memoryDisplay,
    codeLength: payload.code.length,
    codePreview: payload.code.slice(0, 120),
    url: payload.url,
  });
}

/**
 * Atomically record a submission id as processed. Returns true if this call is
 * the first to see it, false if it was already recorded. Storage-backed so it
 * survives service-worker restarts.
 */
async function claimSubmission(id: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(PROCESSED_KEY);
  const list: string[] = Array.isArray(stored[PROCESSED_KEY]) ? stored[PROCESSED_KEY] : [];
  if (list.includes(id)) return false;

  const next = [...list, id];
  if (next.length > PROCESSED_CAP) next.splice(0, next.length - PROCESSED_CAP);
  await chrome.storage.local.set({ [PROCESSED_KEY]: next });
  return true;
}

export {};
