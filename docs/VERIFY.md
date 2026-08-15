# Verifying LeetStreak locally

## Build & load

```bash
npm install
npm run build          # two passes: interceptor IIFE -> public/, then crxjs -> dist/
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `dist/` folder.

## Phase 1 — detection pipeline (automated + live)

**Automated** (already wired, no browser needed):

```bash
npm test
```

This drives the real interceptor module against mocked `fetch` / `XMLHttpRequest`
and asserts an accepted submission emits exactly one message across repeated
polls, on both the fetch and XHR paths, with unicode code preserved.

**Live confirmation** (the Phase-1 gate — needs a human on leetcode.com):

1. Load `dist/` unpacked (above).
2. Open the service worker console: `chrome://extensions` → LeetStreak →
   **service worker** → *inspect*.
3. Open any problem, e.g. `https://leetcode.com/problems/two-sum/`.
4. In the page console you should see:
   - `[LeetStreak] content bridge listening (ISOLATED world)`
   - `[LeetStreak] interceptor armed (MAIN world)` (logged from the injected script)
5. Submit a solution and get **Accepted**.
6. In the **service worker** console you should see exactly one line:
   `[LeetStreak] ✅ ACCEPTED submission captured: { … }`
   with `titleSlug`, `lang`, percentiles, and a code preview.
7. Re-submitting the same accepted solution should **not** log again (dedupe).

If step 6 doesn't fire, check the page console for the two "armed"/"listening"
logs first — that isolates whether injection or detection is the problem.

> Note: LeetCode occasionally changes its submission response shape. The field
> names live in one place — `src/lib/detect.ts` (`RawCheckResponse`) — so that's
> the only file to adjust if the verdict stops being detected. Cross-check
> against raphaelheinz/LeetHub-3.0's interceptor if fields move.
