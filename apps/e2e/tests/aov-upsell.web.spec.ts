import type { Page } from '@playwright/test';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { expect, publicConfig, test, type MockApi } from './support/mock-api';
import { footerCart } from './support/cart-footer-mocks';

/**
 * tubu-w7-02 trên web `/gio-hang`, API trình duyệt mock toàn bộ: dải mua thêm món nhỏ ở đầu Giỏ nhắm mốc Miễn phí giao hàng (giỏ 90.000đ, mốc 200.000đ),
 * rồi mốc quà dùng thử 0đ (giỏ 240.000đ đã qua mốc giao, quà từ 300.000đ). Kiểm dòng đầu, tối đa 4 thẻ, nút "+ Thêm" 44×44, không tràn ngang ở 360/390/1440,
 * và một chạm vượt mốc quà mở ô quà theo giỏ máy chủ trả. Đặt SHOT_DIR thì chụp từng khổ.
 */
const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};
const card = (slug: string, name: string, price: number) => ({
  id: `p-${slug}`, slug, brand: 'Tubu', name, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${slug}`,
});
// Món nhỏ tối đa 120.000đ: "Bộ quà lớn" vượt trần nên không bao giờ lên dải; "Khăn tre dùng thử" là chính món quà 0đ nên cũng không.
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
const cartAt = (unit: number, lines = 2) => {
  const cart = footerCart({ lines, reached: false, unit });
  const items = cart.items.map((l) => ({ ...l, weight: 600 }));
  return { ...cart, items, freeship: cart.subtotal >= 200_000, giftTrial: gift(cart.subtotal) };
};

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/web-${name}.png`, fullPage: false });
}
const pageWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer', 'Khổ do spec tự đặt, một project là đủ');
});

async function openCart(page: Page, api: MockApi, width: number, cart: ReturnType<typeof cartAt>) {
  // Thiếu cookie phiên thì middleware phục vụ bản dựng sẵn cho khách (tubu-w7-01), cấu hình nạp ở máy chủ đè cấu hình giả của spec.
  await page.context().addCookies([{ name: 'tubu_web_session', value: '1', domain: 'localhost', path: '/' }]);
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
  api.get('/config/public', publicConfig({ freeshipBoosterEnabled: true }));
  api.get('/cart', cart);
  api.get('/upsell/freeship', UPSELL);
  api.get('/flash-sales/active', []);
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available', 'GET /checkout/shipping-estimate');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/gio-hang');
  await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
}

async function expectRailFits(page: Page, width: number) {
  const rail = page.getByTestId('freeship-addons');
  const cards = rail.getByTestId('freeship-addon');
  await expect(cards).toHaveCount(2);
  await expect(rail.locator('.scroll-x')).toHaveCount(0);
  const add = cards.first().getByTestId('freeship-add');
  const box = (await add.boundingBox())!;
  expect(Math.min(box.width, box.height), 'nút "+ Thêm" tối thiểu 44×44').toBeGreaterThanOrEqual(44);
  expect(await rail.locator('.tubu-addon-head').evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
  expect(await pageWidth(page), 'không tràn ngang').toBeLessThanOrEqual(width);
}

/** Thanh hai mốc (tubu-w13-01): vạch mốc Miễn phí giao hàng, hai nhãn mốc số đều nằm trọn trong khổ, mốc đầu đạt đúng theo giỏ. */
async function expectTwoMilestones(page: Page, width: number, freeshipReached: boolean) {
  const bar = page.getByTestId('freeship-progress');
  await expect(bar).toHaveAttribute('data-gift', 'locked');
  await expect(bar.getByTestId('freeship-mark')).toHaveCount(1);
  const marks = bar.getByTestId('freeship-milestone');
  await expect(marks).toHaveCount(2);
  await expect(marks.nth(0)).toHaveAttribute('data-reached', freeshipReached ? 'true' : 'false');
  await expect(marks.nth(1)).toHaveAttribute('data-reached', 'false');
  await expect(marks.nth(0)).toContainText('200.000đ Miễn phí giao hàng');
  await expect(marks.nth(1)).toContainText('300.000đ Quà dùng thử');
  expect(await bar.getByTestId('freeship-milestones').evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
  for (const box of await marks.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
    expect(box, 'nhãn mốc không tràn khổ').toBeLessThanOrEqual(width);
  }
}

test.describe('Web /gio-hang: dải mua thêm món nhỏ chạm mốc (tubu-w7-02)', () => {
  for (const width of [320, 375, 393, 1440]) {
    test(`${width}px, chưa Miễn phí giao hàng: thanh nói số còn thiếu, dải không lặp, món nhỏ bù đủ trước, không món quà, không món quá 120.000đ`, async ({ page, api }) => {
      await openCart(page, api, width, cartAt(45_000));
      const rail = page.getByTestId('freeship-addons');
      await expect(rail).toHaveAttribute('data-stage', 'freeship', { timeout: 15_000 });
      await expect(rail.getByRole('heading')).toHaveText('Gợi ý mua thêm cho đủ Miễn phí giao hàng');
      await expect(page.getByTestId('freeship-progress')).toContainText('Mua thêm 110.000đ để được Miễn phí giao hàng');
      expect(api.callsTo('GET', '/upsell/freeship')[0]!.query.get('gap')).toBe('110000');
      expect(await rail.getByTestId('freeship-addon').evaluateAll((els) => els.map((e) => e.getAttribute('data-slug')))).toEqual(['nuoc-rua-chen-mini', 'binh-nuoc']);
      await expectRailFits(page, width);
      await expectTwoMilestones(page, width, false);
      await rail.scrollIntoViewIfNeeded();
      await shot(page, `aov-freeship-${width}`);
    });

    test(`${width}px, đã Miễn phí giao hàng: dòng đầu nói số còn thiếu tới quà dùng thử 0đ, ô quà khoá không nói lại`, async ({ page, api }) => {
      await openCart(page, api, width, cartAt(120_000));
      const rail = page.getByTestId('freeship-addons');
      await expect(rail).toHaveAttribute('data-stage', 'gift', { timeout: 15_000 });
      await expect(rail.getByRole('heading')).toHaveText('Thêm 60.000đ nữa để nhận quà dùng thử 0đ');
      expect(api.callsTo('GET', '/upsell/freeship')[0]!.query.get('gap')).toBe('60000');
      // 115.000đ vượt số còn thiếu + 45.000đ nên rời dải; "binh-nuoc" bù đủ mốc quà một mình nên đứng đầu.
      expect(await rail.getByTestId('freeship-addon').evaluateAll((els) => els.map((e) => e.getAttribute('data-slug')))).toEqual(['binh-nuoc', 'xa-phong-sa']);
      await expect(page.getByTestId('gift-trial-row')).toHaveCount(0);
      await expect(page.getByTestId('freeship-progress')).toContainText('Đơn hàng đã được Miễn phí giao hàng');
      await expect(page.getByTestId('freeship-progress')).not.toContainText('60.000đ');
      await expectRailFits(page, width);
      await expectTwoMilestones(page, width, true);
      await rail.scrollIntoViewIfNeeded();
      await shot(page, `aov-gift-${width}`);
    });
  }

  test('390px: một chạm "+ Thêm" vượt mốc quà, dải rời đi và ô quà mở ngay theo giỏ máy chủ trả (không tải lại trang)', async ({ page, api }) => {
    const before = cartAt(120_000);
    const added = { ...before.items[0]!, id: 'ft-add', variationId: 'v-binh-nuoc', slug: 'binh-nuoc', productName: 'Bình nước thuỷ tinh', unitPrice: 65_000, total: 65_000, listUnitPrice: 65_000 };
    const subtotal = before.subtotal + 65_000;
    const after = { ...before, items: [...before.items, added], subtotal, itemCount: before.itemCount + 1, freeship: true, giftTrial: gift(subtotal) };
    await openCart(page, api, 390, before);
    api.post('/cart/items', () => {
      api.get('/cart', after);
      return after;
    });
    const rail = page.getByTestId('freeship-addons');
    await expect(rail).toHaveAttribute('data-stage', 'gift', { timeout: 15_000 });
    const navigations: string[] = [];
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) navigations.push(f.url());
    });
    await rail.locator('[data-slug="binh-nuoc"]').getByTestId('freeship-add').click();
    await expect.poll(() => api.callsTo('POST', '/cart/items').length).toBe(1);
    expect(api.callsTo('POST', '/cart/items')[0]!.body).toMatchObject({ variationId: 'v-binh-nuoc', quantity: 1 });
    await expect(rail).toHaveCount(0);
    const row = page.getByTestId('gift-trial-row');
    await expect(row).toHaveAttribute('data-state', 'chosen');
    await expect(row).toContainText('Khăn tre dùng thử');
    expect(navigations, 'không tải lại trang').toEqual([]);
    await row.scrollIntoViewIfNeeded();
    await shot(page, 'aov-gift-unlocked-390');
  });
});
