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

  test('1280px: ComboCard không rộng quá 600px; kệ ít món là lưới lấp hàng, kệ nhiều món vẫn là kệ ngang', async ({ page }) => {
    await page.goto(`/s/${LG_SHELVES_SLUG}`);
    const combo = page.getByTestId('shop-combo');
    await expect(combo).toBeVisible({ timeout: 20_000 });
    expect((await combo.boundingBox())!.width, 'ComboCard giãn hết khung').toBeLessThanOrEqual(600);
    expect(LG_COMBO_ITEMS).toBeGreaterThanOrEqual(2);

    const few = section(page, 'Kệ ít món');
    await expect(few.getByTestId('shop-rail')).toBeHidden();
    const grid = few.getByTestId('shop-rail-lg');
    await expect(grid).toBeVisible();
    const tiles = await grid.locator('[data-ds="product-tile"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    expect(tiles).toHaveLength(LG_SHELF_FEW);
    const frame = (await few.boundingBox())!;
    const row = tiles[tiles.length - 1]!.right - tiles[0]!.left;
    expect(row / frame.width, 'bốn thẻ chiếm cả hàng chứ không dồn trái').toBeGreaterThanOrEqual(0.6);
    expect(Math.min(...tiles.map((t) => t.width)), 'thẻ không hẹp hơn thẻ kệ 148px').toBeGreaterThanOrEqual(148);

    const many = section(page, 'Kệ nhiều món');
    await expect(many.getByTestId('shop-rail-lg')).toHaveCount(0);
    await expect(many.getByTestId('shop-rail')).toBeVisible();
    expect(LG_SHELF_MANY).toBeGreaterThan(6);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('375px: vẫn là kệ ngang như Mini, không có lưới', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/s/${LG_SHELVES_SLUG}`);
    const few = section(page, 'Kệ ít món');
    await expect(few.getByTestId('shop-rail')).toBeVisible({ timeout: 20_000 });
    await expect(few.getByTestId('shop-rail-lg')).toBeHidden();
  });
});
