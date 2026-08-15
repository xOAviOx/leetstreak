import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// Manifest V3. Keep host_permissions to exactly what we need — every extra
// permission slows Chrome Web Store review and weakens the privacy story.
export default defineManifest({
  manifest_version: 3,
  name: 'LeetStreak',
  version: pkg.version,
  description: pkg.description,
  icons: {
    16: 'public/icons/16.png',
    32: 'public/icons/32.png',
    48: 'public/icons/48.png',
    128: 'public/icons/128.png',
  },
  permissions: ['storage', 'alarms'],
  host_permissions: ['https://leetcode.com/*', 'https://api.github.com/*'],
  background: {
    service_worker: 'src/background/background.ts',
    type: 'module',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'public/icons/16.png',
      32: 'public/icons/32.png',
      48: 'public/icons/48.png',
      128: 'public/icons/128.png',
    },
  },
  options_page: 'src/options/index.html',
  content_scripts: [
    {
      // ISOLATED world. Runs at document_start: it injects the MAIN-world
      // interceptor (a web-accessible resource) into the page, then bridges
      // page <-> service worker and hosts the toast.
      //
      // We inject the interceptor ourselves rather than declaring a
      // world:"MAIN" content script, because a browser-injected MAIN-world
      // script resolves its dynamic imports against the PAGE origin, which
      // breaks the module loader. A <script src=extensionURL> tag resolves
      // against the extension and is exempt from the page CSP.
      matches: ['https://leetcode.com/problems/*'],
      js: ['src/content/content.ts'],
      run_at: 'document_start',
    },
  ],
  web_accessible_resources: [
    {
      // The self-contained interceptor IIFE, injected into the page's MAIN world.
      resources: ['interceptor.js'],
      matches: ['https://leetcode.com/*'],
    },
  ],
});
