import { test, expect, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';
import { blockingViolations, runAxe, staleBaseline } from './support/axe';
import { mockFlashSlots } from './support/flash-slot-mocks';
import { BRAND_SLUG, SHOP_SLUG } from './support/shop-page-mocks';
import { mockCollectable } from './support/voucher-mocks';

/**
 * Web khách, axe smoke 375px bảy màn mua sắm (bản web của a11y-shop.miniapp.spec.ts; P17b, review/a11y.md C7): Trang chủ, Danh mục, chi tiết sản phẩm,
 * gian hàng CTV, thương hiệu, Ưu đãi, Giờ vàng. WCAG AA; chỉ `serious`/`critical` chặn; vi phạm có sẵn ở support/a11y-baseline.ts kèm lý do.
 * Ưu đãi và Giờ vàng chạy hoàn toàn bằng mock phía trình duyệt. Trang chủ và Danh mục đo phần dựng sẵn ở máy chủ. Chi tiết sản phẩm, gian hàng và
 * thương hiệu do máy chủ web dựng từ API thật: DB e2e không có dữ liệu mẫu thì trang 404 và ca được bỏ qua kèm lý do (không lặng lẽ pass), có dữ liệu thì đo.
 * Host phải là localhost (baseURL) vì middleware coi nhãn đầu của Host là subdomain gian hàng.
 */
test.use({ viewport: { width: 375, height: 812 } });

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
  path: string;
  ready: string;
  /** Trang do máy chủ web dựng từ API thật: 404 nghĩa là DB e2e không có dữ liệu cho nó. */
  needsServerData?: boolean;
  setup(api: MockApi): void;
}

const SCREENS: Screen[] = [
  { name: 'Trang chủ', path: '/', ready: 'main', setup: (api) => { mockDiscovery(api, { returning: true }); mockFlash(api); } },
  { name: 'Danh mục', path: '/san-pham', ready: 'main', setup: (api) => mockDiscovery(api, { tree: true }) },
  { name: 'Chi tiết sản phẩm', path: `/san-pham/${CATALOG[0]!.slug}`, ready: 'h1', needsServerData: true, setup: (api) => mockDiscovery(api) },
  { name: 'Gian hàng CTV', path: `/s/${SHOP_SLUG}`, ready: 'h1', needsServerData: true, setup: (api) => mockDiscovery(api) },
  { name: 'Thương hiệu', path: `/brand/${BRAND_SLUG}`, ready: 'h1', needsServerData: true, setup: (api) => mockDiscovery(api) },
  { name: 'Ưu đãi', path: '/uu-dai', ready: '[data-testid="section-header"]', setup: (api) => { mockFlash(api); mockCollectable(api); } },
  { name: 'Giờ vàng', path: '/gio-vang', ready: '[data-ds="product-tile"][data-ds-variant="line"]', setup: (api) => mockFlashSlots(api) },
];

test.describe('axe smoke web 375px: serious/critical', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ 375px chỉ chạy ở project Web Customer Mobile');
  });

  for (const screen of SCREENS) {
    test(screen.name, async ({ page, api }) => {
      screen.setup(api);
      const response = await page.goto(screen.path);
      test.skip(screen.needsServerData === true && response?.status() === 404, `${screen.name}: máy chủ web dựng từ API thật, DB e2e không có dữ liệu (404)`);
      await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      const found = await runAxe(page);
      expect(blockingViolations('web', screen.name, found)).toEqual([]);
      expect(staleBaseline('web', screen.name, found)).toEqual([]);
    });
  }
});

test.describe('axe smoke web: bài tự kiểm', () => {
  test('nút không tên chèn vào trang thì bị bắt (button-name, critical)', async ({ page, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ 375px chỉ chạy ở project Web Customer Mobile');
    const screen = SCREENS.find((s) => s.name === 'Ưu đãi')!;
    screen.setup(api);
    await page.goto(screen.path);
    await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button id="axe-probe"></button>'));
    const found = await runAxe(page);
    const lines = blockingViolations('web', screen.name, found);
    expect(lines.some((l) => l.includes('button-name') && l.includes('axe-probe'))).toBe(true);
  });
});
