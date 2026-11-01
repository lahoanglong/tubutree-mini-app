import { expect, test, type MockApi } from './support/mock-api';

/**
 * G6 (P2 #35): trình dựng gian hàng ở web máy tính 1280px: hai nút lên hàng tiêu đề (không thanh dính đáy), chi tiết khối hai cột.
 * Mọi lời gọi /api/** đi qua mock (fixture `api`), nên không cần DB; trang gian hàng công khai (#36) do máy chủ dựng từ API thật nên đo ở vitest.
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
