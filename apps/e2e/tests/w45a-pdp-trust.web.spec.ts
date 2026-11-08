import type { Locator, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { assertProductOnCi, firstProduct, type PdpProduct } from './support/pdp-product';

/**
 * W45A, web khách: dải cam kết `ProductTrustStrip` ở trang chi tiết (/san-pham/[slug]), ở 320/375/393px (project "Web Customer Mobile") và 1440×900
 * (project "Web Customer"). Phần server của Next gọi API thật nên spec lấy một sản phẩm có sẵn trong DB e2e; mọi lời gọi từ trình duyệt đi qua mock.
 * Không đặt đơn thật. Host phải là localhost (baseURL).
 */
const SIZES = [
  { width: 320, height: 640, project: 'Web Customer Mobile' },
  { width: 375, height: 812, project: 'Web Customer Mobile' },
  { width: 393, height: 852, project: 'Web Customer Mobile' },
  { width: 1440, height: 900, project: 'Web Customer' },
] as const;

const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350_000, itemCount: 0 };

const strip = (page: Page) => page.getByTestId('product-trust-strip');
const cta = (page: Page) => page.getByTestId('product-trust-cta');
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function expectTouchTarget44(t: Locator): Promise<void> {
  const b = (await t.boundingBox())!;
  expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
  expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
}

function mockPdp(api: MockApi, p: PdpProduct, opts: { returnWindowDays?: number } = {}): void {
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350_000, subscribeDiscountPct: 0.12, returnWindowDays: opts.returnWindowDays ?? 7 });
  api.get(`/products/${p.slug}`, { variations: p.variations.map((v) => ({ ...v, stock: 50 })) });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get(`/products/${p.slug}/bundles`, { combos: [], addons: [] });
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${p.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
  api.get(`/products/${p.slug}/reviews/can-review`, { canReview: false });
  api.get('/affiliate/me', { isAffiliate: false });
  api.get('/cart', EMPTY_CART);
  api.allowUnmocked('GET /me/coupons', 'POST /events', 'POST /affiliate/touch');
}

/** Sản phẩm Tubu giao đầu tiên của DB e2e: gian hàng tự giao không có dải nên không dùng làm mẫu. */
async function tubuProduct(request: Parameters<typeof firstProduct>[0]): Promise<PdpProduct | null> {
  const p = await firstProduct(request);
  assertProductOnCi(p, 'sản phẩm nào');
  test.skip(!p, 'DB e2e chưa có sản phẩm nào');
  const detail = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(p!.slug)}`).then((r) => r.json() as Promise<{ fulfiller?: { kind?: string } }>);
  test.skip(detail.fulfiller?.kind === 'MERCHANT' || detail.fulfiller?.kind === 'UNAVAILABLE', 'sản phẩm đầu của DB e2e không phải hàng Tubu giao');
  return p;
}

async function openPdp(page: Page, p: PdpProduct): Promise<void> {
  await page.goto(`/san-pham/${p.slug}`);
  await expect(strip(page)).toBeVisible({ timeout: 20_000 });
}

for (const size of SIZES) {
  test.describe(`Web khách ${size.width}×${size.height}: dải cam kết ở trang chi tiết`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test.beforeEach(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== size.project, `Khổ ${size.width}px kiểm ở project ${size.project}`);
    });

    test('ba trụ cột đúng chữ, nằm dưới khối mua; chữ không bị cắt; lối xem chính sách từ 44px; không tràn ngang', async ({ page, api, request }) => {
      const p = (await tubuProduct(request))!;
      mockPdp(api, p);
      await openPdp(page, p);

      await expect(strip(page)).toHaveAccessibleName('Cam kết của Tubu Tree khi mua sản phẩm này');
      await expect(page.getByTestId('trust-pillar-origin')).toHaveText('Nguồn gốc rõ ràngChọn lọc kỹ từng thương hiệu');
      await expect(page.getByTestId('trust-pillar-delivery')).toHaveText('Giao hàng cẩn thậnĐóng gói kỹ trước khi giao');
      await expect(page.getByTestId('trust-pillar-returns')).toHaveText('Đổi trả dễ dàngHỗ trợ nhanh nếu sản phẩm lỗi');

      const box = (await strip(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      const title = (await page.getByRole('heading', { level: 1 }).first().boundingBox())!;
      expect(box.y, 'dải nằm dưới tên sản phẩm').toBeGreaterThan(title.y);

      const overflowing = await strip(page).locator('.tubu-trust-title, .tubu-trust-sub').evaluateAll((els) =>
        els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
      );
      expect(overflowing, 'chữ tràn khỏi cột').toEqual([]);
      const rights = await page.locator('.tubu-trust-item').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
      for (const right of rights) expect(right).toBeLessThanOrEqual(size.width);

      await cta(page).scrollIntoViewIfNeeded();
      await expectTouchTarget44(cta(page));
      await expect(cta(page)).toHaveAccessibleName('Xem chính sách đổi trả của Tubu Tree');
      await expect(cta(page)).toHaveAttribute('href', '/chinh-sach/doi-tra');
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('đổi trả tắt ở cấu hình: hai trụ cột, liên kết chuyển sang chính sách vận chuyển', async ({ page, api, request }) => {
      const p = (await tubuProduct(request))!;
      mockPdp(api, p, { returnWindowDays: 0 });
      await openPdp(page, p);
      await expect(strip(page).getByRole('listitem')).toHaveCount(2);
      await expect(page.getByTestId('trust-pillar-returns')).toHaveCount(0);
      await expect(cta(page)).toHaveAccessibleName('Xem chính sách vận chuyển của Tubu Tree');
      await expect(cta(page)).toHaveAttribute('href', '/chinh-sach/van-chuyen');
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
