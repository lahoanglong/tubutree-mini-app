import type { Page } from '@playwright/test';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { test, expect, makeUser, mockSession, publicConfig, type MockApi } from './support/mock-api';
import { footerCart, mockFooterCart } from './support/cart-footer-mocks';
import { CHECKOUT_CART, CHECKOUT_QUOTE, mockCheckout } from './support/checkout-mocks';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';

/**
 * tubu-w3-06 trên Mini App 375px, API mock toàn bộ: dòng "Quà tặng dùng thử 0đ" ở Giỏ (chưa đủ mốc, đã chọn, đổi sang "Không nhận quà"),
 * Thanh toán gửi đúng quà đang thấy, và khối Giờ vàng đổi sang "Giờ Xanh Ưu Đãi" khi cờ bật (nút ＋ trên thẻ, không tràn ngang).
 * Đặt SHOT_DIR thì chụp từng trạng thái.
 */
test.use({ viewport: { width: 375, height: 812 } });

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

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/miniapp-${name}.png`, fullPage: true });
}

test.describe('Quà tặng dùng thử 0đ ở Giỏ Mini App', () => {
  test.beforeEach(({ api }) => {
    mockSession(api, makeUser({ id: 'user-gift-trial', fullName: 'Khách Quà' }));
  });

  test('chưa đủ mốc: một dòng nhắc số còn thiếu, không có nút', async ({ page, api }) => {
    const cart = mockFooterCart(api, { lines: 2, reached: true });
    api.get('/cart', { ...cart, giftTrial: { ...chosen(240_000), shortfall: 59_000, nextMinOrder: 299_000, selectedVariationId: null, options: [option(GIFT_ID, 299_000, false)] } });
    await page.goto('/cart');
    const row = page.getByTestId('gift-trial-row');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('Thêm 59.000đ để nhận quà dùng thử 0đ');
    await expect(row.getByTestId('gift-trial-change')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await shot(page, 'cart-gift-locked');
  });

  test('đã chọn quà: tên quà, mốc kế; "Đổi" mở tấm chọn, quà chưa mở bị khoá, chọn "Không nhận quà" gửi PUT /cart/gift null', async ({ page, api }) => {
    const cart = mockFooterCart(api, { lines: 3, reached: true });
    api.get('/cart', { ...cart, giftTrial: chosen(360_000) });
    api.put('/cart/gift', ({ call }) => ({
      ...footerCart({ lines: 3, reached: true }),
      giftTrial: { ...chosen(360_000), selectedVariationId: (call.body as { variationId: string | null }).variationId, declined: (call.body as { variationId: string | null }).variationId === null },
    }));
    await page.goto('/cart');
    const row = page.getByTestId('gift-trial-row');
    await expect(row).toContainText('Quà 0đ: Khăn giấy tre bỏ túi · Gói dùng thử', { timeout: 15_000 });
    await expect(row).toContainText('Thêm 139.000đ để mở thêm quà');
    const change = row.getByTestId('gift-trial-change');
    // Vùng chạm của nút chữ giãn tới 44px bằng ::after của `tubu-hit-44`, không phải chiều cao hộp chữ.
    const hit = await change.evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      return { min: Math.min(parseFloat(after.width) || el.getBoundingClientRect().width, parseFloat(after.height)), content: after.content };
    });
    expect(hit.content, 'nút Đổi có lớp giãn vùng chạm').not.toBe('none');
    expect(hit.min, 'vùng chạm nút Đổi ít nhất 44px').toBeGreaterThanOrEqual(44);
    await shot(page, 'cart-gift-chosen');

    await change.click();
    const options = page.getByTestId('gift-trial-option');
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(options.nth(1)).toHaveAttribute('aria-disabled', 'true');
    await expect(options.nth(1)).toContainText('Đơn từ 499.000đ');
    await shot(page, 'cart-gift-sheet');

    await options.nth(2).click();
    await expect.poll(() => api.callsTo('PUT', '/cart/gift').length).toBe(1);
    expect(api.callsTo('PUT', '/cart/gift')[0]!.body).toEqual({ variationId: null });
    await expect(row).toContainText('Không nhận quà dùng thử 0đ');
    await expect(row.getByTestId('gift-trial-change')).toHaveText('Chọn quà');
  });
});

test.describe('Quà tặng dùng thử 0đ ở Thanh toán Mini App', () => {
  test('báo giá có quà: dòng quà dưới tóm tắt, đặt đơn gửi giftVariationId của quà đang thấy', async ({ page, api }) => {
    mockCheckout(api);
    api.get('/cart', { ...CHECKOUT_CART, giftTrial: chosen(330_000) });
    api.post('/checkout/quote', { ...CHECKOUT_QUOTE, giftTrial: chosen(330_000) });
    await page.goto('/checkout');
    const row = page.getByTestId('gift-trial-row');
    await expect(row).toContainText('Quà 0đ: Khăn giấy tre bỏ túi', { timeout: 15_000 });
    await row.scrollIntoViewIfNeeded();
    await shot(page, 'checkout-gift');
    await page.getByRole('button', { name: /^Đặt hàng/ }).last().click();
    await expect.poll(() => api.callsTo('POST', '/checkout/place-order').length, { timeout: 10_000 }).toBe(1);
    expect((api.callsTo('POST', '/checkout/place-order')[0]!.body as { giftVariationId?: string | null }).giftVariationId).toBe(GIFT_ID);
  });
});

const HOUR = 3_600_000;
function mockFlash(api: MockApi, quotaLeft = true): void {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice,
      soldCount: !quotaLeft && i === 0 ? 50 : 10 + i * 12, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

test.describe('Giờ Xanh Ưu Đãi trên Trang chủ Mini App', () => {
  test('cờ bật: tiêu đề "Giờ Xanh Ưu Đãi", đồng hồ, thanh đã bán xanh, nút ＋ trên thẻ còn suất; không tràn ngang', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockFlash(api, false);
    api.get('/config/public', publicConfig({ flashGreenHourEnabled: true } as never));
    await page.goto('/');
    const region = page.getByRole('region', { name: 'Giờ Xanh Ưu Đãi', exact: true });
    await expect(region).toBeVisible({ timeout: 20_000 });
    await expect(region.getByRole('timer').first()).toBeVisible();
    await expect(region.getByTestId('flash-sold-bar').first()).toBeVisible();
    const adds = region.getByRole('button', { name: /^Thêm .* vào giỏ$/ });
    await expect(adds).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await region.scrollIntoViewIfNeeded();
    await shot(page, 'home-green-hour');
  });

  test('cờ tắt: khối giữ tên "Giờ vàng", không có nút ＋', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockFlash(api);
    await page.goto('/');
    const region = page.getByRole('region', { name: 'Giờ vàng', exact: true });
    await expect(region).toBeVisible({ timeout: 20_000 });
    await expect(region.getByRole('button', { name: /^Thêm .* vào giỏ$/ })).toHaveCount(0);
    await region.scrollIntoViewIfNeeded();
    await shot(page, 'home-golden-hour');
  });
});
