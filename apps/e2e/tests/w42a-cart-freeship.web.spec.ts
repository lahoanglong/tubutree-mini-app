import type { Locator, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';

/**
 * W42A, web khách (project di động) ở 320/360/375/393px: thanh Miễn phí giao hàng và dải món bù đơn ở ĐẦU Giỏ.
 * Giỏ là trang client nên mọi dữ liệu đi qua mock, không cần seed: giỏ có một dòng 300.000đ, ngưỡng 500.000đ, kệ Bán chạy nhất gồm sáu món để dải luôn đủ 3 món
 * sau mỗi lần thêm. Host phải là localhost (baseURL). Không đặt đơn thật.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 360, height: 780 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

const THRESHOLD = 500_000;
const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const USER = {
  id: 'u-w42a-cart', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};
// Còn thiếu 200.000: "Khoai" (210.000) đóng được khoảng thiếu nên đứng đầu; thêm "Bơ" (60.000) thì còn thiếu 140.000 và "Mận" (150.000) thành món đóng.
const BEST = [
  { slug: 'bo', name: 'Bơ', price: 60_000 },
  { slug: 'khoai', name: 'Khoai', price: 210_000 },
  { slug: 'dau', name: 'Dâu', price: 120_000 },
  { slug: 'man', name: 'Mận', price: 150_000 },
  { slug: 'oi', name: 'Ổi', price: 40_000 },
  { slug: 'sau-rieng', name: 'Sầu riêng', price: 400_000 },
] as const;

interface Line {
  id: string;
  variationId: string;
  productName: string;
  slug: string;
  unitPrice: number;
}

function mockCart(api: MockApi): { lines: () => Line[] } {
  const lines: Line[] = [{ id: 'l0', variationId: 'v-ban-dau', productName: 'Serum dưỡng ẩm', slug: 'serum', unitPrice: 300_000 }];
  const cart = () => {
    const subtotal = lines.reduce((s, l) => s + l.unitPrice, 0);
    return {
      items: lines.map((l) => ({
        id: l.id, variationId: l.variationId, productName: l.productName, variationName: 'Mặc định', slug: l.slug, thumbnail: null,
        unitPrice: l.unitPrice, quantity: 1, stock: 9, total: l.unitPrice, fulfiller: TUBU,
      })),
      couponCode: null, subtotal, discount: 0, freeship: subtotal >= THRESHOLD, freeshipThreshold: THRESHOLD, itemCount: lines.length,
    };
  };
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', USER);
  api.get('/auth/me', { ...USER, ownsBrand: false });
  api.get('/me/coupons', []);
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 0, pointsConvertedBalance: 0 });
  api.get('/cart', cart);
  api.post('/cart/items', ({ call }) => {
    const body = call.body as { variationId: string };
    const item = BEST.find((b) => `v-${b.slug}` === body.variationId)!;
    lines.push({ id: `l-${item.slug}`, variationId: body.variationId, productName: item.name, slug: item.slug, unitPrice: item.price });
    return cart();
  });
  api.get('/products', {
    data: BEST.map((b) => ({
      id: b.slug, slug: b.slug, brand: 'Tubu', name: b.name, thumbnail: null, basePrice: b.price, salePrice: null, isFeatured: false, inStock: true,
      repVariationId: `v-${b.slug}`, fulfiller: TUBU,
    })),
    meta: { page: 1, limit: 10, total: BEST.length },
  });
  return { lines: () => lines };
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const progress = (page: Page) => page.getByTestId('freeship-progress');
const addButton = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^Thêm ${name} vào giỏ`) });

async function openCart(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  await page.goto('/gio-hang');
  await expect(progress(page)).toBeVisible({ timeout: 20_000 });
}

async function expectTouchTarget44(t: Locator): Promise<void> {
  const b = (await t.boundingBox())!;
  expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
  expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
}

for (const vp of VIEWPORTS) {
  test.describe(`Web khách ${vp.width}px: Giỏ — Miễn phí giao hàng`, () => {
    test.use({ viewport: vp });

    test.beforeEach(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Thanh Miễn phí giao hàng kiểm ở khổ điện thoại, chỉ project Web Customer Mobile');
    });

    test('thanh và dải ở ĐẦU giỏ (trên "Chọn tất cả"), chân dính không còn dòng Miễn phí giao hàng, không tràn ngang', async ({ page, api }) => {
      mockCart(api);
      await openCart(page);

      await expect(progress(page)).toContainText('Mua thêm 200.000đ để được Miễn phí giao hàng');
      await expect(progress(page)).toHaveAttribute('data-reached', 'false');
      const bar = page.getByRole('progressbar');
      await expect(bar).toHaveAttribute('aria-valuenow', '60');
      await expect(bar).toHaveAttribute('aria-label', 'Đã đạt 60% để được Miễn phí giao hàng');

      const top = (await progress(page).boundingBox())!;
      const selectAll = (await page.getByLabel('Chọn tất cả sản phẩm').locator('xpath=ancestor::label').boundingBox())!;
      const line = (await page.getByTestId('cart-line').first().boundingBox())!;
      expect(top.y).toBeLessThan(selectAll.y);
      expect(selectAll.y).toBeLessThan(line.y);

      await expect(page.getByTestId('freeship-addons')).toBeVisible();
      const cards = page.getByTestId('freeship-addon');
      expect(await cards.count()).toBeGreaterThanOrEqual(3);
      expect(await cards.count()).toBeLessThanOrEqual(5);
      await expect(cards.first()).toHaveAttribute('data-slug', 'khoai');
      await expect(page.getByTestId('freeship-addon').filter({ hasText: 'Sầu riêng' })).toHaveCount(0);
      const buttons = page.getByTestId('freeship-add');
      for (let i = 0; i < (await buttons.count()); i += 1) {
        await buttons.nth(i).scrollIntoViewIfNeeded();
        await expectTouchTarget44(buttons.nth(i));
      }

      await expect(page.getByTestId('sticky-bar')).not.toContainText('Miễn phí giao hàng');
      await expect(page.getByTestId('sticky-bar').getByTestId('freeship-bar')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('một chạm "+ Thêm": thanh đổi mức, món vừa thêm rời dải; thêm tiếp đạt ngưỡng thì chúc mừng và dải thu lại', async ({ page, api }) => {
      const shop = mockCart(api);
      await openCart(page);
      const bar = page.getByRole('progressbar');

      const first = api.waitForCall('POST', '/cart/items');
      await addButton(page, 'Bơ').click();
      expect((await first).body).toMatchObject({ variationId: 'v-bo', quantity: 1 });
      await expect(bar).toHaveAttribute('aria-valuenow', '72');
      await expect(progress(page)).toContainText('Mua thêm 140.000đ');
      await expect(page.getByTestId('freeship-addon').filter({ hasText: 'Bơ' })).toHaveCount(0);
      await expect(page.getByTestId('cart-line')).toHaveCount(2);
      expect(await noHorizontalScroll(page)).toBe(true);

      const second = api.waitForCall('POST', '/cart/items');
      await addButton(page, 'Mận').click();
      expect((await second).body).toMatchObject({ variationId: 'v-man', quantity: 1 });
      expect(shop.lines()).toHaveLength(3);
      await expect(progress(page)).toHaveAttribute('data-reached', 'true');
      await expect(progress(page)).toHaveText('🎉 Đơn hàng đã được Miễn phí giao hàng');
      await expect(page.getByTestId('freeship-bar')).toHaveCount(0);
      await expect(page.getByTestId('freeship-addons')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('giảm chuyển động: thanh không còn chuyển động đầy dần và ánh chạy', async ({ page, api }) => {
      mockCart(api);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openCart(page);
      const motion = await page.getByTestId('freeship-fill').evaluate((el) => ({
        transition: getComputedStyle(el).transitionDuration,
        shimmer: getComputedStyle(el, '::after').animationName,
      }));
      expect(motion.transition).toBe('0s');
      expect(motion.shimmer).toBe('none');
    });
  });
}
