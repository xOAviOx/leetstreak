import { useEffect, useState } from 'preact/hooks';
import { Flame } from './Flame';
import type { StateSnapshot, SyncResult } from '@/lib/types';
import { currentStreak, longestStreak, buildHeatmap } from '@/lib/streak';

const HEATMAP_WEEKS = 20;

function send<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function openOptions(): void {
  chrome.runtime.openOptionsPage();
}

/** Compact "3h ago" style relative time. */
function relativeTime(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(d / 365)}y ago`;
}

export function App() {
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      setState(await send<StateSnapshot>({ type: 'GET_STATE' }));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function syncNow(): Promise<void> {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await send<SyncResult>({ type: 'SYNC_NOW' });
      setSyncMsg(r.error ?? (r.drained > 0 ? `Synced ${r.drained}` : 'Nothing to sync'));
      await refresh();
    } catch {
      setSyncMsg('Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const stats = state?.stats;
  const dates = stats?.syncedDates ?? [];
  const streak = currentStreak(dates);
  const best = longestStreak(dates);
  const total = stats?.totalSynced ?? 0;
  const grid = buildHeatmap(dates, HEATMAP_WEEKS);
  const intensity = Math.min(1, streak / 14);

  const enabled = state?.settings.enabled ?? true;
  const autoSync = state?.settings.autoSync ?? true;
  const configured = state?.configured ?? false;
  const pending = state?.queueLength ?? 0;
  const repo =
    state?.settings.repoOwner && state?.settings.repoName
      ? `${state.settings.repoOwner}/${state.settings.repoName}`
      : null;
  const repoUrl = repo ? `https://github.com/${repo}` : null;

  return (
    <div class="popup">
      <header class="popup__head">
        <Flame size={22} intensity={enabled ? Math.max(0.3, intensity) : 0.12} />
        <span class="popup__wordmark">LeetStreak</span>
        {!enabled && <span class="pill pill--paused">Paused</span>}
        <button type="button" class="iconbtn" title="Settings" onClick={openOptions} aria-label="Settings">
          ⚙
        </button>
      </header>

      {loading ? (
        <div class="popup__empty">Loading…</div>
      ) : failed ? (
        <div class="popup__empty">
          Couldn't reach the extension worker. Try reopening the popup.
        </div>
      ) : (
        <>
          {!configured && (
            <button type="button" class="cta" onClick={openOptions}>
              <span>Connect GitHub to start your streak</span>
              <span aria-hidden="true">→</span>
            </button>
          )}

          <section class="panel panel--streak">
            <span class="label">Current streak</span>
            <div class="streak-row">
              <div class="streak-number">{streak}</div>
              <span class="streak-unit">{streak === 1 ? 'day' : 'days'}</span>
            </div>
            <p class="streak-sub">
              {best > 0 ? `Longest ${best} ${best === 1 ? 'day' : 'days'}` : 'No streak yet'}
              <span class="dotsep">·</span>
              {total} synced
            </p>
          </section>

          <section class="panel">
            <div class="heatmap" role="img" aria-label={`${total} solutions synced`}>
              {grid.map((col, i) => (
                <div class="heatmap__col" key={i}>
                  {col.map((cell) => (
                    <span
                      key={cell.date}
                      class={
                        'heatcell' +
                        (cell.active ? ' heatcell--on' : '') +
                        (cell.future ? ' heatcell--future' : '') +
                        (cell.today ? ' heatcell--today' : '')
                      }
                      title={cell.active ? `${cell.date} · synced` : cell.date}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div class="heatmap__caption">
              <span>~{Math.round((HEATMAP_WEEKS * 7) / 30)} months</span>
              <span class="legend">
                <i class="legend__cell" /> <i class="legend__cell legend__cell--on" /> synced
              </span>
            </div>
          </section>

          {stats?.last && (
            <a
              class="lastsync"
              href={stats.last.commitUrl ?? repoUrl ?? '#'}
              target="_blank"
              rel="noreferrer noopener"
            >
              <span class="lastsync__label">Last</span>
              <span class="lastsync__title">{stats.last.title}</span>
              <span class="lastsync__time">{relativeTime(stats.last.at)}</span>
            </a>
          )}

          <footer class="popup__foot">
            <div class="foot__left">
              {pending > 0 ? (
                <span class="pill pill--warn">{pending} pending</span>
              ) : repoUrl ? (
                <a class="foot__repo" href={repoUrl} target="_blank" rel="noreferrer noopener">
                  {repo}
                </a>
              ) : (
                <span class="foot__muted">Not connected</span>
              )}
              {!autoSync && configured && <span class="pill">Manual</span>}
            </div>
            <button
              type="button"
              class="btn btn--sync"
              disabled={!configured || syncing || (pending === 0 && !syncMsg)}
              onClick={() => void syncNow()}
              title={pending > 0 ? `Push ${pending} queued` : 'Nothing queued'}
            >
              {syncing ? 'Syncing…' : syncMsg ?? 'Sync now'}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
