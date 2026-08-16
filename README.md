#  LeetStreak

**Auto-push your accepted LeetCode solutions to GitHub — and keep your streak alive.**

LeetStreak is a Chrome extension that watches for **Accepted** submissions on LeetCode and quietly commits each solution to a GitHub repo of your choice. Every solve becomes a commit, so your problem-solving shows up on your GitHub contribution graph — and inside the extension's own streak dashboard.

No copy-pasting, no manual commits. Solve it, and it's on GitHub before you've closed the tab.

---

## Features

- **Automatic commits** — every Accepted solution is pushed as a commit, one file per problem.
- **Streak dashboard** — a popup with your current streak, longest streak, total solved, and a contribution heatmap.
- **On-page toast** — a live "Syncing… → Pushed to GitHub" notification with a link straight to the commit.
- **Fine-grained & private** — your GitHub token lives only in your browser and talks directly to GitHub's API. Nothing passes through a third-party server.
- **Pause anytime** — a master on/off switch, plus an auto-sync toggle if you'd rather push manually.
- **Never loses a solve** — offline, rate-limited, or not yet configured? Solutions queue and sync later.

---

## How it works

When you submit on LeetCode, a page interceptor reads the accepted verdict straight from LeetCode's own response (never scraped from the editor), hands it to the extension's background worker, which builds the file and commits it to your repo via the GitHub Contents API. A submission is only ever pushed once.

```
LeetCode submit  →  interceptor  →  content bridge  →  service worker  →  GitHub commit
                                                              └→ on-page toast + streak stats
```

---

## Install

> LeetStreak isn't on the Chrome Web Store yet — you run it as an unpacked extension.

### Prerequisites

- **Node.js 22+** (the build and tests rely on it)
- Google Chrome (or any Chromium browser)

### Build & load

```bash
npm install
npm run build          # outputs the extension to dist/
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked** and select the `dist/` folder

---

## Setup (connect GitHub)

Open the extension's **Options** page (right-click the icon → **Options**, or `chrome://extensions` → LeetStreak → **Details** → **Extension options**) and follow the three steps. In short:

1. **Create a GitHub token.** Make a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - **Repository access** → select the repo you want your solutions in (or "All repositories")
   - **Repository permissions** → **Contents: Read and write**
   - *(Only if you want to create the repo from inside the extension: also **Administration: Read and write**.)*
2. **Paste the token** and click **Connect** — it validates and shows your GitHub avatar.
3. **Pick the destination repo** (or create one), leave **Auto-sync** on, and hit **Save**.

That's it. Go solve something.

---

## Usage

Solve a problem on LeetCode and submit. When it's **Accepted**:

- a toast appears on the page: **Syncing to GitHub… → Pushed to GitHub** (with a **View commit** link), and
- the solution is committed to your repo.

Click the toolbar icon anytime to see your **streak dashboard** — current streak, longest streak, total synced, a heatmap of your synced days, and your most recent commit. If anything is queued (e.g. auto-sync was off), a **Sync now** button flushes it.

---

## Settings

| Setting | What it does |
| --- | --- |
| **Master switch** | Instantly pauses/resumes everything. When paused, submissions are ignored entirely. |
| **Auto-sync** | On: every Accepted solution pushes automatically. Off: solutions queue until you press **Sync now**. |
| **Token / repo** | Connect a GitHub token and choose (or create) the destination repository. |

Your token is stored in `chrome.storage.local` and is never logged or sent anywhere except GitHub.

---

## How solutions are stored

Each accepted solution is committed as its own file, named by the problem slug and language:

```
your-repo/
├── two-sum/
│   └── two-sum.js
├── valid-parentheses/
│   └── valid-parentheses.py
└── ...
```

Commit messages read like `Solve Two Sum`. Languages map to the right extension automatically (`python3` → `.py`, `cpp` → `.cpp`, and so on).

---

## Development

```bash
npm run dev         # Vite dev server (HMR for the popup/options UIs)
npm run build       # production build → dist/
npm run typecheck   # tsc --noEmit
npm test            # detection + sync + streak test suites
```

**Tech:** Manifest V3, [Preact](https://preactjs.com/), TypeScript, [Vite](https://vitejs.dev/) + [@crxjs/vite-plugin](https://crxjs.dev/). Pure logic (detection, GitHub client, formatting, streak math) lives in `src/lib/` and is unit-tested with plain Node scripts (`node:assert`, no build step — Node strips the TypeScript types); the interceptor, background worker, and UIs are wired on top.

```
src/
├── interceptor/   # MAIN-world hook that reads the accepted verdict
├── content/       # ISOLATED-world bridge + on-page toast
├── background/    # service worker: dedupe, GitHub push, retry queue
├── popup/         # streak dashboard
├── options/       # settings page
└── lib/           # pure, tested logic (detect, github, storage, format, streak)
```

---

## Privacy

LeetStreak talks to exactly two places: **leetcode.com** (to read your accepted submissions) and **api.github.com** (to commit them). Your token and sync history stay in your browser's local storage. There is no LeetStreak server, no analytics, and no third party in the loop.
