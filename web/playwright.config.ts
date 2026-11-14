import { defineConfig } from '@playwright/test';

// The browser tests run against their own API (port 8001) on the fixture database with the
// stub embedder, and their own Vite server (port 5174), so a demo running on the usual ports
// is left alone.
const API = 'http://127.0.0.1:8001';
const WEB = 'http://127.0.0.1:5174';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: { baseURL: WEB, viewport: { width: 1440, height: 900 } },
  webServer: [
    {
      command:
        'cd .. && .venv/bin/python -m wikilens.fixture --db wikilens_e2e && ' +
        'WIKILENS_DB_NAME=wikilens_e2e WIKILENS_EMBEDDER=stub WIKILENS_API_PORT=8001 .venv/bin/python -m wikilens.api',
      url: `${API}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `WIKILENS_API_URL=${API} pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort`,
      url: WEB,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
