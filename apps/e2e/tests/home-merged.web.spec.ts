import { test, expect } from './support/mock-api';
import { HOME_ME, MERGED_BRAND, MERGED_PURCHASED, lonePersonalCalls, mockMergedHome } from './support/home-merged';
import { BRAND_SHOWCASE } from './support/home-brands';

const BRAND_ITEM = {
  id: 'hm-brand-1', slug: 'hm-nhan-1', brand: 'Tubu', name: 'Món của nhãn từ /products', thumbnail: null, basePrice: 120_000, salePrice: null, isFeatured: false, inStock: true,
};

const USER = {
  id: 'u-merged', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0,
};

/** Web: Trang chủ mở bằng GET /home/me (mock đúng dạng API thật) cho khối cá nhân, không gọi các endpoint lẻ đã gộp. */
test.describe('Web khách: Trang chủ — request gộp', () => {
  test('đã đăng nhập: khối cá nhân lấy từ /home/me, không gọi endpoint lẻ đã gộp', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec chạy tiếp, chỉ không có phiên khôi phục
      }
    });
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
    api.get('/me/notifications/unread-count', { count: 0 });
    api.get('/me/subscriptions', []);
    api.get('/me/wishlist/ids', []);
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
    mockMergedHome(api);
    // Món của từng nhãn ở khối cuối tải ở trình duyệt (`/products?brand=`); mặc định của mock-api là trang rỗng, khi đó nhãn tự ẩn.
    api.get('/products', { data: [BRAND_ITEM], meta: { page: 1, limit: 8, total: 1 } });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Mua lại' }).getByText(MERGED_PURCHASED)).toBeVisible({ timeout: 15_000 });
    const showcase = page.getByRole('region', { name: BRAND_SHOWCASE });
    await showcase.scrollIntoViewIfNeeded();
    await expect(showcase.getByRole('heading', { name: MERGED_BRAND, exact: true })).toBeVisible();
    await expect(showcase.getByText(BRAND_ITEM.name).first()).toBeVisible();
    const me = api.callsTo('GET', '/home/me');
    expect(me).toHaveLength(1);
    expect(me[0]!.query.get('purchasedLimit')).toBe(String(HOME_ME.purchasedLimit));
    await page.waitForLoadState('networkidle');
    expect(lonePersonalCalls(api)).toEqual([]);
  });
});
