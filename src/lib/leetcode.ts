/**
 * LeetCode GraphQL helpers, called from the service worker with the user's
 * session cookies (credentials: 'include' + leetcode.com host permission).
 * Phase 2 needs only the submission code fallback; problem metadata (title,
 * number, difficulty) is added in Phase 4.
 */

const GRAPHQL = 'https://leetcode.com/graphql/';

/**
 * Fetch the source code for one of the user's own submissions. Used as a
 * fallback when the intercepted check response doesn't include `code` (the v2
 * endpoint sometimes omits it). Returns null if unavailable.
 */
export async function fetchSubmissionCode(submissionId: string): Promise<string | null> {
  const query = `query submissionDetails($submissionId: Int!) {
    submissionDetails(submissionId: $submissionId) { code }
  }`;
  try {
    const res = await fetch(GRAPHQL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'submissionDetails',
        query,
        variables: { submissionId: Number(submissionId) },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { submissionDetails?: { code?: string } | null };
    };
    return json.data?.submissionDetails?.code ?? null;
  } catch {
    return null;
  }
}
