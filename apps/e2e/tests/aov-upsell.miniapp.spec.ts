import type { Page } from '@playwright/test';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { expect, makeUser, mockSession, publicConfig, test, type MockApi } from './support/mock-api';
import { footerCart, mockFooterCart } from './support/cart-footer-mocks';

/**
 * tubu-w7-02 trên Mini App, API mock toàn bộ: dải mua thêm món nhỏ ở đầu Giỏ nhắm mốc Miễn phí giao hàng (giỏ 90.000đ, mốc 200.000đ), rồi mốc quà dùng thử 0đ
 * (giỏ 240.000đ đã qua mốc giao, quà từ 300.000đ). Kiểm dòng đầu, tối đa 4 thẻ, nút "+ Thêm" 44×44, không tràn ngang ở 360/390, và một chạm vượt mốc quà mở ô quà
 * khi giỏ đọc lại. Đặt SHOT_DIR thì chụp từng trạng thái.
 */
const card = (slug: string, name: string, price: number) => ({
  id: `p-${slug}`, slug, brand: 'Tubu', name, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${slug}`,
});
// Cùng bộ món với aov-upsell.web.spec.ts: "Bộ quà lớn" vượt trần 120.000đ, "Khăn tre dùng thử" là chính món quà 0đ.
const UPSELL = [
  card('nuoc-rua-chen-mini', 'Nước rửa chén sinh học 250ml', 115_000),
  card('binh-nuoc', 'Bình nước thuỷ tinh', 65_000),
  card('xa-phong-sa', 'Xà phòng sả chanh', 45_000),
  card('khan-tre', 'Khăn tre dùng thử', 40_000),
  card('bo-qua-lon', 'Bộ quà lớn', 150_000),
  card('ban-chai-tre', 'Bàn chải tre', 35_000),
  card('tui-luoi', 'Túi lưới đi chợ', 25_000),
  card('mieng-rua', 'Miếng rửa xơ mướp', 15_000),
];
const GIFT = 'v-khan-tre';
const gift = (base: number): GiftTrialSummaryDTO => ({
  base,
  minOrder: 300_000,
  nextMinOrder: base >= 300_000 ? null : 300_000,
  shortfall: Math.max(0, 300_000 - base),
  options: [{ variationId: GIFT, productName: 'Khăn tre dùng thử', variationName: 'Gói 3 cái', slug: 'khan-tre', thumbnail: null, minOrder: 300_000, unlocked: base >= 300_000 }],
  selectedVariationId: base >= 300_000 ? GIFT : null,
  declined: false,
});
const cartAt = (unit: number) => {
  const cart = footerCart({ lines: 2, reached: false, unit });
  return { ...cart, freeship: cart.subtotal >= 200_000, giftTrial: gift(cart.subtotal) };
};
const slugs = (page: Page) => page.getByTestId('freeship-addon').evaluateAll((els) => els.map((e) => e.getAttribute('data-slug')));

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/miniapp-${name}.png`, fullPage: false });
}

async function openCart(page: Page, api: MockApi, width: number, cart: ReturnType<typeof cartAt>) {
  mockSession(api, makeUser({ id: 'user-aov', fullName: 'Khách Mua Thêm' }));
  mockFooterCart(api, { lines: 2, reached: false });
  api.get('/cart', cart);
  api.get('/config/public', publicConfig({ freeshipBoosterEnabled: true }));
  api.get('/upsell/freeship', UPSELL);
  api.get('/flash-sales/active', []);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 812 });
  await page.goto('/cart');
  await expect(page.getByTestId('freeship-addons')).toBeVisible({ timeout: 15_000 });
}

async function expectRailFits(page: Page, width: number) {
  const rail = page.getByTestId('freeship-addons');
  expect(await rail.getByTestId('freeship-addon').count()).toBeLessThanOrEqual(4);
  const box = (await rail.getByTestId('freeship-add').first().boundingBox())!;
  expect(Math.min(box.width, box.height), 'nút "+ Thêm" tối thiểu 44×44').toBeGreaterThanOrEqual(44);
  expect(await rail.locator('.tubu-addon-title').evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'không tràn ngang').toBeLessThanOrEqual(width);
}

test.describe('Mini App Giỏ: dải mua thêm món nhỏ chạm mốc (tubu-w7-02)', () => {
  for (const width of [360, 390]) {
    test(`${width}px, chưa Miễn phí giao hàng: thanh nói số còn thiếu, dải không lặp, món nhỏ bù đủ trước, không món quà, không món quá 120.000đ`, async ({ page, api }) => {
      await openCart(page, api, width, cartAt(45_000));
      const rail = page.getByTestId('freeship-addons');
      await expect(rail).toHaveAttribute('data-stage', 'freeship');
      await expect(rail.getByRole('heading')).toHaveText('Gợi ý mua thêm cho đủ Miễn phí giao hàng');
      await expect(page.getByTestId('freeship-progress')).toContainText('Mua thêm 110.000đ để được Miễn phí giao hàng');
      expect(api.callsTo('GET', '/upsell/freeship')[0]!.query.get('gap')).toBe('110000');
      expect(await slugs(page)).toEqual(['nuoc-rua-chen-mini', 'binh-nuoc', 'xa-phong-sa', 'ban-chai-tre']);
      await expectRailFits(page, width);
      await shot(page, `aov-freeship-${width}`);
    });

    test(`${width}px, đã Miễn phí giao hàng: dòng đầu nói số còn thiếu tới quà dùng thử 0đ, ô quà khoá không nói lại`, async ({ page, api }) => {
      await openCart(page, api, width, cartAt(120_000));
      const rail = page.getByTestId('freeship-addons');
      await expect(rail).toHaveAttribute('data-stage', 'gift');
      await expect(rail.getByRole('heading')).toHaveText('Thêm 60.000đ nữa để nhận quà dùng thử 0đ');
      expect(api.callsTo('GET', '/upsell/freeship')[0]!.query.get('gap')).toBe('60000');
      expect(await slugs(page)).toEqual(['binh-nuoc', 'xa-phong-sa', 'ban-chai-tre', 'tui-luoi']);
      await expect(page.getByTestId('gift-trial-row')).toHaveCount(0);
      await expectRailFits(page, width);
      await shot(page, `aov-gift-${width}`);
    });
  }

  test('390px: một chạm "+ Thêm" vượt mốc quà, dải rời đi ngay, ô quà mở khi giỏ đọc lại (không rời trang)', async ({ page, api }) => {
    const before = cartAt(120_000);
    const added = { ...before.items[0]!, id: 'ft-add', variationId: 'v-binh-nuoc', slug: 'binh-nuoc', productName: 'Bình nước thuỷ tinh', unitPrice: 65_000, total: 65_000, listUnitPrice: 65_000 };
    const subtotal = before.subtotal + 65_000;
    const after = { ...before, items: [...before.items, added], subtotal, itemCount: before.itemCount + 1, freeship: true, giftTrial: gift(subtotal) };
    await openCart(page, api, 390, before);
    api.post('/cart/items', () => {
      api.get('/cart', after);
      return after;
    });
    const url = page.url();
    await page.getByTestId('freeship-addons').locator('[data-slug="binh-nuoc"]').getByTestId('freeship-add').click();
    await expect.poll(() => api.callsTo('POST', '/cart/items').length).toBe(1);
    expect(api.callsTo('POST', '/cart/items')[0]!.body).toMatchObject({ variationId: 'v-binh-nuoc', quantity: 1 });
    await expect(page.getByTestId('freeship-addons')).toHaveCount(0);
    const row = page.getByTestId('gift-trial-row');
    await expect(row).toHaveAttribute('data-state', 'chosen', { timeout: 10_000 });
    await expect(row).toContainText('Khăn tre dùng thử');
    expect(page.url()).toBe(url);
    await row.scrollIntoViewIfNeeded();
    await shot(page, 'aov-gift-unlocked-390');
  });
});
