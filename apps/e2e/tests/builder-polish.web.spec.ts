import { expect, reply, test, type MockApi } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { assertSeededOnCi } from './support/a11y-db';
import { LG_COMBO_ITEMS, LG_SHELF_FEW, LG_SHELF_MANY, LG_SHELVES_SLUG, seedLgShelves } from './support/lg-shelves-db';

/**
 * G6 (P2 #35, #36): web máy tính 1280px. Trình dựng: hai nút lên hàng tiêu đề (không thanh dính đáy), chi tiết khối hai cột. Trang gian hàng công khai:
 * ComboCard có trần bề rộng, kệ ít món thành lưới. Mọi lời gọi /api/** từ trình duyệt đi qua mock (fixture `api`); riêng trang công khai do máy chủ web
 * dựng từ API thật nên dùng gian hàng mẫu của `seedLgShelves` trong DB tạm.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const USER = { id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER', pointsBalance: 0, walletBalance: 0 };
const product = (n: number) => ({ id: `p${n}`, name: `Sản phẩm số ${n}`, slug: `sp-${n}`, brand: 'Tubu', basePrice: 120_000, salePrice: null, thumbnail: null, repVariationId: `v${n}`, inStock: true });

function mockBuilder(api: MockApi) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
  api.get('/affiliate/me', { isAffiliate: true, canRegister: true, canOpenStorefront: true, referralCode: 'AN123', walletBalance: 0 });
  api.get('/storefront/me', {
    id: 'sf1', slug: 'shop-aff-1', type: 'CTV', title: 'Cửa hàng Xanh', headerNote: null, avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null,
    subdomain: null, isPublished: true, status: 'LIVE', referralCode: 'AN123', subdomainEnabled: false, publicHiddenReason: null,
    collections: [{
      id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'CAROUSEL', comboDiscountPct: null, sortOrder: 0,
      items: [1, 2, 3, 4].map((n, k) => ({ id: `i${n}`, productId: `p${n}`, note: null, isPinned: false, isHidden: false, hiddenReason: null, sortOrder: k, product: product(n) })),
    }],
  });
  api.get('/categories', []);
  api.get('/storefront/me/products', []);
  api.get('/storefront/me/stats', { orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0, byProduct: [] });
  api.get('/storefront/me/quests', { quests: [], totalEarnedPoints: 0, level: 0, levelMax: 5 });
  api.get('/me/wishlist/ids', []);
  api.get('/flash-sales/active', []);
  api.get('/cart', { items: [], total: 0 });
}

test.describe('Trình dựng gian hàng web 1280px (G6 #35)', () => {
  test.beforeEach(async ({ page, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'khổ máy tính chỉ chạy ở project Web Customer');
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
    mockBuilder(api);
  });

  test('hai nút "Xem trước" và "Chia sẻ" nằm ở hàng tiêu đề, không còn thanh dính đáy', async ({ page }) => {
    await page.goto('/ctv/gian-hang');
    await expect(page.getByText('Bộ sưu tập A')).toBeVisible({ timeout: 20_000 });
    const slot = page.getByTestId('builder-head-actions');
    await expect(slot).toBeVisible();
    const h1 = (await page.getByRole('heading', { level: 1, name: 'Gian hàng của tôi' }).boundingBox())!;
    const preview = (await slot.getByText('Xem trước').boundingBox())!;
    expect(Math.abs(preview.y + preview.height / 2 - (h1.y + h1.height / 2)), 'nút cùng hàng với tiêu đề').toBeLessThanOrEqual(24);
    await expect(page.getByText('Xem trước', { exact: true })).toHaveCount(1);
    await expect(page.getByTestId('builder-bar')).toHaveCount(0);
  });

  test('chi tiết khối: khung "Khách sẽ thấy" nằm cột phải, trang không tràn ngang', async ({ page }) => {
    await page.goto('/ctv/gian-hang?khoi=c1');
    const preview = page.getByTestId('shop-section-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    const box = (await preview.boundingBox())!;
    expect(box.x, 'khung xem trước ở cột phải').toBeGreaterThan(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('Gian hàng công khai web (G6 #36)', () => {
  let seeded = false;
  test.beforeAll(async () => {
    seeded = await seedLgShelves();
    assertSeededOnCi(seeded);
  });
  test.beforeEach(async ({ api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'khổ máy tính chỉ chạy ở project Web Customer');
    test.skip(!seeded, 'DB e2e không phải DB tạm: không dựng được gian hàng mẫu');
    api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
    api.get('/config/public', {});
    api.get('/me/wishlist/ids', []);
    mockDiscovery(api);
  });

  const section = (page: import('@playwright/test').Page, title: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

  /** Số cột của `GRID_PRODUCTS` (lưới Sản phẩm) theo bề rộng cửa sổ: 5 từ lg (1024px), 6 từ xl (1280px); khe 16px từ md. */
  const COLUMNS_AT = (width: number) => (width >= 1280 ? 6 : 5);
  const GAP = 16;

  async function expectProductsGridColumns(page: import('@playwright/test').Page, width: number): Promise<void> {
    const few = section(page, 'Kệ ít món');
    await expect(few.getByTestId('shop-rail')).toBeHidden();
    const grid = few.getByTestId('shop-rail-lg');
    await expect(grid).toBeVisible();
    const box = (await grid.boundingBox())!;
    const tiles = await grid.locator('[data-ds="product-tile"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    expect(tiles).toHaveLength(LG_SHELF_FEW);
    const cols = COLUMNS_AT(width);
    const expected = (box.width - GAP * (cols - 1)) / cols;
    for (const t of tiles) expect(Math.abs(t.width - expected), `thẻ rộng ${t.width}px, lưới Sản phẩm ${cols} cột cho ${expected}px`).toBeLessThanOrEqual(1);
    expect(Math.abs(tiles[0]!.left - box.x), 'thẻ đầu sát mép trái lưới').toBeLessThanOrEqual(1);
    // Hàng chưa đầy dồn trái là chủ ý (như hàng cuối của lưới Sản phẩm): thẻ liền nhau cách đúng một khe.
    expect(Math.abs(tiles[1]!.left - tiles[0]!.right - GAP)).toBeLessThanOrEqual(1);
  }

  test('1280px: ComboCard không rộng quá 600px; kệ ít món là lưới cùng 6 cột với lưới Sản phẩm, kệ nhiều món vẫn là kệ ngang', async ({ page }) => {
    await page.goto(`/s/${LG_SHELVES_SLUG}`);
    const combo = page.getByTestId('shop-combo');
    await expect(combo).toBeVisible({ timeout: 20_000 });
    expect((await combo.boundingBox())!.width, 'ComboCard giãn hết khung').toBeLessThanOrEqual(600);
    expect(LG_COMBO_ITEMS).toBeGreaterThanOrEqual(2);

    await expectProductsGridColumns(page, 1280);

    const many = section(page, 'Kệ nhiều món');
    await expect(many.getByTestId('shop-rail-lg')).toHaveCount(0);
    await expect(many.getByTestId('shop-rail')).toBeVisible();
    expect(LG_SHELF_MANY).toBeGreaterThan(6);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('1100px (lg, dưới xl): kệ ít món là lưới 5 cột như lưới Sản phẩm', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(`/s/${LG_SHELVES_SLUG}`);
    await expect(page.getByTestId('shop-combo')).toBeVisible({ timeout: 20_000 });
    await expectProductsGridColumns(page, 1100);
  });

  for (const [label, width] of [['1280px', 1280], ['375px', 375]] as const) {
    test(`${label}: kệ ít món chỉ có một bản thẻ trong cây trợ năng và một bản ảnh nhìn thấy (bản kia display:none)`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 800 });
      await page.goto(`/s/${LG_SHELVES_SLUG}`);
      const few = section(page, 'Kệ ít món');
      await expect(few.getByTestId(width === 375 ? 'shop-rail' : 'shop-rail-lg')).toBeVisible({ timeout: 20_000 });
      // Playwright bỏ phần tử display:none khỏi getByRole: hai bản cùng thấy được thì số liên kết gấp đôi.
      const links = few.getByRole('link');
      const names = await links.evaluateAll((els) => els.map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()));
      const productLinks = await few.locator('a[href^="/san-pham/"]:visible').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
      expect(new Set(productLinks).size, 'mỗi sản phẩm một liên kết nhìn thấy').toBe(productLinks.length);
      expect(productLinks).toHaveLength(LG_SHELF_FEW);
      expect(new Set(names).size, `tên liên kết không trùng: ${names.join(' | ')}`).toBe(names.length);
      const tilesShown = await few.locator('[data-ds="product-tile"]:visible').count();
      expect(tilesShown).toBe(LG_SHELF_FEW);
    });
  }

  test('375px: vẫn là kệ ngang như Mini, không có lưới', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/s/${LG_SHELVES_SLUG}`);
    const few = section(page, 'Kệ ít món');
    await expect(few.getByTestId('shop-rail')).toBeVisible({ timeout: 20_000 });
    await expect(few.getByTestId('shop-rail-lg')).toBeHidden();
  });
});
