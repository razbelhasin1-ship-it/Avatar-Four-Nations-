import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The website (landing page, features, about, and the game itself under play/).
 *   npm run site:dev      → site dev server (the Play button points at the game dev server on :5173)
 *   npm run site:build    → dist-site/ (site) + dist-site/play/ (the game build)
 *   npm run site:preview  → serve dist-site/
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: 'public',
  server: { host: '127.0.0.1', port: 5180 },
  preview: { host: '127.0.0.1', port: 4180 },
  build: {
    outDir: '../dist-site',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // Latin subsets of the two typefaces ship inside the CSS, so the page renders in its own type
    // everywhere it is hosted (including hosts that only allow fonts from data: URIs).
    assetsInlineLimit: (file: string) => (/fontsource.*-latin-.*\.woff2$/.test(file) ? true : undefined),
  },
});
