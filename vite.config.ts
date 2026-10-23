import { defineConfig } from 'vite';

// Test harness runs set A4N_TEST_SERVER=1: no HMR/full reloads while other
// contributors edit files, so browser tests see a stable snapshot.
const testServer = process.env.A4N_TEST_SERVER === '1';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    hmr: testServer ? false : undefined,
    watch: testServer ? { ignored: ['**/*'] } : undefined,
  },
  preview: { host: '127.0.0.1', port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
