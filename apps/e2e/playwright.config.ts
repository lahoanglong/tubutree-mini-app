import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration — Tubu Tree
 *
 * Ports (khớp với apps/api/.env, web/package.json, miniapp/package.json):
 *   API      → http://localhost:3111  (NestJS)
 *   Web Admin → http://localhost:3112 (Next.js)
 *   Mini App  → http://localhost:3113 (Vite / ZMA)
 *
 * Yêu cầu trước khi test:
 *   1. Docker DB đang chạy: pnpm dev:infra (Postgres :5434, Redis :6381)
 *   2. Dev servers: Playwright TỰ start qua `webServer` bên dưới.
 *      - Local: reuseExistingServer=true → dùng lại `pnpm dev` đang chạy nếu có (không start trùng).
 *      - CI: tự spawn 3 server, chờ health trước khi chạy test.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3112', // Web Admin là default base
    trace: 'on-first-retry',
  },
  // Tự khởi động API/Web/Mini App rồi CHỜ tới khi sẵn sàng — trước đây CI chạy test khi
  // chưa có server nào listen → mọi test fail connection-refused. cwd = repo root (../..).
  webServer: [
    {
      command: 'pnpm --filter @tubutree/api dev',
      url: 'http://localhost:3111/api/health',
      cwd: '../..',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @tubutree/web dev',
      url: 'http://localhost:3112',
      cwd: '../..',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @tubutree/miniapp dev',
      url: 'http://localhost:3113',
      cwd: '../..',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: 'API',
      use: {
        baseURL: 'http://localhost:3111',
      },
      testMatch: /.*api\.spec\.ts/,
    },
    {
      name: 'Web Admin',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3112' },
      testMatch: /.*admin\.spec\.ts/,
    },
    {
      name: 'Zalo Mini App',
      use: { ...devices['iPhone 12'], baseURL: 'http://localhost:3113' },
      testMatch: /.*miniapp\.spec\.ts/,
    },
  ],
});
