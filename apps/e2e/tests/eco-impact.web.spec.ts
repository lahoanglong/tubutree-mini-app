import type { APIRequestContext, Page } from '@playwright/test';
import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Nhãn xanh có nguồn và Hộ chiếu Xanh trên web (wave tubu-w2-01-eco-impact-passport-and-product-badges), 390px và 1440px.
 * Hộ chiếu (`/tai-khoan/ho-chieu-xanh`, chỉ web) lấy số ở trình duyệt nên mock được: 3 trạng thái (rỗng, có 1 số, đủ số), cờ tắt (404), khách
 * chưa đăng nhập; biểu đồ ẩn với trình đọc màn hình và có bảng số thay thế. Trang sản phẩm dựng phía máy chủ từ API thật: ca khối "Điểm cộng
 * xanh" chỉ chạy khi DB e2e có sự thật ĐÃ DUYỆT và cờ `eco.product_badges_enabled` bật (DB CI chưa có nên bỏ qua).
 * ECO_SHOTS=<thư mục> thì chụp ảnh.
 */
const SHOTS = process.env.ECO_SHOTS;
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const SIZES = [
  { width: 390, height: 844, project: 'Web Customer Mobile' },
  { width: 1440, height: 900, project: 'Web Customer' },
];

const me = { id: 'u-eco', fullName: 'Nguyễn Văn An', email: null, dob: null, avatarUrl: null, phone: '0912345678', role: 'CUSTOMER', referralCode: 'AN123', onboarded: true, segments: [], pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 };

const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const FULL = {
  firstOrderAt: '2026-06-30T18:00:00.000Z',
  plasticAvoidedGrams: 2410,
  refillPacks: 3,
  wasteReturned: { requests: 2, grams: 4500, unitsWithoutWeight: 0 },
  trees: { pledged: 1, planted: 1 },
  co2Grams: null,
  monthly: MONTHS.map((month, i) => ({ month, actions: [0, 2, 0, 4, 1, 1][i]! })),
  stamps: [
    { id: 'first_order', reached: true },
    { id: 'plastic_1kg', reached: true },
    { id: 'refill_5', reached: false },
    { id: 'waste_3', reached: false },
    { id: 'tree_1', reached: true },
  ],
};
const ONE = {
  ...FULL,
  plasticAvoidedGrams: 0,
  refillPacks: 1,
  wasteReturned: { requests: 0, grams: 0, unitsWithoutWeight: 0 },
  trees: { pledged: 0, planted: 0 },
  monthly: MONTHS.map((month, i) => ({ month, actions: i === 4 ? 1 : 0 })),
  stamps: FULL.stamps.map((s) => ({ ...s, reached: s.id === 'first_order' })),
};
const EMPTY = { ...ONE, firstOrderAt: null, refillPacks: 0, monthly: MONTHS.map((month) => ({ month, actions: 0 })), stamps: FULL.stamps.map((s) => ({ ...s, reached: false })) };

function mockAccount(api: MockApi, passport: Parameters<MockApi['get']>[1]): void {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: me }));
  api.get('/me', () => me);
  api.get('/auth/me', () => ({ ...me, ownsBrand: false, hasDeskPoint: false }));
  api.get('/config/public', { freeshipThreshold: 350_000 });
  api.get('/me/eco-passport', passport);
  api.allowUnmocked('GET /cart', 'GET /me/notifications', 'GET /me/support-chat/summary', 'POST /events', 'GET /me/wishlist/ids', 'GET /me/coupons');
}

async function openPassport(page: Page, size: (typeof SIZES)[number]): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto('/tai-khoan/ho-chieu-xanh');
  await expect(page.getByRole('heading', { name: 'Hộ chiếu Xanh', level: 1 })).toBeVisible({ timeout: 20_000 });
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('Hộ chiếu Xanh (web)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: không khôi phục được phiên
      }
    });
  });

  for (const size of SIZES) {
    test(`${size.width}px đủ số: ô số, không có dòng "Chưa có", biểu đồ có bảng thay thế, mốc có chữ đạt/chưa đạt`, async ({ page, api }) => {
      test.skip(test.info().project.name !== size.project, `chỉ đo ở project ${size.project}`);
      mockAccount(api, FULL);
      await openPassport(page, size);
      const body = page.getByTestId('eco-passport');
      await expect(body).toBeVisible({ timeout: 15_000 });
      await expect(body.locator('[data-metric]')).toHaveCount(4);
      await expect(body.getByText('Bắt đầu từ 01/07/2026')).toBeVisible();
      await expect(body.getByText(/^Chưa có:/)).toHaveCount(0);
      await expect(page.getByTestId('eco-chart')).toHaveAttribute('aria-hidden', 'true');
      const table = body.locator('table');
      await expect(table.locator('caption')).toHaveText('Việc xanh 6 tháng');
      await expect(table.locator('tbody tr')).toHaveCount(6);
      await expect(body.locator('[data-stamp="refill_5"]')).toContainText('chưa đạt');
      await expect(page.getByTestId('eco-passport-share')).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${size.width}-passport-full.png`, fullPage: true });
      await page.getByTestId('eco-passport-how').click();
      await expect(page.getByRole('dialog')).toContainText('Hộ chiếu không đổi được điểm hay quà.');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${size.width}-passport-how.png` });
    });

    test(`${size.width}px có 1 số: một ô, các chỉ số còn lại gộp "Chưa có"`, async ({ page, api }) => {
      test.skip(test.info().project.name !== size.project, `chỉ đo ở project ${size.project}`);
      mockAccount(api, ONE);
      await openPassport(page, size);
      const body = page.getByTestId('eco-passport');
      await expect(body.locator('[data-metric]')).toHaveCount(1, { timeout: 15_000 });
      await expect(body.locator('[data-metric="refill"]')).toContainText('1');
      await expect(body.getByText('Chưa có: nhựa giảm, Đổi rác, cây')).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${size.width}-passport-one.png`, fullPage: true });
    });

    test(`${size.width}px rỗng: một câu và nút "Xem món refill"`, async ({ page, api }) => {
      test.skip(test.info().project.name !== size.project, `chỉ đo ở project ${size.project}`);
      mockAccount(api, EMPTY);
      await openPassport(page, size);
      const empty = page.getByTestId('eco-passport-empty');
      await expect(empty).toBeVisible({ timeout: 15_000 });
      await expect(empty.getByRole('link', { name: 'Xem món refill' })).toHaveAttribute('href', '/san-pham?q=refill');
      await expect(page.getByTestId('eco-passport-share')).toHaveCount(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${size.width}-passport-empty.png`, fullPage: true });
    });
  }

  test('cờ tắt (API 404): báo "Hộ chiếu Xanh chưa mở", không nút thử lại', async ({ page, api }) => {
    test.skip(test.info().project.name !== 'Web Customer Mobile', 'chỉ đo ở khổ điện thoại');
    mockAccount(api, () => reply(404, { statusCode: 404, message: 'Không tìm thấy.' }));
    await openPassport(page, SIZES[0]!);
    await expect(page.getByText('Hộ chiếu Xanh chưa mở')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-390-passport-off.png` });
  });
});

test.describe('Hộ chiếu Xanh (web) — khách chưa đăng nhập', () => {
  test('mời đăng nhập, không hỏi /me/eco-passport', async ({ page, api }) => {
    test.skip(test.info().project.name !== 'Web Customer Mobile', 'chỉ đo ở khổ điện thoại');
    api.get('/config/public', { freeshipThreshold: 350_000 });
    api.get('/me/eco-passport', FULL);
    api.allowUnmocked('GET /cart', 'POST /events', 'POST /auth/refresh', 'GET /me', 'GET /auth/me');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tai-khoan/ho-chieu-xanh');
    await expect(page.getByText('Đăng nhập để xem Hộ chiếu Xanh của bạn.')).toBeVisible({ timeout: 20_000 });
    expect(api.callsTo('GET', '/me/eco-passport')).toHaveLength(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-390-passport-guest.png` });
  });
});

/** Món đầu trong `scan` món đầu của API có (hoặc không có) sự thật xanh trên thẻ; null khi DB chưa có. */
async function productWithEco(request: APIRequestContext, want: boolean, scan = 30): Promise<{ slug: string; name: string } | null> {
  const res = await request.get(`${API_ORIGIN}/api/products?limit=${scan}`).catch(() => null);
  if (!res?.ok()) return null;
  const data = ((await res.json()) as { data?: { slug: string; name: string; ecoFacts?: unknown[]; inStock?: boolean }[] }).data ?? [];
  const hit = data.find((p) => p.inStock !== false && (want ? Array.isArray(p.ecoFacts) && p.ecoFacts.length > 0 : !p.ecoFacts));
  return hit ? { slug: hit.slug, name: hit.name } : null;
}

const PDP_PASSTHROUGH = [
  'GET /products/:slug',
  'GET /products/:slug/stock',
  'GET /products/:slug/reviews',
  'GET /products/:slug/related',
  'GET /products/:slug/bought-together',
  'GET /products/:slug/compare',
  'GET /products/:slug/bundles',
  'GET /products/:slug/reviews/can-review',
  'GET /products/for-you',
  'GET /products',
  'GET /flash-sales/active',
  'GET /config/public',
  'GET /restock-alerts',
  'GET /cart',
  'GET /me/wishlist/ids',
  'GET /me/coupons',
  'GET /affiliate/me',
  'POST /events',
  'POST /auth/refresh',
];

test.describe('Khối "Điểm cộng xanh" trên trang sản phẩm web (DB e2e có sự thật đã duyệt)', () => {
  for (const size of SIZES) {
    test(`${size.width}px: có khối, link Nguồn mở tab mới, khách chưa đăng nhập không có dòng hộ chiếu, không tràn ngang`, async ({ page, request, api }) => {
      test.skip(test.info().project.name !== size.project, `chỉ đo ở project ${size.project}`);
      const p = await productWithEco(request, true);
      test.skip(!p, 'DB e2e chưa có sự thật xanh đã duyệt (hoặc cờ eco.product_badges_enabled tắt)');
      api.allowUnmocked(...PDP_PASSTHROUGH);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/san-pham/${p!.slug}`);
      const block = page.getByTestId('pdp-eco');
      await expect(block).toBeVisible({ timeout: 30_000 });
      const link = block.locator('a[target="_blank"]').first();
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
      await expect(link).toHaveAttribute('href', /^https:\/\//);
      await expect(link).toContainText(', mở trang mới');
      await expect(block.getByTestId('pdp-eco-passport')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      await block.scrollIntoViewIfNeeded();
      if (SHOTS) await block.screenshot({ path: `${SHOTS}/web-${size.width}-pdp-eco.png` });
    });

    test(`${size.width}px: món không có sự thật thì không có khối`, async ({ page, request, api }) => {
      test.skip(test.info().project.name !== size.project, `chỉ đo ở project ${size.project}`);
      const p = await productWithEco(request, false);
      test.skip(!p, 'DB e2e không có món nào để so');
      api.allowUnmocked(...PDP_PASSTHROUGH);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/san-pham/${p!.slug}`);
      await expect(page.locator('[data-pdp-block="main"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('pdp-eco')).toHaveCount(0);
    });
  }
});
