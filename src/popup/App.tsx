import { Flame } from './Flame';

// Phase 0 hello-world popup. Establishes the shell + identity; the real streak
// dashboard (wired to chrome.storage) lands in Phase 3.
export function App() {
  return (
    <div class="popup">
      <header class="popup__head">
        <Flame size={22} intensity={0.6} />
        <span class="popup__wordmark">LeetStreak</span>
        <span class="popup__version">v0.1.0</span>
      </header>

      <section class="panel panel--streak">
        <span class="label">Current streak</span>
        <div class="streak-number">0</div>
        <p class="popup__hint">No solves yet — your next Accepted lands here.</p>
      </section>

      <footer class="popup__foot">
        <span class="label">Scaffold ready · Phase 0</span>
      </footer>
    </div>
  );
}
