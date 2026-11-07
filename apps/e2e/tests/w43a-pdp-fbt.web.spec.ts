import type { Locator, Page } from '@playwright/test';
import { expect, reply, test, type MockApi } from './support/mock-api';
import { assertProductOnCi, firstProduct, type PdpProduct } from './support/pdp-product';
import { refetchStale } from './support/refetch-stale';

/**
 * W43A, web khách: khối "Gợi ý mua kèm hợp vị" ở trang chi tiết, ở 375×812 (project "Web Customer Mobile") và 1440×900 (project "Web Customer").
 * Phần server của Next gọi API thật nên spec lấy một sản phẩm có sẵn trong DB e2e (giá món đang xem là giá thật của DB); "Khách thường mua cùng" lấy
 * từ mock sau khi ép trình duyệt hỏi lại (`refetchStale`): trả 5 món, hai món đầu vào khối (Bơ 50.000đ giảm còn 40.000đ, Dâu 30.000đ), ba món sau ở lại dải
 * bên dưới. Không đặt đơn thật. Host phải là localhost (baseURL).
 */
const SIZES = [
  { width: 375, height: 812, project: 'Web Customer Mobile' },
  { width: 1440, height: 900, project: 'Web Customer' },
] as const;

const USER = {
  id: 'u-w43a', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0,
};
const card = (n: number, name: string, basePrice: number, salePrice: number | null = null) => ({
  id: `prod-b${n}`, slug: `mon-b${n}`, brand: 'Tubu', name, thumbnail: null, basePrice, salePrice, isFeatured: false, inStock: true, repVariationId: `var-b${n}`,
});
const TOGETHER = [card(1, 'Bơ sáp', 50_000, 40_000), card(2, 'Dâu tây', 30_000), card(3, 'Mận hậu', 35_000), card(4, 'Ổi lê', 25_000), card(5, 'Xoài cát', 45_000)];
const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350_000, itemCount: 0 };
const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

const fbt = (page: Page) => page.getByTestId('fbt');
const rows = (page: Page) => page.getByTestId('fbt-row');
const addButton = (page: Page) => page.getByTestId('fbt-add');
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function expectTouchTarget44(t: Locator): Promise<void> {
  const b = (await t.boundingBox())!;
  expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
  expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
}

/** Tổng tiền trên nút "Thêm n món vào giỏ · tổng". */
async function totalOnButton(page: Page): Promise<number> {
  const text = (await addButton(page).textContent()) ?? '';
  const m = /·\s*([\d.]+)đ/.exec(text);
  if (!m) throw new Error(`nút không có tổng tiền: "${text}"`);
  return Number(m[1]!.replaceAll('.', ''));
}

function mockPdp(api: MockApi, p: PdpProduct, opts: { guest?: boolean; together?: unknown[] } = {}): void {
  if (!opts.guest) {
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
    api.get('/me/notifications/unread-count', { count: 0 });
  }
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350_000, subscribeDiscountPct: 0.12 });
  api.get(`/products/${p.slug}`, { variations: p.variations.map((v) => ({ ...v, stock: 50 })) });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, opts.together ?? TOGETHER);
  api.get(`/products/${p.slug}/bundles`, { combos: [], addons: [] });
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${p.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
  api.get(`/products/${p.slug}/reviews/can-review`, { canReview: false });
  api.get('/affiliate/me', { isAffiliate: false });
  api.get('/cart', EMPTY_CART);
  api.post('/cart/items/batch', { ...EMPTY_CART, itemCount: 3 });
}

async function openPdp(page: Page, api: MockApi, p: PdpProduct, authed = true): Promise<void> {
  if (authed) {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  }
  await page.goto(`/san-pham/${p.slug}`);
  await refetchStale(page, api, 'GET', `/products/${p.slug}/bought-together`);
  await expect(fbt(page)).toBeVisible({ timeout: 20_000 });
  await expect(rows(page).first()).toBeVisible();
  await expect(rows(page).nth(1)).toContainText('Bơ sáp');
}

async function product(request: Parameters<typeof firstProduct>[0]): Promise<PdpProduct | null> {
  const p = await firstProduct(request);
  assertProductOnCi(p, 'sản phẩm nào');
  test.skip(!p, 'DB e2e chưa có sản phẩm nào');
  return p;
}

for (const size of SIZES) {
  test.describe(`Web khách ${size.width}×${size.height}: Gợi ý mua kèm hợp vị`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test.beforeEach(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== size.project, `Khổ ${size.width}px kiểm ở project ${size.project}`);
    });

    test('món đang xem + 2 món bổ trợ, chọn hết; mọi dòng và nút từ 44px; dải bên dưới không lặp lại 2 món đó; không tràn ngang', async ({ page, api, request }) => {
      const p = (await product(request))!;
      mockPdp(api, p);
      await openPdp(page, api, p);

      await expect(page.getByRole('heading', { level: 2, name: 'Gợi ý mua kèm hợp vị' })).toBeVisible();
      await expect(rows(page)).toHaveCount(3);
      await expect(rows(page).nth(0)).toContainText('Món đang xem');
      await expect(rows(page).nth(1)).toContainText('Bơ sáp');
      await expect(rows(page).nth(1)).toContainText('40.000đ');
      await expect(rows(page).nth(1)).toContainText('50.000đ');
      await expect(rows(page).nth(2)).toContainText('Dâu tây');
      for (let i = 0; i < 3; i += 1) await expect(rows(page).nth(i).getByRole('checkbox')).toBeChecked();

      const total = await totalOnButton(page);
      const current = total - 40_000 - 30_000;
      expect(current, 'giá món đang xem suy ra từ nút').toBeGreaterThan(0);
      await expect(rows(page).nth(0)).toContainText(vnd(current));
      await expect(addButton(page)).toHaveText(`Thêm 3 món vào giỏ · ${vnd(total)}`);
      await expect(page.getByTestId('fbt-save')).toContainText('Tiết kiệm 10.000đ');

      for (let i = 0; i < 3; i += 1) {
        await rows(page).nth(i).scrollIntoViewIfNeeded();
        const b = (await rows(page).nth(i).boundingBox())!;
        expect(b.height, `dòng ${i} cao tối thiểu 64`).toBeGreaterThanOrEqual(64);
      }
      await addButton(page).scrollIntoViewIfNeeded();
      await expectTouchTarget44(addButton(page));

      // Hai món đầu nằm ở khối nên dải "Khách thường mua cùng" chỉ còn ba món sau.
      const together = page.getByRole('region', { name: 'Khách thường mua cùng' });
      await expect(together).toBeVisible();
      await expect(together).toContainText('Mận hậu');
      await expect(together).not.toContainText('Bơ sáp');
      await expect(together).not.toContainText('Dâu tây');

      const box = (await fbt(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      const togetherBox = (await together.boundingBox())!;
      expect(box.y, 'khối nằm trên dải Khách thường mua cùng').toBeLessThan(togetherBox.y);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('bỏ chọn một món: nhãn nút và tổng đổi theo; bỏ chọn hết: nút khoá và đổi thành lời mời', async ({ page, api, request }) => {
      const p = (await product(request))!;
      mockPdp(api, p);
      await openPdp(page, api, p);

      const total = await totalOnButton(page);
      await rows(page).nth(2).getByRole('checkbox').uncheck();
      await expect(addButton(page)).toHaveText(`Thêm 2 món vào giỏ · ${vnd(total - 30_000)}`);
      await expect(page.getByTestId('fbt-save')).toContainText('Tiết kiệm 10.000đ');
      await rows(page).nth(1).getByRole('checkbox').uncheck();
      await expect(page.getByTestId('fbt-save')).toHaveText('');
      await rows(page).nth(0).getByRole('checkbox').uncheck();
      await expect(addButton(page)).toHaveText('Chọn món muốn thêm');
      await expect(addButton(page)).toBeDisabled();
      expect(api.callsTo('POST', '/cart/items/batch')).toHaveLength(0);
    });

    test('thêm các món đã chọn: đúng một lệnh POST /cart/items/batch, mỗi món một đơn vị, báo đã thêm, ở lại trang', async ({ page, api, request }) => {
      const p = (await product(request))!;
      mockPdp(api, p);
      await openPdp(page, api, p);

      const currentVariation = (await rows(page).nth(0).getAttribute('data-variation-id'))!;
      await rows(page).nth(2).getByRole('checkbox').uncheck();
      await addButton(page).click();
      await expect(page.getByTestId('fbt-status')).toHaveText('Đã thêm 2 món vào giỏ');
      const calls = api.callsTo('POST', '/cart/items/batch');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.body).toEqual({
        items: [
          { variationId: currentVariation, quantity: 1 },
          { variationId: 'var-b1', quantity: 1 },
        ],
        addSource: 'ctv_sheet',
      });
      expect(api.callsTo('POST', '/cart/items')).toHaveLength(0);
      await expect(page).toHaveURL(new RegExp(`/san-pham/${p.slug}`));
      await expect(addButton(page)).toBeEnabled();
    });

    test('máy chủ từ chối cả lô (một món hết hàng): đọc lời của máy chủ, không báo đã thêm', async ({ page, api, request }) => {
      const p = (await product(request))!;
      mockPdp(api, p);
      api.post('/cart/items/batch', reply(400, { code: 'CART_BATCH_REJECTED', message: 'Sản phẩm Bơ sáp đã hết hàng.' }));
      await openPdp(page, api, p);

      await addButton(page).click();
      await expect(page.getByTestId('fbt-status')).toHaveText('Sản phẩm Bơ sáp đã hết hàng.');
      await expect(page.getByText(/Đã thêm \d+ món vào giỏ/)).toHaveCount(0);
      await expect(addButton(page)).toBeEnabled();
    });

    test('khách chưa đăng nhập bấm thêm: sang đăng nhập kèm đường quay lại trang này, chưa ghi gì vào giỏ', async ({ page, api, request }) => {
      const p = (await product(request))!;
      mockPdp(api, p, { guest: true });
      api.post('/auth/refresh', reply(401, { message: 'Chưa đăng nhập' }));
      await openPdp(page, api, p, false);

      await addButton(page).click();
      await expect(page).toHaveURL(/\/dang-nhap\?returnTo=/);
      expect(decodeURIComponent(page.url())).toContain(`/san-pham/${p.slug}`);
      expect(api.callsTo('POST', '/cart/items/batch')).toHaveLength(0);
    });

    test('không còn món bổ trợ: khối ẩn hẳn, dải bên dưới ẩn theo (dưới sàn), không để khung trống', async ({ page, api, request }) => {
      const p = (await product(request))!;
      mockPdp(api, p, { together: [] });
      await page.goto(`/san-pham/${p.slug}`);
      await refetchStale(page, api, 'GET', `/products/${p.slug}/bought-together`);
      await expect(fbt(page)).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Gợi ý mua kèm hợp vị' })).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
