/**
 * Pure formatting helpers: unicode-safe base64, language→extension mapping,
 * repo path building, and commit-message templating. No DOM / chrome / network,
 * so it's fully unit-testable.
 */

// --- base64 (UTF-8 safe, chunked) --------------------------------------------

const CHUNK = 0x8000; // 32k — stay well under String.fromCharCode arg limits

/**
 * Base64-encode a string as UTF-8. Plain btoa() mangles non-ASCII (comments,
 * emoji), so we encode to bytes first and chunk fromCharCode to avoid blowing
 * the argument limit on large files.
 */
export function toBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// --- language → file extension ----------------------------------------------

const LANG_EXT: Record<string, string> = {
  python: 'py',
  python3: 'py',
  pythondata: 'py',
  cpp: 'cpp',
  c: 'c',
  java: 'java',
  javascript: 'js',
  typescript: 'ts',
  csharp: 'cs',
  'c#': 'cs',
  golang: 'go',
  go: 'go',
  kotlin: 'kt',
  swift: 'swift',
  rust: 'rs',
  ruby: 'rb',
  scala: 'scala',
  php: 'php',
  racket: 'rkt',
  erlang: 'erl',
  elixir: 'ex',
  dart: 'dart',
  bash: 'sh',
  mysql: 'sql',
  mssql: 'sql',
  oraclesql: 'sql',
  postgresql: 'sql',
};

export function extForLang(lang: string): string {
  return LANG_EXT[lang.toLowerCase()] ?? 'txt';
}

// --- repo paths --------------------------------------------------------------

/** Zero-pad a frontend problem number to 4 digits (e.g. 1 -> "0001"). */
export function padId(id: string | number): string {
  const digits = String(id).replace(/\D/g, '');
  return digits ? digits.padStart(4, '0') : '';
}

export interface PathParts {
  slug: string;
  lang: string;
  /** Human-facing problem number (questionFrontendId). Omitted pre-metadata. */
  frontendId?: string | number | null;
  difficulty?: string | null;
  folderByDifficulty?: boolean;
}

/**
 * Build the repo path for a solution file. With a frontend id:
 *   0001-two-sum/two-sum.py
 * Without one (before metadata is fetched):
 *   two-sum/two-sum.py
 * With folderByDifficulty:
 *   Easy/0001-two-sum/two-sum.py
 */
export function buildFilePath(p: PathParts): string {
  const ext = extForLang(p.lang);
  const pad = p.frontendId != null ? padId(p.frontendId) : '';
  const folder = pad ? `${pad}-${p.slug}` : p.slug;
  const prefix = p.folderByDifficulty && p.difficulty ? `${p.difficulty}/` : '';
  return `${prefix}${folder}/${p.slug}.${ext}`;
}

// --- commit messages ---------------------------------------------------------

/** "two-sum" -> "Two Sum". A readable fallback when metadata isn't available. */
export function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export interface CommitVars {
  number?: string | number | null;
  title?: string | null;
  difficulty?: string | null;
  lang: string;
  slug: string;
  runtimePct?: number | null;
  memoryPct?: number | null;
}

export const DEFAULT_COMMIT_TEMPLATE = 'Solve {number}. {title} ({difficulty})';

/**
 * Fill a commit-message template. Unknown/empty variables collapse cleanly so a
 * pre-metadata push (no number/difficulty) doesn't leave "Solve . ()" litter.
 */
export function buildCommitMessage(template: string, v: CommitVars): string {
  const vars: Record<string, string> = {
    number: v.number != null ? String(v.number) : '',
    title: v.title ?? titleFromSlug(v.slug),
    difficulty: v.difficulty ?? '',
    lang: v.lang,
    slug: v.slug,
    runtimePct: v.runtimePct != null ? String(v.runtimePct) : '',
    memoryPct: v.memoryPct != null ? String(v.memoryPct) : '',
  };
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
    .replace(/\(\s*\)/g, '') // drop empty "()" from a missing difficulty
    .replace(/\s+\.\s+/g, ' ') // drop the stranded " . " from a missing number
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// --- dates -------------------------------------------------------------------

/**
 * Local 'YYYY-MM-DD' key for a timestamp. Local (not UTC) on purpose: the
 * streak/heatmap should reflect the user's own calendar day, so a late-night
 * solve counts for the day they experienced, not the UTC date.
 */
export function localDateKey(at: number = Date.now()): string {
  const d = new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
