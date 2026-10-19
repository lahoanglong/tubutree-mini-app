import { readFileSync } from 'fs';
import path from 'path';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

/**
 * Playwright E2E Configuration — Tubu Tree
 *
 * Ports:
 *   API       → PORT trong apps/api/.env (dev local: 3001 — cũng là mặc định mà miniapp
 *               src/services/api.ts và web next.config.mjs gọi tới; CI e2e.yml ghi PORT=3111).
 *               Ghi đè bằng E2E_API_PORT nếu cần.
 *   Web Admin / Web Customer → http://localhost:3112 (Next.js, apps/web/package.json)
 *   Mini App  → http://localhost:3113 (Vite / ZMA, apps/miniapp/package.json)
 *   Ghi đè bằng E2E_WEB_PORT / E2E_MINIAPP_PORT khi máy dùng chung và cổng mặc định đang bị
 *   chương trình khác giữ (reuseExistingServer sẽ dùng nhầm server lạ).
 *
 * Phạm vi chạy:
 *   - Mặc định: cả 4 project (API, Web Admin, Web Customer, Zalo Mini App) + 3 webServer.
 *     Cần Docker DB (pnpm dev:infra: Postgres :5434, Redis :6381).
 *   - Chỉ miniapp (E2E_SCOPE=miniapp, hoặc `pnpm --filter @tubutree/e2e test:miniapp`):
 *     chỉ project "Zalo Mini App" + chỉ webServer Vite. Các spec miniapp mock toàn bộ API
 *     (tests/support/mock-api.ts) nên KHÔNG cần API/DB. Project API / Web Admin bị bỏ hẳn
 *     (trước đây chỉ bỏ server nên api.spec/admin.spec vẫn chạy và fail connection-refused).
 *   - Chỉ web admin (E2E_SCOPE=web-admin): chỉ project "Web Admin" + chỉ webServer Next. Các spec admin mock mọi lệnh gọi /api/ nên KHÔNG cần API/DB.
 *
 * webServer: Local reuseExistingServer=true → dùng lại `pnpm dev` đang chạy nếu có; CI tự spawn
 * rồi chờ health trước khi chạy test.
 */

/** Đọc PORT từ apps/api/.env (cùng file global-setup.ts đọc JWT secret). */
function apiPortFromEnvFile(): string | undefined {
  try {
    const content = readFileSync(path.resolve(__dirname, '../api/.env'), 'utf-8');
    const m = /^\s*PORT\s*=\s*["']?(\d+)["']?\s*$/m.exec(content);
    return m?.[1];
  } catch {
    return undefined;
  }
}

const API_PORT = process.env.E2E_API_PORT ?? apiPortFromEnvFile() ?? '3001';
const API_URL = `http://localhost:${API_PORT}`;
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3112';
const MINIAPP_PORT = process.env.E2E_MINIAPP_PORT ?? '3113';
const WEB_URL = `http://localhost:${WEB_PORT}`;
const MINIAPP_URL = `http://localhost:${MINIAPP_PORT}`;
// Cổng mặc định nằm trong script `dev` của từng app: chỉ khi ghi đè cổng mới gọi thẳng bộ dựng với cổng mới.
const WEB_COMMAND = process.env.E2E_WEB_PORT ? `pnpm --filter @tubutree/web exec next dev -H 0.0.0.0 -p ${WEB_PORT}` : 'pnpm --filter @tubutree/web dev';
const MINIAPP_COMMAND = process.env.E2E_MINIAPP_PORT ? `pnpm --filter @tubutree/miniapp exec vite --host 0.0.0.0 --port ${MINIAPP_PORT}` : 'pnpm --filter @tubutree/miniapp dev';

// `test:miniapp` (package.json) không cần cross-env: npm/pnpm đặt npm_lifecycle_event = tên script.
const miniappOnly =
  process.env.E2E_SCOPE === 'miniapp' || process.env.npm_lifecycle_event === 'test:miniapp';

const webAdminOnly = process.env.E2E_SCOPE === 'web-admin';

type WebServer = NonNullable<Exclude<PlaywrightTestConfig['webServer'], unknown[]>>;

const apiServer: WebServer = {
  command: 'pnpm --filter @tubutree/api dev',
  url: `${API_URL}/api/health`,
  cwd: '../..',
  // PORT truyền thẳng: main.ts đọc process.env.PORT → server Playwright spawn nghe đúng cổng đang chờ.
  env: { PORT: API_PORT },
  timeout: 180_000,
  reuseExistingServer: !process.env.CI,
};
const webServer: WebServer = {
  command: WEB_COMMAND,
  url: WEB_URL,
  cwd: '../..',
  // Web admin gọi đúng API vừa start (mặc định next.config.mjs là :3001).
  env: { NEXT_PUBLIC_API_BASE_URL: `${API_URL}/api` },
  timeout: 180_000,
  reuseExistingServer: !process.env.CI,
};
const miniappServer: WebServer = {
  command: MINIAPP_COMMAND,
  url: MINIAPP_URL,
  cwd: '../..',
  timeout: 180_000,
  reuseExistingServer: !process.env.CI,
};

const allProjects: NonNullable<PlaywrightTestConfig['projects']> = [
  {
    name: 'API',
    // Dấu "/" cuối: request.get('health') → /api/health (path tương đối, KHÔNG bắt đầu bằng "/").
    use: { baseURL: `${API_URL}/api/` },
    testMatch: /.*api\.spec\.ts/,
  },
  {
    name: 'Web Admin',
    use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
    // Mảng: "admin.spec.ts" (spec gốc) + "admin-analytics.spec.ts" (Task 21) — regex đơn trước đây
    // chỉ khớp đúng "admin.spec.ts" nên file spec admin mới thứ 2 bị bỏ sót hoàn toàn (không match
    // project nào cả → CI `playwright test` không chạy, không báo lỗi).
    testMatch: [/.*admin\.spec\.ts/, /.*admin-analytics\.spec\.ts/, /.*admin-customer-refunds\.spec\.ts/, /.*admin-external-claims\.spec\.ts/, /.*admin-waste\.spec\.ts/],
  },
  {
    name: 'Web Customer',
    use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
    testMatch: /.*\.web\.spec\.ts/,
  },
  {
    name: 'Zalo Mini App',
    use: { ...devices['iPhone 12'], baseURL: MINIAPP_URL },
    testMatch: /.*miniapp\.spec\.ts/,
  },
];

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: WEB_URL, // Web Admin là default base
    trace: 'on-first-retry',
  },
  // Tự khởi động server cần thiết rồi CHỜ tới khi sẵn sàng. cwd = repo root (../..).
  webServer: miniappOnly ? [miniappServer] : webAdminOnly ? [{ ...webServer, url: `${WEB_URL}/admin` }] : [apiServer, webServer, miniappServer],
  projects: miniappOnly ? allProjects.filter((p) => p.name === 'Zalo Mini App') : webAdminOnly ? allProjects.filter((p) => p.name === 'Web Admin') : allProjects,
});
