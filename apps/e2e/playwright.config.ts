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
 *   - Chỉ web (E2E_SCOPE=web): project "Web Admin", "Web Customer", "Web Customer Mobile" + webServer API
 *     và web, không Vite. Cổng đổi bằng E2E_WEB_PORT / E2E_MINIAPP_PORT / E2E_API_PORT. Chạy qua
 *     scripts/web-gate.sh (DB + Redis tạm).
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
process.env.E2E_API_PORT = API_PORT;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3112';
const MINIAPP_PORT = process.env.E2E_MINIAPP_PORT ?? '3113';
const WEB_URL = `http://localhost:${WEB_PORT}`;
const MINIAPP_URL = `http://localhost:${MINIAPP_PORT}`;
// Cổng mặc định nằm trong script `dev` của từng app: chỉ khi ghi đè cổng mới gọi thẳng bộ dựng với cổng mới.
// E2E_WEB_PROD=1 (web-gate.sh): bản build + `next start`. `next dev` dịch từng trang lúc chạy, với nhiều worker song song thì chết giữa chừng (mọi goto sau đó ERR_CONNECTION_REFUSED).
const WEB_PROD = process.env.E2E_WEB_PROD === '1';
const WEB_COMMAND = WEB_PROD
  ? `pnpm --filter @tubutree/web exec next build && pnpm --filter @tubutree/web exec next start -H 0.0.0.0 -p ${WEB_PORT}`
  : process.env.E2E_WEB_PORT
    ? `pnpm --filter @tubutree/web exec next dev -H 0.0.0.0 -p ${WEB_PORT}`
    : 'pnpm --filter @tubutree/web dev';
// E2E_LOG_DIR: ghi stdout/stderr của máy chủ API và web ra file để còn log khi máy chủ chết giữa lần chạy.
const LOG_DIR = process.env.E2E_LOG_DIR;
const withLog = (command: string, name: string) => (LOG_DIR ? `mkdir -p "${LOG_DIR}" && { ${command} ; } > "${LOG_DIR}/webserver-${name}.log" 2>&1` : command);
const MINIAPP_COMMAND = process.env.E2E_MINIAPP_PORT ? `pnpm --filter @tubutree/miniapp exec vite --host 0.0.0.0 --port ${MINIAPP_PORT}` : 'pnpm --filter @tubutree/miniapp dev';

// `test:miniapp` (package.json) không cần cross-env: npm/pnpm đặt npm_lifecycle_event = tên script.
const miniappOnly =
  process.env.E2E_SCOPE === 'miniapp' || process.env.npm_lifecycle_event === 'test:miniapp';

// E2E_SCOPE=web: chỉ API + web (khách, admin), không dựng Vite Mini App. Dùng trong web-gate.sh.
const webOnly = process.env.E2E_SCOPE === 'web';
const webAdminOnly = process.env.E2E_SCOPE === 'web-admin';

type WebServer = NonNullable<Exclude<PlaywrightTestConfig['webServer'], unknown[]>>;

const apiServer: WebServer = {
  command: withLog('pnpm --filter @tubutree/api dev', 'api'),
  url: `${API_URL}/api/health`,
  cwd: '../..',
  // PORT truyền thẳng: main.ts đọc process.env.PORT → server Playwright spawn nghe đúng cổng đang chờ.
  env: { PORT: API_PORT },
  timeout: 180_000,
  reuseExistingServer: !process.env.CI,
};
const webServer: WebServer = {
  command: withLog(WEB_COMMAND, 'web'),
  url: WEB_URL,
  cwd: '../..',
  // Web admin gọi đúng API vừa start (mặc định next.config.mjs là :3001). NEXT_PUBLIC_* được nhúng lúc build nên phải có sẵn ở đây.
  // NODE_ENV=production: web-gate.sh export NODE_ENV=test cho API, `next build` không chạy đúng với giá trị đó.
  env: {
    NEXT_PUBLIC_API_BASE_URL: `${API_URL}/api`,
    API_BASE_URL: `${API_URL}/api`,
    ...(WEB_PROD ? { NODE_ENV: 'production' } : {}),
  },
  timeout: WEB_PROD ? 600_000 : 180_000,
  reuseExistingServer: !process.env.CI,
};
const miniappServer: WebServer = {
  command: MINIAPP_COMMAND,
  url: MINIAPP_URL,
  cwd: '../..',
  timeout: 180_000,
  reuseExistingServer: !process.env.CI,
};

// Spec tham quan chỉ để chụp ảnh so giao diện: không đưa vào CI làm ca skipped.
const VISUAL_TOUR = process.env.VISUAL_DIR ? [] : [/visual-tour\./];
// Spec ghi dữ liệu dùng chung vào DB tạm, chạy ở project riêng sau khi hai project web khách xong, và nối tiếp nhau:
// - gieo đợt Giờ vàng thật: trong lúc đợt còn (và 60 giây cache fetch của Next sau đó) mọi trang server dựng, Trang chủ trước hết, đều nhúng khối Giờ vàng
//   mà spec khác mock là rỗng ở trình duyệt, nên bố cục nhảy;
// - gán ảnh tạm cho mọi sản phẩm chưa có ảnh: Trang chủ, PDP, hub server dựng đều đổi ảnh.
// Chạy riêng một tệp: thêm `--project="<tên project>" --no-deps`, nếu không Playwright chạy cả hai project web khách trước.
const FLASH_DB_SPEC = /pdp-flash-cls\.web\.spec\.ts/;
const THUMBS_DB_SPEC = /lcp-priority-db\.web\.spec\.ts/;
const DB_SPECS = [FLASH_DB_SPEC, THUMBS_DB_SPEC];

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
    testMatch: [/.*admin\.spec\.ts/, /.*admin-analytics\.spec\.ts/, /.*admin-customer-refunds\.spec\.ts/, /.*admin-external-claims\.spec\.ts/, /.*admin-waste\.spec\.ts/, /.*admin-support-chat\.spec\.ts/, /.*admin-all-tabs\.spec\.ts/, /.*admin-category-tree\.spec\.ts/, /.*admin-campaign-health\.spec\.ts/, /.*admin-uat-1440\.spec\.ts/, /.*admin-uat-r2\.spec\.ts/],
  },
  {
    name: 'Web Customer',
    use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
    testMatch: /.*\.web\.spec\.ts/,
    testIgnore: [...VISUAL_TOUR, ...DB_SPECS],
  },
  {
    name: 'Web Customer Mobile',
    use: { ...devices['Pixel 7'], baseURL: WEB_URL },
    // ds-parity.shop.spec.ts chạy ở project này và ở "Zalo Mini App": mỗi bên đo trang của mình so với bảng chuẩn chung (support/ds-parity.ts).
    testMatch: [/.*\.web\.spec\.ts/, /.*ds-parity\.shop\.spec\.ts/],
    testIgnore: [...VISUAL_TOUR, ...DB_SPECS],
  },
  {
    // Chỉ chạy khi hai project trên đã xong (và xanh): không trang web khách nào khác được dựng trong lúc đợt Giờ vàng gieo còn sống.
    name: 'Web Customer Flash DB',
    use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
    testMatch: FLASH_DB_SPEC,
    dependencies: ['Web Customer', 'Web Customer Mobile'],
  },
  {
    // Sau project Giờ vàng (không chồng nhau: đợt gieo dùng sản phẩm thật, ảnh gán tạm đổi PDP của nó). Khổ điện thoại như project Mobile.
    name: 'Web Customer Thumbs DB',
    use: { ...devices['Pixel 7'], baseURL: WEB_URL },
    testMatch: THUMBS_DB_SPEC,
    dependencies: ['Web Customer Flash DB'],
  },
  {
    name: 'Zalo Mini App',
    use: { ...devices['iPhone 12'], baseURL: MINIAPP_URL },
    testMatch: [/.*miniapp\.spec\.ts/, /.*ds-parity\.shop\.spec\.ts/],
  },
];

export default defineConfig({
  testDir: './tests',
  // Project nào tự đặt testIgnore thì thay hẳn dòng này, nên các project đó gộp VISUAL_TOUR vào danh sách của mình.
  testIgnore: VISUAL_TOUR,
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
  webServer: miniappOnly
    ? [miniappServer]
    : webOnly
      ? [apiServer, webServer]
      : webAdminOnly
        ? [{ ...webServer, url: `${WEB_URL}/admin` }]
        : [apiServer, webServer, miniappServer],
  projects: miniappOnly
    ? allProjects.filter((p) => p.name === 'Zalo Mini App')
    : webOnly
      ? allProjects.filter((p) => p.name?.startsWith('Web '))
      : webAdminOnly
        ? allProjects.filter((p) => p.name === 'Web Admin')
        : allProjects,
});
