import { defineConfig } from 'vitest/config';

// The page talks to the Python API through /api, so the browser sees one origin.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The pure logic. View and animation code is covered by the browser tests instead.
      include: ['src/time.ts', 'src/diff.ts', 'src/wordingCache.ts', 'src/api.ts', 'src/scrub.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
