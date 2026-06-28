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
 *   1. Docker DB đang chạy: pnpm dev:infra
 *   2. Dev servers đang chạy: pnpm dev (từ root)
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
