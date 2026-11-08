import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_SLUG } from './support/pilot-mocks';

/**
 * W45A, Mini App ở 320/375/393px: dải cam kết `ProductTrustStrip` ở trang chi tiết, dưới khối chọn phân loại và Số lượng, trước Combo/Mua kèm.
 * API mock toàn bộ. Không đặt đơn thật.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: 0 };
const TUBU_PRODUCT = { ...PILOT_PRODUCT, fulfiller: { kind: 'TUBU' } };
const MERCHANT_PRODUCT = { ...PILOT_PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'MERCHANT', name: 'Gốm Minh An', shippingFee: 30_000, freeShipFrom: null } };

const strip = (page: Page) => page.getByTestId('product-trust-strip');
const cta = (page: Page) => page.getByTestId('product-trust-cta');
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function expectTouchTarget44(t: Locator): Promise<void> {
  const b = (await t.boundingBox())!;
  expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
  expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
}

function mockPdp(api: MockApi, opts: { product?: unknown; returnWindowDays?: number } = {}): void {
  mockPilotProduct(api);
  api.get('/products/:slug', opts.product ?? TUBU_PRODUCT);
  api.get('/cart', EMPTY_CART);
  api.get('/config/public', { freeshipThreshold: 200_000, returnWindowDays: opts.returnWindowDays ?? 7 });
  api.get('/config/legal/:slug', { content: '# Chính sách\n\nĐổi trả nếu sản phẩm lỗi.', vars: {} });
}

async function openPdp(page: Page): Promise<void> {
  await page.goto(`/product/${PILOT_SLUG}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
}

for (const vp of VIEWPORTS) {
  test.describe(`Mini App ${vp.width}px: dải cam kết ở trang chi tiết`, () => {
    test.use({ viewport: vp });

    test('ba trụ cột đúng chữ, nằm dưới ô Số lượng; chữ không bị cắt; lối xem chính sách từ 44px; không tràn ngang', async ({ page, api }) => {
      mockPdp(api);
      await openPdp(page);
      await expect(strip(page)).toBeVisible();

      await expect(strip(page)).toHaveAccessibleName('Cam kết của Tubu Tree khi mua sản phẩm này');
      await expect(page.getByTestId('trust-pillar-origin')).toHaveText('Nguồn gốc rõ ràngChọn lọc kỹ từng thương hiệu');
      await expect(page.getByTestId('trust-pillar-delivery')).toHaveText('Giao hàng cẩn thậnĐóng gói kỹ trước khi giao');
      await expect(page.getByTestId('trust-pillar-returns')).toHaveText('Đổi trả dễ dàngHỗ trợ nhanh nếu sản phẩm lỗi');

      const box = (await strip(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      const quantity = (await page.getByText('Số lượng', { exact: true }).first().boundingBox())!;
      expect(box.y, 'dải nằm dưới ô Số lượng').toBeGreaterThan(quantity.y);

      // Mỗi cột co theo bề ngang: chữ xuống dòng, không tràn ra ngoài cột.
      const overflowing = await strip(page).locator('.tubu-trust-title, .tubu-trust-sub').evaluateAll((els) =>
        els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
      );
      expect(overflowing, 'chữ tràn khỏi cột').toEqual([]);
      const items = await page.locator('.tubu-trust-item').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
      for (const right of items) expect(right).toBeLessThanOrEqual(vp.width);

      await cta(page).scrollIntoViewIfNeeded();
      await expectTouchTarget44(cta(page));
      await expect(cta(page)).toHaveAccessibleName('Xem chính sách đổi trả của Tubu Tree');
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('chạm "Xem chính sách đổi trả" mở chính sách ngay trong trang, không rời sản phẩm', async ({ page, api }) => {
      mockPdp(api);
      await openPdp(page);
      await cta(page).scrollIntoViewIfNeeded();
      await cta(page).click();

      const dialog = page.getByRole('dialog', { name: 'Chính sách đổi trả' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Đổi trả nếu sản phẩm lỗi.');
      await expect(page).toHaveURL(new RegExp(`/product/${PILOT_SLUG}`));
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('đổi trả tắt ở cấu hình: hai trụ cột, lối xem chuyển sang chính sách vận chuyển', async ({ page, api }) => {
      mockPdp(api, { returnWindowDays: 0 });
      await openPdp(page);
      await expect(strip(page)).toBeVisible();
      await expect(strip(page).getByRole('listitem')).toHaveCount(2);
      await expect(page.getByTestId('trust-pillar-returns')).toHaveCount(0);
      await expect(cta(page)).toHaveAccessibleName('Xem chính sách vận chuyển của Tubu Tree');
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('hàng gian hàng tự giao: không có dải cam kết của Tubu', async ({ page, api }) => {
      mockPdp(api, { product: MERCHANT_PRODUCT });
      await openPdp(page);
      await expect(page.getByText('Gốm Minh An tự giao').first()).toBeVisible();
      await expect(strip(page)).toHaveCount(0);
    });
  });
}
