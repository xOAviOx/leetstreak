/**
 * Pure detection logic — no DOM, no chrome, no side effects. Given a request
 * URL, its response body, and a page context, decide whether it represents an
 * accepted submission and, if so, produce the payload. Kept pure so it can be
 * unit-tested without a browser.
 */
import type { AcceptedSubmissionPayload } from './types.ts';

// Matches both the legacy `/submissions/detail/{id}/check/` and the current
// `/submissions/detail/{id}/v2/check/` endpoints. LeetCode moved to v2; the
// optional `v2/` segment keeps us working on either.
export const CHECK_RE = /\/submissions\/detail\/(\d+)\/(?:v2\/)?check\/?$/;

/** LeetCode's status_code for an accepted verdict. */
export const ACCEPTED_STATUS_CODE = 10;

/** The subset of LeetCode's check response we rely on. Typed at the boundary. */
export interface RawCheckResponse {
  state?: string;
  status_msg?: string;
  status_code?: number;
  submission_id?: string | number;
  code?: string;
  lang?: string;
  pretty_lang?: string;
  question_id?: string | number;
  runtime_percentile?: number | null;
  memory_percentile?: number | null;
  status_runtime?: string;
  status_memory?: string;
}

export interface DetectContext {
  /** window.location.href at capture time. */
  href: string;
  /** window.location.pathname at capture time. */
  pathname: string;
}

/**
 * Returns a payload iff `url` is a submission-check endpoint whose body reports
 * an accepted verdict in its final (SUCCESS) state. Otherwise null.
 */
export function extractAccepted(
  url: string,
  bodyText: string,
  ctx: DetectContext,
): AcceptedSubmissionPayload | null {
  const match = CHECK_RE.exec(url);
  if (!match) return null;

  let data: RawCheckResponse;
  try {
    data = JSON.parse(bodyText) as RawCheckResponse;
  } catch {
    return null; // not JSON / partial body
  }

  // Only the terminal (SUCCESS) poll carries the verdict. Accept on either the
  // human-readable status_msg or the numeric status_code, so a field rename on
  // one doesn't break us.
  if (data.state !== 'SUCCESS') return null;
  const isAccepted = data.status_msg === 'Accepted' || data.status_code === ACCEPTED_STATUS_CODE;
  if (!isAccepted) return null;

  const id = String(data.submission_id ?? match[1]);
  if (!id) return null;

  return {
    submissionId: id,
    code: typeof data.code === 'string' ? data.code : '',
    lang: data.lang ?? data.pretty_lang ?? 'unknown',
    questionId: data.question_id ?? null,
    titleSlug: parseSlug(ctx.pathname),
    runtimePercentile: numOrNull(data.runtime_percentile),
    memoryPercentile: numOrNull(data.memory_percentile),
    runtimeDisplay: data.status_runtime ?? null,
    memoryDisplay: data.status_memory ?? null,
    url: ctx.href,
  };
}

export function parseSlug(pathname: string): string {
  const m = /\/problems\/([^/]+)/.exec(pathname);
  return m ? m[1] : '';
}

export function numOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
