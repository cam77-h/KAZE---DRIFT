import { defineConfig } from 'vitest/config';

// base './' keeps every asset path relative, so the build runs from any static host
// (including a GitHub Pages project subpath) without knowing the URL ahead of time.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
