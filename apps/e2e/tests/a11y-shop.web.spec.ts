import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { APIRequestContext } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';
import { blockingViolations, runAxe, staleBaseline } from './support/axe';
import { A11Y_BRAND_SLUG, A11Y_STOREFRONT_SLUG, assertSeededOnCi, seedDatabaseUrl, seedShopScreens } from './support/a11y-db';
import { mockFlashSlots } from './support/flash-slot-mocks';
import { mockCollectable } from './support/voucher-mocks';

/**
 * Web khách, axe smoke 375px bảy màn mua sắm (bản web của a11y-shop.miniapp.spec.ts; P17b, review/a11y.md C7): Trang chủ, Danh mục (hub và danh sách), chi tiết sản phẩm,
 * gian hàng CTV, thương hiệu, Ưu đãi, Giờ vàng. WCAG AA; chỉ `serious`/`critical` chặn; vi phạm có sẵn ở support/a11y-baseline.ts kèm lý do.
 * Ưu đãi và Giờ vàng chạy hoàn toàn bằng mock phía trình duyệt. Chi tiết sản phẩm, gian hàng và thương hiệu do máy chủ web dựng từ API thật: `seedShopScreens()`
 * bảo đảm DB tạm (web-gate.sh, job CI) có thương hiệu, sản phẩm và gian hàng công khai, nên ở đó trang 404 là LỖI chứ không được bỏ qua. Chỉ khi DB không phải
 * DB tạm (máy dev chạy vào DB dùng chung) mới bỏ qua, kèm lý do; trên GitHub Actions không seed được thì beforeAll ném lỗi (assertSeededOnCi). Trang chủ và Danh mục (danh sách) đợi thẻ sản phẩm dựng xong rồi mới đo, hub Danh mục đợi nút "Xem tất cả sản phẩm": không đo khung rỗng.
 * Host phải là localhost (baseURL) vì middleware coi nhãn đầu của Host là subdomain gian hàng.
 */
test.use({ viewport: { width: 375, height: 812 } });

const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const TILE = '[data-ds="product-tile"]';
/** Nút "Lưu mã" chỉ có khi khối Nhận mã đã dựng thẻ: đợi tiêu đề khối Giờ vàng thì axe quét lúc mã chưa có. */
const VOUCHER_READY = 'button:has-text("Lưu mã")';

/** Slug của sản phẩm đầu tiên API thật trả về, hoặc null khi DB chưa có sản phẩm nào (cùng cách với pdp-mobile.web.spec.ts). */
async function firstProductSlug(request: APIRequestContext): Promise<string | null> {
  const res = await request.get(`${API_ORIGIN}/api/products?limit=1`).catch(() => null);
  if (!res?.ok()) return null;
  return ((await res.json()) as { data?: { slug: string }[] }).data?.[0]?.slug ?? null;
}

let seeded = false;
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'Web Customer Mobile') return;
  seeded = await seedShopScreens();
  assertSeededOnCi(seeded);
});

const HOUR = 3_600_000;
const mockFlash = (api: MockApi): void => {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
};

interface Screen {
  name: string;
  /** Đường dẫn; null = chưa có dữ liệu thật để mở (chỉ xảy ra khi DB không phải DB tạm, xem `seeded`). */
  path(request: APIRequestContext): Promise<string | null>;
  ready: string;
  /** Trang do máy chủ web dựng từ API thật: cần dữ liệu thật trong DB. */
  needsServerData?: boolean;
  setup(api: MockApi): void;
}

const fixed = (path: string) => async () => path;

const SCREENS: Screen[] = [
  { name: 'Trang chủ', path: fixed('/'), ready: TILE, setup: (api) => { mockDiscovery(api, { returning: true }); mockFlash(api); } },
  // Hub: kệ Bán chạy nhất do máy chủ dựng từ API thật và chỉ hiện khi có từ 3 món bán chạy, nên đợi nút "Xem tất cả sản phẩm" (luôn có) chứ không đợi thẻ.
  { name: 'Danh mục', path: fixed('/san-pham'), ready: '#browse-see-all button', setup: (api) => mockDiscovery(api, { tree: true }) },
  // Danh sách (`all=1`): máy chủ dựng thẻ từ sản phẩm thật nên luôn có thẻ để đo.
  { name: 'Danh mục (danh sách)', path: fixed('/san-pham?all=1'), ready: TILE, setup: (api) => mockDiscovery(api, { tree: true }) },
  {
    name: 'Chi tiết sản phẩm', ready: 'h1', needsServerData: true, setup: (api) => mockDiscovery(api),
    path: async (request) => { const slug = await firstProductSlug(request); return slug ? `/san-pham/${slug}` : null; },
  },
  { name: 'Gian hàng CTV', path: fixed(`/s/${A11Y_STOREFRONT_SLUG}`), ready: 'h1', needsServerData: true, setup: (api) => mockDiscovery(api) },
  { name: 'Thương hiệu', path: fixed(`/brand/${A11Y_BRAND_SLUG}`), ready: 'h1', needsServerData: true, setup: (api) => mockDiscovery(api) },
  { name: 'Ưu đãi', path: fixed('/uu-dai'), ready: VOUCHER_READY, setup: (api) => { mockFlash(api); mockCollectable(api); } },
  { name: 'Giờ vàng', path: fixed('/gio-vang'), ready: '[data-ds="product-tile"][data-ds-variant="line"]', setup: (api) => mockFlashSlots(api) },
];

test.describe('axe smoke web 375px: serious/critical', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ 375px chỉ chạy ở project Web Customer Mobile');
  });

  for (const screen of SCREENS) {
    test(screen.name, async ({ page, api, request }) => {
      screen.setup(api);
      const path = await screen.path(request);
      if (path === null) {
        expect(seeded, `${screen.name}: DB tạm đã seed mà API không trả sản phẩm nào`).toBe(false);
        test.skip(true, `${screen.name}: DB không phải DB tạm nên không seed, và chưa có sản phẩm nào`);
      }
      const response = await page.goto(path!);
      if (screen.needsServerData === true && !seeded && response?.status() === 404) test.skip(true, `${screen.name}: DB không phải DB tạm nên không seed, trang 404`);
      expect(response?.status(), `${screen.name}: ${path}`).toBe(200);
      await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      const found = await runAxe(page);
      expect(blockingViolations('web', screen.name, found)).toEqual([]);
      expect(staleBaseline('web', screen.name, found)).toEqual([]);
    });
  }
});

test.describe('axe smoke web: bài tự kiểm', () => {
  test('nút không tên chèn vào trang thì bị bắt (button-name, critical)', async ({ page, api, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ 375px chỉ chạy ở project Web Customer Mobile');
    const screen = SCREENS.find((s) => s.name === 'Ưu đãi')!;
    screen.setup(api);
    await page.goto((await screen.path(request))!);
    await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button id="axe-probe"></button>'));
    const found = await runAxe(page);
    const lines = blockingViolations('web', screen.name, found);
    expect(lines.some((l) => l.includes('button-name') && l.includes('axe-probe'))).toBe(true);
  });
});

test.describe('axe smoke web: rào seed', () => {
  test('seedDatabaseUrl: process.env thắng, thiếu thì rơi về apps/api/.env như job CI', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'a11y-env-')), '.env');
    writeFileSync(file, 'NODE_ENV=test\n# ghi chú\nDATABASE_URL="postgresql://tubu:tubu@localhost:5434/tubutree"\n');
    expect(seedDatabaseUrl({}, file)).toBe('postgresql://tubu:tubu@localhost:5434/tubutree');
    expect(seedDatabaseUrl({ DATABASE_URL: 'postgresql://x' }, file)).toBe('postgresql://x');
    expect(seedDatabaseUrl({}, path.join(path.dirname(file), 'khong-co.env'))).toBe('');
  });

  test('assertSeededOnCi: trên CI không seed được thì đỏ, ngoài CI thì để spec bỏ qua có lý do', () => {
    expect(() => assertSeededOnCi(false, { GITHUB_ACTIONS: 'true' })).toThrow(/seedShopScreens/);
    expect(() => assertSeededOnCi(true, { GITHUB_ACTIONS: 'true' })).not.toThrow();
    expect(() => assertSeededOnCi(false, {})).not.toThrow();
  });
});
