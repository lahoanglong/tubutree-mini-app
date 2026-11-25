import { defineConfig, devices } from '@playwright/test';

/**
 * Bộ trước gửi duyệt Zalo (tubu-w36-02) trên bản build Mini thật `apps/miniapp/www`: mã đã minify, chunk tải lười thật, plugin gom chuỗi và shim chỉ
 * có ở bản build. `vite preview` phục vụ dưới /zapps/undefined/ như ZMPRouter production (scripts/serve-mini-www.mjs); API mock toàn bộ như project
 * "Zalo Mini App" của playwright.config.ts. Chạy các spec `pre-submit-*.miniapp.spec.ts` (đường dẫn qua `miniPath`) và khói bản build.
 * Build Mini trước (có `.env.production` như gói ZMP): `pnpm --filter @tubutree/miniapp build`, rồi
 *   npx playwright test -c playwright.mini-www.config.ts
 */
const PORT = process.env.E2E_MINI_WWW_PORT ?? '3123';
const BASE = '/zapps/undefined';
process.env.E2E_MINI_BASE = BASE;

export default defineConfig({
  testDir: './tests',
  testMatch: [/pre-submit-.*\.miniapp\.spec\.ts/, /pre-submit-mini-www\.smoke\.spec\.ts/],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  reporter: 'line',
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: `node scripts/serve-mini-www.mjs ${PORT}`,
    url: `http://localhost:${PORT}${BASE}/`,
    timeout: 60_000,
    reuseExistingServer: false,
  },
  projects: [{ name: 'Zalo Mini App (www)', use: { ...devices['iPhone 12'], baseURL: `http://localhost:${PORT}` } }],
});
