import type { Page } from '@playwright/test';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { expect, publicConfig, test, type MockApi } from './support/mock-api';
import { footerCart } from './support/cart-footer-mocks';
import { mockWorld } from './support/checkout-states';
import { CATALOG } from './support/discovery-mocks';
import { mockCollectable } from './support/voucher-mocks';

/**
 * tubu-w3-06 trên web, API trình duyệt mock toàn bộ: dòng "Quà tặng dùng thử 0đ" ở /gio-hang (360/390/768/1440, không tràn ngang), /thanh-toan gửi
 * đúng quà đang thấy, và khối Giờ vàng ở /uu-dai đổi sang "Giờ Xanh Ưu Đãi" khi cờ bật (nút ＋ trên thẻ). Đặt SHOT_DIR thì chụp từng khổ.
 */
const GIFT_ID = 'gift-khan-tre';
const option = (variationId: string, minOrder: number, unlocked: boolean) => ({
  variationId,
  productName: variationId === GIFT_ID ? 'Khăn giấy tre bỏ túi' : 'Bàn chải tre',
  variationName: 'Gói dùng thử',
  slug: variationId,
  thumbnail: null,
  minOrder,
  unlocked,
});
const chosen = (base: number): GiftTrialSummaryDTO => ({
  base,
  minOrder: 299_000,
  nextMinOrder: 499_000,
  shortfall: 499_000 - base,
  options: [option(GIFT_ID, 299_000, true), option('gift-ban-chai', 499_000, false)],
  selectedVariationId: GIFT_ID,
  declined: false,
});
const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/web-${name}.png`, fullPage: true });
}
const pageWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer', 'Khổ do spec tự đặt, một project là đủ');
});

async function openCart(page: Page, api: MockApi, width: number) {
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
  api.get('/config/public', publicConfig());
  const cart = footerCart({ lines: 3, reached: true });
  api.get('/cart', { ...cart, items: cart.items.map((l) => ({ ...l, weight: 600 })), giftTrial: chosen(360_000) });
  api.get('/flash-sales/active', []);
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/gio-hang');
  await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('Web /gio-hang: dòng quà tặng dùng thử 0đ', () => {
  for (const width of [360, 390, 768, 1440]) {
    test(`${width}px: tên quà và mốc kế ở một dòng dưới danh sách, nút Đổi, không tràn ngang`, async ({ page, api }) => {
      await openCart(page, api, width);
      const row = page.getByTestId('gift-trial-row');
      await expect(row).toContainText('Quà 0đ: Khăn giấy tre bỏ túi · Gói dùng thử');
      await expect(row).toContainText('Thêm 139.000đ để mở thêm quà');
      const change = row.getByTestId('gift-trial-change');
      const box = (await change.boundingBox())!;
      expect(Math.min(box.width, box.height), 'nút Đổi tối thiểu 44×44').toBeGreaterThanOrEqual(44);
      expect(await pageWidth(page)).toBeLessThanOrEqual(width);
      await row.scrollIntoViewIfNeeded();
      await shot(page, `cart-gift-${width}`);
    });
  }

  test('390px: "Đổi" mở tấm chọn, quà chưa mở bị khoá, "Không nhận quà" gửi PUT /cart/gift null', async ({ page, api }) => {
    api.put('/cart/gift', ({ call }) => {
      const variationId = (call.body as { variationId: string | null }).variationId;
      return { ...footerCart({ lines: 3, reached: true }), giftTrial: { ...chosen(360_000), selectedVariationId: variationId, declined: variationId === null } };
    });
    await openCart(page, api, 390);
    await page.getByTestId('gift-trial-change').click();
    const radios = page.getByTestId('gift-trial-option').locator('input[type="radio"]');
    await expect(radios).toHaveCount(3);
    await expect(radios.nth(0)).toBeChecked();
    await expect(radios.nth(1)).toBeDisabled();
    await shot(page, 'cart-gift-sheet-390');
    await page.getByTestId('gift-trial-option').nth(2).click();
    await expect.poll(() => api.callsTo('PUT', '/cart/gift').length).toBe(1);
    expect(api.callsTo('PUT', '/cart/gift')[0]!.body).toEqual({ variationId: null });
  });
});

test.describe('Web /thanh-toan: quà tặng dùng thử 0đ', () => {
  for (const width of [390, 1440]) {
    test(`${width}px: dòng quà hiện, đặt đơn gửi giftVariationId của quà đang thấy`, async ({ page, api }) => {
      await mockWorld(api, page, 'web', {
        key: 'gift-trial',
        name: 'Có quà dùng thử',
        ready: () => undefined,
        world: (w) => {
          w.cart.giftTrial = chosen(330_000);
          w.quote.giftTrial = chosen(330_000);
        },
      }, Promise.resolve());
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/thanh-toan');
      const row = page.locator('[data-testid="gift-trial-row"]:visible');
      await expect(row).toContainText('Quà 0đ: Khăn giấy tre bỏ túi', { timeout: 15_000 });
      expect(await pageWidth(page)).toBeLessThanOrEqual(width);
      await row.scrollIntoViewIfNeeded();
      await shot(page, `checkout-gift-${width}`);
      const placed = api.waitForCall('POST', '/checkout/place-order');
      const place = page.getByRole('button', { name: /Đặt hàng · / }).last();
      await expect(place).toBeEnabled({ timeout: 15_000 });
      await place.click();
      expect(((await placed).body as { giftVariationId?: string | null }).giftVariationId).toBe(GIFT_ID);
    });
  }
});

const HOUR = 3_600_000;
test.describe('Web /uu-dai: Giờ Xanh Ưu Đãi', () => {
  for (const width of [390, 1440]) {
    test(`${width}px, cờ bật: tiêu đề "Giờ Xanh Ưu Đãi", mỗi thẻ còn suất có nút ＋, không tràn ngang`, async ({ page, api }) => {
      api.get('/flash-sales/active', () => {
        const now = Date.now();
        return CATALOG.slice(4, 7).map((p, i) => ({
          itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
          flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: i === 0 ? 50 : 10 + i * 12, quota: 50,
          endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
        }));
      });
      mockCollectable(api);
      api.get('/config/public', publicConfig({ flashGreenHourEnabled: true } as never));
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/uu-dai');
      const region = page.getByRole('region', { name: 'Giờ Xanh Ưu Đãi', exact: true });
      await expect(region).toBeVisible({ timeout: 20_000 });
      await expect(region.getByRole('button', { name: /^Thêm .* vào giỏ$/ })).toHaveCount(2);
      expect(await pageWidth(page)).toBeLessThanOrEqual(width);
      await region.scrollIntoViewIfNeeded();
      await shot(page, `offers-green-hour-${width}`);
    });
  }
});
