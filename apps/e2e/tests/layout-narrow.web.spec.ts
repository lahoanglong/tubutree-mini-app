import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { footerCart } from './support/cart-footer-mocks';
import { STATES, mockWorld } from './support/checkout-states';
import { assertProductOnCi, firstProduct } from './support/pdp-product';
import { NARROW_WIDTHS, pointsEarnClearance, probeLayout, stickyBarClearance } from './support/layout-probe';

/**
 * W38A: ba màn mua sắm của web (chi tiết sản phẩm /san-pham/[slug], giỏ /gio-hang, thanh toán /thanh-toan) ở 320 / 360 / 375px không tràn ngang,
 * thanh dính đáy không tràn hay chồng lấp và không che dòng cuối, và mọi số tiền / số đếm vẽ bằng số đều (tabular-nums), như Mini App
 * (layout-narrow.miniapp.spec.ts). Phần server của Next gọi API thật nên PDP lấy sản phẩm đầu tiên từ DB e2e; mọi lời gọi từ trình duyệt đi qua mock.
 */
const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

// Số giảm trong hàng mã giữ số tỉ lệ: số đều rộng hơn vài px, mà hàng mã ở 320px chỉ còn độ dư 12px (coupon-row-checkout-320).
const COUPON_ROW_DISCOUNT = ['[data-testid="coupon-discount"]'];

async function expectClean(page: Page, screen: string, width: number): Promise<void> {
  // Chân trang web dài hơn Mini có chủ ý (DESIGN.md, Khuôn trang web): chỉ dò phần thân trang.
  const f = await probeLayout(page, { scope: 'main', ignoreNumeric: COUPON_ROW_DISCOUNT });
  expect.soft(f.overflow, `${screen} ${width}px tràn ngang`).toEqual([]);
  expect.soft(f.stickyBar, `${screen} ${width}px thanh dính`).toEqual([]);
  expect.soft(f.notTabular, `${screen} ${width}px số không đều`).toEqual([]);
}

async function expectBarClearsContent(page: Page, screen: string, width: number): Promise<void> {
  const gap = await stickyBarClearance(page);
  expect.soft(gap, `${screen} ${width}px: dòng cuối bị thanh dính che (khoảng ${gap}px)`).toBeGreaterThanOrEqual(0);
}

async function signIn(page: Page, api: MockApi): Promise<void> {
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
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Web ${width}px: nhịp khoảng cách, thanh dính, số đều`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 700 });
    });

    test('Chi tiết sản phẩm', async ({ page, api, request }) => {
      const product = await firstProduct(request);
      assertProductOnCi(product, 'sản phẩm nào');
      test.skip(!product, 'DB e2e chưa có sản phẩm');
      await signIn(page, api);
      api.get('/flash-sales/active', []);
      api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
      api.get(`/products/${product!.slug}`, { variations: product!.variations.map((v) => ({ id: v.id, stock: 50 })) });
      api.get(`/products/${product!.slug}/related`, []);
      api.get(`/products/${product!.slug}/bought-together`, []);
      api.get('/products/for-you', []);
      api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
      api.get(`/products/${product!.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
      api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
      api.allowUnmocked('GET /affiliate/me', 'GET /products/:slug/reviews/can-review', 'POST /events');
      await page.goto(`/san-pham/${product!.slug}`);
      await expect(page.getByTestId('sticky-bar')).toBeVisible({ timeout: 30_000 });
      await expectClean(page, 'PDP', width);
      await expectBarClearsContent(page, 'PDP', width);
      const points = await pointsEarnClearance(page);
      expect.soft(points, `PDP ${width}px: có dòng Điểm Xanh`).not.toBeNull();
      expect.soft(points ?? 0, `PDP ${width}px: dòng Điểm Xanh đè lên dòng giá`).toBeGreaterThanOrEqual(0);
    });

    test('Giỏ hàng (có mã, combo, tiết kiệm)', async ({ page, api }) => {
      await signIn(page, api);
      api.get('/config/public', {
        freeshipThreshold: 200_000,
        support: { hotline: '0984606774', email: 'tubutree@gmail.com' },
        waste: { enabled: true, dropoff: true, mailin: true, pickup: false },
      });
      const cart = footerCart({ lines: 3, reached: false, combo: 6_000, saving: 8_000, coupon: { code: 'TUBU10', discount: 15_000 }, deals: true });
      api.get('/cart', { ...cart, items: cart.items.map((l) => ({ ...l, weight: 600 })) });
      api.get('/flash-sales/active', []);
      api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');
      await page.goto('/gio-hang');
      await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('sticky-bar')).toBeVisible();
      await expectClean(page, 'Giỏ', width);
      await expectBarClearsContent(page, 'Giỏ', width);
    });

    test('Thanh toán', async ({ page, api }) => {
      await mockWorld(api, page, 'web', STATES[0]!, Promise.resolve());
      await page.goto('/thanh-toan');
      await expect(page.getByRole('button', { name: /Đặt hàng/ }).last()).toBeVisible({ timeout: 30_000 });
      await expectClean(page, 'Thanh toán', width);
      await expectBarClearsContent(page, 'Thanh toán', width);
    });
  });
}
