import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * First build pass: bundle the MAIN-world interceptor into a single,
 * self-contained IIFE at a STABLE path (public/interceptor.js). The subsequent
 * crxjs build treats public/ as static assets and copies it to
 * dist/interceptor.js, which the content script injects via
 * chrome.runtime.getURL('interceptor.js').
 *
 * emptyOutDir:false so we don't wipe public/icons. Run BEFORE the main build
 * (see package.json "build").
 */
export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: 'public',
    target: 'esnext',
    minify: true,
    lib: {
      entry: resolve(__dirname, 'src/interceptor/interceptor.ts'),
      name: 'LeetStreakInterceptor',
      formats: ['iife'],
      fileName: () => 'interceptor.js',
    },
    rollupOptions: {
      output: {
        // Keep it one file; no code-splitting for an injected script.
        inlineDynamicImports: true,
      },
    },
  },
});
