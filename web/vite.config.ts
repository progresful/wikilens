import { defineConfig } from 'vitest/config';

// The page talks to the Python API through /api, so the browser sees one origin.
// WIKILENS_API_URL points the proxy elsewhere (the browser tests use their own API).
const apiUrl = process.env.WIKILENS_API_URL ?? 'http://127.0.0.1:8000';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': apiUrl },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': apiUrl },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The pure logic. View and animation code is covered by the browser tests instead.
      include: ['src/time.ts', 'src/diff.ts', 'src/wordingCache.ts', 'src/api.ts', 'src/scrub.ts', 'src/state.ts', 'src/sections.ts', 'src/minimap.ts', 'src/closest.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
