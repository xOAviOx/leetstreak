/**
 * Minimal GitHub REST client for the Contents API + repo/user lookups.
 * Uses the global fetch, so it runs in the service worker and under Node tests.
 * The token is passed per-call and never logged.
 */

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export type GitHubErrorCode =
  | 'BAD_TOKEN' // 401
  | 'FORBIDDEN' // 403 (missing scope/permission)
  | 'RATE_LIMIT' // 403 with remaining=0
  | 'NOT_FOUND' // 404
  | 'CONFLICT' // 409/422 (sha mismatch)
  | 'NETWORK' // fetch threw
  | 'UNKNOWN';

export class GitHubError extends Error {
  readonly status: number;
  readonly code: GitHubErrorCode;
  /** Epoch seconds when the rate limit resets, if known. */
  readonly rateLimitReset?: number;

  // Fields are assigned explicitly (rather than via constructor parameter
  // properties) so this module runs under Node's strip-only TS loader in tests.
  constructor(message: string, status: number, code: GitHubErrorCode, rateLimitReset?: number) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.code = code;
    this.rateLimitReset = rateLimitReset;
  }
}

export interface GitHubUser {
  login: string;
  avatarUrl: string;
}

export interface RepoInfo {
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
}

export interface PutResult {
  commitSha: string;
  commitUrl: string; // html_url of the commit
  contentUrl: string; // html_url of the file
}

function headers(token: string, json = false): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function request(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  try {
    return await fetch(`${API}${path}`, {
      method,
      headers: headers(token, body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GitHubError('Could not reach GitHub. Check your connection.', 0, 'NETWORK');
  }
}

async function errorFrom(res: Response): Promise<GitHubError> {
  let apiMessage = '';
  try {
    const j = (await res.json()) as { message?: string };
    apiMessage = j?.message ?? '';
  } catch {
    /* non-JSON error body */
  }

  if (res.status === 401) {
    return new GitHubError('Your GitHub token is invalid or expired.', 401, 'BAD_TOKEN');
  }
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0) || undefined;
      return new GitHubError('GitHub rate limit reached.', 403, 'RATE_LIMIT', reset);
    }
    // 403 here means the token reached the API but isn't authorized for this
    // resource (e.g. GitHub's "Resource not accessible by personal access
    // token"). The raw message doesn't say how to fix it, so append guidance
    // that covers both flows: pushing files (Contents) and creating repos
    // (Administration).
    const permHint =
      "Check the token's repository access includes this repo, and grant Contents: Read and write (Administration: Read and write is required to create repos).";
    return new GitHubError(
      apiMessage ? `${apiMessage} — ${permHint}` : `Token lacks permission. ${permHint}`,
      403,
      'FORBIDDEN',
    );
  }
  if (res.status === 404) {
    return new GitHubError(apiMessage || 'Not found.', 404, 'NOT_FOUND');
  }
  if (res.status === 409 || res.status === 422) {
    return new GitHubError(apiMessage || 'Conflict updating file (stale sha).', res.status, 'CONFLICT');
  }
  return new GitHubError(apiMessage || `GitHub error ${res.status}.`, res.status, 'UNKNOWN');
}

/** Validate a token and resolve the authenticated user. */
export async function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  const res = await request(token, 'GET', '/user');
  if (!res.ok) throw await errorFrom(res);
  const j = (await res.json()) as { login: string; avatar_url: string };
  return { login: j.login, avatarUrl: j.avatar_url };
}

export async function getRepo(token: string, owner: string, repo: string): Promise<RepoInfo> {
  const res = await request(token, 'GET', `/repos/${owner}/${repo}`);
  if (!res.ok) throw await errorFrom(res);
  const j = (await res.json()) as {
    full_name: string;
    default_branch: string;
    private: boolean;
    html_url: string;
    owner: { login: string };
    name: string;
  };
  return {
    fullName: j.full_name,
    owner: j.owner.login,
    name: j.name,
    defaultBranch: j.default_branch,
    private: j.private,
    htmlUrl: j.html_url,
  };
}

export interface RepoListItem {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
}

/** List repos the token can access (first page, most-recently-pushed first). */
export async function listRepos(token: string, perPage = 100): Promise<RepoListItem[]> {
  const res = await request(
    token,
    'GET',
    `/user/repos?per_page=${perPage}&sort=pushed&affiliation=owner,collaborator`,
  );
  if (!res.ok) throw await errorFrom(res);
  const arr = (await res.json()) as Array<{
    full_name: string;
    private: boolean;
    owner: { login: string };
    name: string;
  }>;
  return arr.map((r) => ({
    fullName: r.full_name,
    owner: r.owner.login,
    name: r.name,
    private: r.private,
  }));
}

export async function createRepo(
  token: string,
  name: string,
  isPrivate: boolean,
): Promise<RepoInfo> {
  const res = await request(token, 'POST', '/user/repos', {
    name,
    private: isPrivate,
    auto_init: true, // create an initial commit so the default branch exists
    description: 'My LeetCode solutions, synced by LeetStreak.',
  });
  if (!res.ok) throw await errorFrom(res);
  const j = (await res.json()) as {
    full_name: string;
    default_branch: string;
    private: boolean;
    html_url: string;
    owner: { login: string };
    name: string;
  };
  return {
    fullName: j.full_name,
    owner: j.owner.login,
    name: j.name,
    defaultBranch: j.default_branch,
    private: j.private,
    htmlUrl: j.html_url,
  };
}

/**
 * Get the blob sha for a file if it exists, else null (404). Needed because
 * updating a file requires its current sha, while creating one must omit it.
 */
export async function getContentSha(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<string | null> {
  const res = await request(
    token,
    'GET',
    `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFrom(res);
  const j = (await res.json()) as { sha?: string } | Array<unknown>;
  if (Array.isArray(j)) {
    throw new GitHubError('Path is a directory, not a file.', 422, 'CONFLICT');
  }
  return j.sha ?? null;
}

export interface PutParams {
  message: string;
  contentB64: string;
  branch: string;
  /** Present when updating an existing file. */
  sha?: string;
}

/** Create or update a file. Each successful PUT is a commit → a contribution. */
export async function putContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  params: PutParams,
): Promise<PutResult> {
  const body: Record<string, unknown> = {
    message: params.message,
    content: params.contentB64,
    branch: params.branch,
  };
  if (params.sha) body.sha = params.sha;

  const res = await request(
    token,
    'PUT',
    `/repos/${owner}/${repo}/contents/${encodePath(path)}`,
    body,
  );
  if (!res.ok) throw await errorFrom(res);
  const j = (await res.json()) as {
    commit: { sha: string; html_url: string };
    content: { html_url: string };
  };
  return {
    commitSha: j.commit.sha,
    commitUrl: j.commit.html_url,
    contentUrl: j.content.html_url,
  };
}

/** Encode each path segment but keep the slashes. */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}
