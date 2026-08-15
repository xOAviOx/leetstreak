import { render } from 'preact';
import '@/styles/tokens.css';
import './options.css';

// Phase 0 placeholder. Full options surface (token mgmt, repo, templates,
// danger zone) is built in Phase 4/5.
function Options() {
  return (
    <main class="options">
      <h1 class="options__title">LeetStreak settings</h1>
      <p class="options__lede">Settings arrive in a later phase. Scaffold is in place.</p>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<Options />, root);
