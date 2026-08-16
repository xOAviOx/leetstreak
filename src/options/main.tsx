import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@/styles/tokens.css';
import './options.css';
import { Flame } from '@/popup/Flame';
import {
  getAuthenticatedUser,
  listRepos,
  createRepo,
  getRepo,
  GitHubError,
} from '@/lib/github';
import type { GitHubUser, RepoListItem } from '@/lib/github';
import { getSettings, setSettings, getStats } from '@/lib/storage';

/**
 * Options page — the real settings surface. Everything runs client-side: the
 * extension holds host permission for api.github.com, so the page validates the
 * token and manages the repo by calling GitHub's REST API directly. The token
 * lives only in chrome.storage.local; nothing is sent to a third party.
 */

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

type ConnState = 'idle' | 'checking' | 'connected' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function errMessage(e: unknown): string {
  if (e instanceof GitHubError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

function Options() {
  // Master switch
  const [enabled, setEnabled] = useState(true);

  // Connection
  const [token, setToken] = useState('');
  const [connState, setConnState] = useState<ConnState>('idle');
  const [connError, setConnError] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [showToken, setShowToken] = useState(false);

  // Repository
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selected, setSelected] = useState(''); // "owner/name"
  const [creating, setCreating] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Preferences + save
  const [autoSync, setAutoSync] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [totalSynced, setTotalSynced] = useState(0);

  useEffect(() => {
    void (async () => {
      const [s, stats] = await Promise.all([getSettings(), getStats()]);
      setEnabled(s.enabled);
      setAutoSync(s.autoSync);
      setTotalSynced(stats.totalSynced);
      if (s.repoOwner && s.repoName) setSelected(`${s.repoOwner}/${s.repoName}`);
      if (s.token) {
        setToken(s.token);
        await connect(s.token, s.repoOwner && s.repoName ? `${s.repoOwner}/${s.repoName}` : '');
      }
    })();
  }, []);

  // The master switch takes effect instantly (a power switch, not a form field).
  function toggleEnabled(next: boolean): void {
    setEnabled(next);
    void setSettings({ enabled: next });
  }

  async function connect(tok: string, keepSelected = ''): Promise<void> {
    const trimmed = tok.trim();
    if (!trimmed) return;
    setConnState('checking');
    setConnError(null);
    try {
      const u = await getAuthenticatedUser(trimmed);
      setUser(u);
      setConnState('connected');
      await loadRepos(trimmed, keepSelected);
    } catch (e) {
      setUser(null);
      setConnState('error');
      setConnError(errMessage(e));
    }
  }

  async function loadRepos(tok: string, keepSelected = ''): Promise<void> {
    setReposLoading(true);
    try {
      const list = await listRepos(tok);
      if (keepSelected && !list.some((r) => r.fullName === keepSelected)) {
        const [owner, name] = keepSelected.split('/');
        list.unshift({ fullName: keepSelected, owner, name, private: false });
      }
      setRepos(list);
    } catch (e) {
      setConnError(errMessage(e));
    } finally {
      setReposLoading(false);
    }
  }

  function disconnect(): void {
    setToken('');
    setUser(null);
    setRepos([]);
    setSelected('');
    setConnState('idle');
    setConnError(null);
    setSaveState('idle');
    void setSettings({ token: null, githubLogin: null, repoOwner: null, repoName: null, branch: null });
  }

  async function handleCreateRepo(): Promise<void> {
    const name = newRepoName.trim();
    if (!name) {
      setCreateError('Enter a repository name.');
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const info = await createRepo(token.trim(), name, newRepoPrivate);
      setRepos((prev) => [
        { fullName: info.fullName, owner: info.owner, name: info.name, private: info.private },
        ...prev,
      ]);
      setSelected(info.fullName);
      setCreating(false);
      setNewRepoName('');
    } catch (e) {
      setCreateError(errMessage(e));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleSave(): Promise<void> {
    setSaveState('saving');
    setSaveError(null);
    try {
      let repoOwner: string | null = null;
      let repoName: string | null = null;
      let branch: string | null = null;
      if (selected) {
        const [owner, name] = selected.split('/');
        const info = await getRepo(token.trim(), owner, name);
        repoOwner = info.owner;
        repoName = info.name;
        branch = info.defaultBranch;
      }
      await setSettings({
        token: token.trim() || null,
        githubLogin: user?.login ?? null,
        repoOwner,
        repoName,
        branch,
        autoSync,
      });
      setSaveState('saved');
      window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2400);
    } catch (e) {
      setSaveState('error');
      setSaveError(errMessage(e));
    }
  }

  const connected = connState === 'connected';
  const ready = connected && Boolean(selected);

  return (
    <main class={`options ${enabled ? '' : 'options--paused'}`}>
      <header class="options__head">
        <Flame size={22} intensity={enabled ? 0.7 : 0.15} />
        <span class="options__wordmark">LeetStreak</span>
        <span class="options__version">Settings</span>
      </header>

      {/* Master switch */}
      <div class="masterbar">
        <div class="masterbar__text">
          <span class="masterbar__title">{enabled ? 'LeetStreak is active' : 'LeetStreak is paused'}</span>
          <span class="masterbar__sub">
            {enabled
              ? 'Accepted solutions are captured and synced to GitHub.'
              : 'Submissions are ignored until you switch this back on.'}
          </span>
        </div>
        <label class="switch switch--lg" title={enabled ? 'Turn off' : 'Turn on'}>
          <input
            type="checkbox"
            checked={enabled}
            onInput={(e) => toggleEnabled((e.currentTarget as HTMLInputElement).checked)}
          />
          <span class="switch__track">
            <span class="switch__thumb" />
          </span>
        </label>
      </div>

      <div class={enabled ? '' : 'dimmed'}>
        <h1 class="options__title">Connect GitHub</h1>
        <p class="options__lede">
          Two minutes of setup, then every Accepted solution commits itself. Your token stays in this
          browser and talks straight to GitHub — no middleman.
        </p>

        {/* Step 1 — token */}
        <section class="card">
          <div class="card__head">
            <span class="step">1</span>
            <h2 class="card__title">Create &amp; paste a GitHub token</h2>
          </div>

          {connected && user ? (
            <div class="row-between">
              <div class="user">
                <img class="user__avatar" src={user.avatarUrl} alt="" />
                <span class="user__login">@{user.login}</span>
                <span class="status status--ok">
                  <span class="dot dot--ok" /> Connected
                </span>
              </div>
              <button type="button" class="btn btn--danger" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          ) : (
            <>
              <div class="callout">
                <ol class="steps-list">
                  <li>
                    Open GitHub's token page:{' '}
                    <a class="link" href={TOKEN_URL} target="_blank" rel="noreferrer noopener">
                      Create fine-grained token ↗
                    </a>
                  </li>
                  <li>
                    <strong>Repository access</strong> → “Only select repositories” → pick your
                    solutions repo (or choose “All repositories”).
                  </li>
                  <li>
                    <strong>Repository permissions</strong> → set the ones below, then click{' '}
                    <em>Generate token</em>.
                  </li>
                  <li>Copy the token (it starts with <span class="mono">github_pat_</span>) and paste it here.</li>
                </ol>
                <div class="perm-chips">
                  <span class="chip chip--req">
                    Contents<span class="chip__sep">·</span>Read and write
                    <span class="chip__tag">required</span>
                  </span>
                  <span class="chip">
                    Administration<span class="chip__sep">·</span>Read and write
                    <span class="chip__tag chip__tag--muted">only to create a repo from here</span>
                  </span>
                </div>
              </div>

              <label class="field-label" for="ls-token">
                Paste your token
              </label>
              <div class="field__row">
                <input
                  id="ls-token"
                  class="input input--mono"
                  type={showToken ? 'text' : 'password'}
                  autocomplete="off"
                  spellcheck={false}
                  placeholder="github_pat_11ABCDE…"
                  value={token}
                  onInput={(e) => setToken((e.currentTarget as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="btn btn--icon"
                  title={showToken ? 'Hide token' : 'Show token'}
                  onClick={() => setShowToken((v) => !v)}
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  class="btn btn--primary"
                  disabled={connState === 'checking' || !token.trim()}
                  onClick={() => void connect(token)}
                >
                  {connState === 'checking' ? 'Checking…' : 'Connect'}
                </button>
              </div>
              {connState === 'error' && connError && <p class="error-text">{connError}</p>}
            </>
          )}
        </section>

        {/* Step 2 — repo */}
        <section class={`card ${connected ? '' : 'card--disabled'}`}>
          <div class="card__head">
            <span class="step">2</span>
            <h2 class="card__title">Choose the destination repo</h2>
          </div>
          <p class="card__hint">Each accepted solution is committed here, one file per problem.</p>

          <div class="field__row">
            <select
              class="select"
              value={selected}
              disabled={!connected || reposLoading}
              onChange={(e) => setSelected((e.currentTarget as HTMLSelectElement).value)}
            >
              <option value="">{reposLoading ? 'Loading repositories…' : 'Select a repository…'}</option>
              {repos.map((r) => (
                <option value={r.fullName} key={r.fullName}>
                  {r.fullName}
                  {r.private ? ' · private' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              class="btn"
              disabled={!connected || createBusy}
              onClick={() => setCreating((c) => !c)}
            >
              {creating ? 'Cancel' : 'New repo'}
            </button>
          </div>

          {creating && (
            <div class="create-form">
              <input
                class="input"
                type="text"
                placeholder="leetcode-solutions"
                value={newRepoName}
                onInput={(e) => setNewRepoName((e.currentTarget as HTMLInputElement).value)}
              />
              <label class="checkbox-inline">
                <input
                  type="checkbox"
                  checked={newRepoPrivate}
                  onInput={(e) => setNewRepoPrivate((e.currentTarget as HTMLInputElement).checked)}
                />
                Make it private
              </label>
              <p class="card__hint" style={{ margin: 0 }}>
                Creating from here needs <span class="mono">Administration: Read and write</span> on the
                token. Simplest alternative: make the repo on GitHub, then pick it above.
              </p>
              {createError && <p class="error-text">{createError}</p>}
              <div>
                <button
                  type="button"
                  class="btn btn--primary"
                  disabled={createBusy}
                  onClick={() => void handleCreateRepo()}
                >
                  {createBusy ? 'Creating…' : 'Create repository'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Step 3 — preferences */}
        <section class={`card ${connected ? '' : 'card--disabled'}`}>
          <div class="card__head">
            <span class="step">3</span>
            <h2 class="card__title">Sync behavior</h2>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              checked={autoSync}
              onInput={(e) => setAutoSync((e.currentTarget as HTMLInputElement).checked)}
            />
            <span class="switch__track">
              <span class="switch__thumb" />
            </span>
            <span class="switch__label">
              Auto-sync accepted solutions
              <small>
                {autoSync
                  ? 'Every Accepted verdict pushes automatically.'
                  : 'Solutions wait in a queue until you press Sync in the popup.'}
              </small>
            </span>
          </label>
        </section>

        <div class="actions">
          <button
            type="button"
            class="btn btn--primary"
            disabled={!connected || saveState === 'saving'}
            onClick={() => void handleSave()}
          >
            {saveState === 'saving' ? 'Saving…' : 'Save settings'}
          </button>
          {saveState === 'saved' && (
            <span class="saved">
              <span class="dot dot--ok" /> Saved
            </span>
          )}
          {ready ? (
            <span class="status status--ok">Ready — solutions will sync to {selected}.</span>
          ) : (
            <span class="status">
              <span class="dot" /> {connected ? 'Pick a repository to finish.' : 'Connect GitHub to begin.'}
            </span>
          )}
        </div>
        {saveState === 'error' && saveError && <p class="error-text">{saveError}</p>}
      </div>

      <footer class="options__foot">
        {totalSynced > 0
          ? `${totalSynced} solution${totalSynced === 1 ? '' : 's'} synced so far · v0.1.0`
          : 'LeetStreak v0.1.0'}
      </footer>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<Options />, root);
