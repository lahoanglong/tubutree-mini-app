import { expect, test } from './support/mock-api';

/**
 * Web khách khổ điện thoại: giỏ trống phải như Mini App (apps/miniapp/src/pages/cart.tsx). Số đo ở 375px lấy từ Mini App:
 * minh hoạ cách đỉnh khung 93,9px, kệ "Có thể bạn thích" tràn hết bề ngang, tiêu đề kệ cách lề 16px.
 */

const product = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000 + n,
  salePrice: null, isFeatured: false, inStock: true,
});

test('giỏ trống ở 375px: kệ gợi ý sát lề 16px như Mini App', async ({ page, api }) => {
  const user = {
    id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
    pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
  };
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user }));
  api.get('/me', () => user);
  api.get('/me/coupons', []);
  api.get('/me/wishlist/ids', []);
  api.get('/config/public', {
    freeshipThreshold: 500000,
    support: { hotline: '0984606774', email: 'tubutree@gmail.com' },
    waste: { enabled: true, dropoff: true, mailin: true, pickup: false },
  });
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 0 });
  api.get('/products', { data: [1, 2, 3, 4].map(product), meta: { page: 1, limit: 4, total: 4 } });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/gio-hang');
  await expect(page.getByText('Giỏ còn trống đấy')).toBeVisible({ timeout: 30_000 });
  const rail = page.getByRole('region', { name: 'Có thể bạn thích' });
  await expect(rail).toBeVisible({ timeout: 30_000 });

  const box = async (loc: ReturnType<typeof page.locator>) => (await loc.boundingBox())!;
  const section = await box(rail);
  expect(section.x).toBeCloseTo(0, 0);
  expect(section.width).toBeCloseTo(375, 0);
  expect((await box(rail.getByRole('heading', { name: 'Có thể bạn thích' }))).x).toBeCloseTo(16, 0);
  const art = await box(page.getByText('Giỏ còn trống đấy').locator('xpath=..').locator('svg').first());
  expect(art.y).toBeCloseTo(93.9, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});
