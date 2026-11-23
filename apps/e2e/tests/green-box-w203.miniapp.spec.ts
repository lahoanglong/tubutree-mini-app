import { mkdirSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { mockPilotCart, PILOT_CART } from './support/pilot-mocks';
import { CHECKOUT_QUOTE, mockCheckout } from './support/checkout-mocks';

/**
 * Wave tubu-w2-03, Mini App ở 360×780 và 393×852 (API mock toàn bộ):
 * - giỏ đã đạt Miễn phí giao hàng: dải Hộp Xanh THAY dải đó (một dải tại một thời điểm), mốc 3 · 5 · 7, dòng "Hộp Xanh −{tiền}" ở chân dính; bậc cao nhất
 *   chỉ một dòng; nút "Ghép thêm" của dải mở trang ghép `/green-box` (w17-01, cùng dữ liệu với web `/hop-xanh`);
 * - `/green-box`: nhóm theo danh mục, thanh "Đã chọn {n} món · giảm {pct}%" đọc giỏ máy chủ, một nút "Xem giỏ" về giỏ;
 * - chưa đạt Miễn phí giao: dải Miễn phí giao giữ nguyên, thêm một dòng nhỏ "Thêm {n} món nữa giảm {pct}% Hộp Xanh" trên tổng;
 * - API không có trường Hộp Xanh (cờ tắt): giỏ như cũ;
 * - thanh toán: dòng "Hộp Xanh −{tiền}" tách khỏi dòng combo.
 * Đặt W203_SHOT_DIR để chụp ảnh.
 */
const TIERS = [
  { minItems: 3, pct: 3 },
  { minItems: 5, pct: 5 },
  { minItems: 7, pct: 7 },
];
const THRESHOLD = 200_000;
const pageCard = (slug: string, name: string, price: number) => ({
  id: `p-${slug}`, slug, brand: 'Tubu', name, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${slug}`,
});
const GREEN_BOX_PAGE = {
  enabled: true,
  tiers: TIERS,
  groups: [
    { category: { id: 'c-bep', name: 'Nhà bếp', slug: 'nha-bep' }, products: [pageCard('rua-chen', 'Nước rửa chén', 65_000), pageCard('khan-lau', 'Khăn lau', 35_000)] },
    { category: { id: 'c-tam', name: 'Phòng tắm', slug: 'phong-tam' }, products: [pageCard('xa-phong', 'Xà phòng', 45_000), pageCard('ban-chai', 'Bàn chải', 30_000)] },
  ],
};
const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.W203_SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `mini-${page.viewportSize()?.width}-${name}.png`) });
}

/** Giỏ `n` dòng khác nhau giá `price`; `box` null = API cũ / cờ tắt (không có trường Hộp Xanh). */
function greenCart(n: number, price: number, box: { tier: (typeof TIERS)[number] | null; next: (typeof TIERS)[number] | null; discount: number } | null) {
  const subtotal = n * price;
  return {
    ...PILOT_CART,
    items: Array.from({ length: n }, (_, i) => ({
      ...PILOT_CART.items[0]!,
      id: `gb-${i}`,
      variationId: `v-gb-${i}`,
      slug: `sp-gb-${i}`,
      productName: `Sản phẩm xanh ${i + 1}`,
      variationName: 'Mặc định',
      unitPrice: price,
      quantity: 1,
      stock: 20,
      total: price,
    })),
    subtotal,
    freeship: subtotal >= THRESHOLD,
    freeshipThreshold: THRESHOLD,
    itemCount: n,
    ...(box ? { comboDiscount: box.discount, greenBoxDiscount: box.discount, greenBox: { items: n, tier: box.tier, next: box.next, tiers: TIERS, discount: box.discount } } : {}),
  };
}

function mockGreenCart(api: MockApi, cart: ReturnType<typeof greenCart>): void {
  mockPilotCart(api);
  api.get('/cart', cart);
  api.get('/products', { data: [], meta: { page: 1, limit: 24, total: 0 } });
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => Math.max(...[document.documentElement, ...document.querySelectorAll<HTMLElement>('.zaui-page')].map((el) => el.scrollWidth - el.clientWidth)) <= 0);

for (const vp of [
  { width: 360, height: 780 },
  { width: 393, height: 852 },
]) {
  test.describe(`w2-03 Hộp Xanh Mini ${vp.width}`, () => {
    test.use({ viewport: vp });

    test('đã đạt Miễn phí giao: dải Hộp Xanh thay dải Miễn phí giao, mốc 3 · 5 · 7, dòng Hộp Xanh ở chân, "Ghép thêm" mở trang ghép, không tràn ngang', async ({ page, api }) => {
      mockGreenCart(api, greenCart(4, 60_000, { tier: TIERS[0]!, next: TIERS[1]!, discount: 7_200 }));
      api.get('/bundles/green-box', GREEN_BOX_PAGE);
      await page.goto('/cart');
      const strip = page.getByTestId('green-box-progress');
      await expect(strip).toBeVisible({ timeout: 20_000 });
      await expect(strip).toContainText('Hộp Xanh đang giảm 3%. Thêm 1 món nữa giảm 5%');
      await expect(strip).toHaveAttribute('data-reached', 'false');
      await expect(page.getByTestId('freeship-progress')).toHaveCount(0);
      await expect(page.getByTestId('green-box-marks')).toHaveText('Mốc 3 · 5 · 7 món');
      const bar = strip.getByRole('progressbar');
      await expect(bar).toHaveAttribute('aria-valuenow', '57');
      await expect(bar).toHaveAttribute('aria-label', 'Mốc 3 · 5 · 7 món');
      const more = page.getByTestId('green-box-more-cta');
      await expect(more).toHaveCount(1);
      expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const row = page.locator('[data-ds="cart-green-box"]');
      await expect(row).toContainText('Hộp Xanh');
      await expect(row).toContainText(`-${vnd(7_200)}`);
      await expect(page.getByTestId('green-box-hint')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shoot(page, 'cart-green-box');

      await more.click();
      await expect(page).toHaveURL(/\/green-box$/);
      await expect(page.getByRole('heading', { name: 'Hộp Xanh tự chọn' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Nhà bếp' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Phòng tắm' })).toBeVisible();
      await expect(page.getByTestId('green-box-bar-text')).toHaveText('Đã chọn 4 món · giảm 3%');
      await expect(page.getByTestId('green-box-view-cart')).toHaveCount(1);
      const stepper = page.getByTestId('green-box-stepper');
      await expect(stepper.getByTestId('green-box-step')).toHaveText(['3 món-3%', '5 món-5%', '7 món-7%']);
      await expect(stepper.getByTestId('green-box-stepper-text')).toHaveText('Thêm 1 món nữa');
      await expect(stepper).toContainText('Giảm 5%');
      const jump = page.getByRole('region', { name: 'Chọn nhanh danh mục' });
      await expect(jump.getByRole('button')).toHaveText(['Nhà bếp(2)', 'Phòng tắm(2)']);
      for (const chip of await jump.getByRole('button').all()) expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(36);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shoot(page, 'green-box-page');
      // Chạm chip: tiêu đề mục nằm ngay dưới hàng chip dính, không bị che.
      await jump.getByRole('button', { name: /^Phòng tắm/ }).click();
      const heading = page.getByRole('heading', { name: 'Phòng tắm' });
      await expect.poll(async () => {
        const [h, j] = await Promise.all([heading.boundingBox(), jump.boundingBox()]);
        return h && j ? Math.round(h.y - (j.y + j.height)) : -999;
      }).toBeGreaterThanOrEqual(0);
      await expect(heading).toBeInViewport();
      // Hàng chip dính sát dưới thanh lùi đặc (56px khi có nút lùi), không hở thêm phần đệm đầu trang.
      await expect.poll(async () => Math.round((await jump.boundingBox())?.y ?? -1)).toBeLessThanOrEqual(56);
      await page.getByTestId('green-box-view-cart').click();
      await expect(page).toHaveURL(/\/cart$/);
      await expect(page.getByTestId('green-box-progress')).toBeVisible({ timeout: 20_000 });
    });

    test('/green-box khi cờ tắt: báo chưa mở, có lối sang danh mục', async ({ page, api }) => {
      mockGreenCart(api, greenCart(1, 60_000, null));
      api.get('/bundles/green-box', { enabled: false, tiers: [], groups: [] });
      await page.goto('/green-box');
      await expect(page.getByRole('heading', { name: 'Hộp Xanh tự chọn' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('green-box-bar-text')).toHaveCount(0);
      await expect(page.getByTestId('green-box-view-cart')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('bậc cao nhất: một dòng xác nhận, không thanh', async ({ page, api }) => {
      mockGreenCart(api, greenCart(7, 40_000, { tier: TIERS[2]!, next: null, discount: 19_600 }));
      await page.goto('/cart');
      const strip = page.getByTestId('green-box-progress');
      await expect(strip).toHaveText('Hộp Xanh đã giảm 7%, mức cao nhất', { timeout: 20_000 });
      await expect(strip).toHaveAttribute('data-reached', 'true');
      await expect(strip.getByRole('progressbar')).toHaveCount(0);
      const box = (await strip.boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(48);
      await shoot(page, 'cart-green-box-top');
    });

    test('chưa đạt Miễn phí giao: chỉ dải Miễn phí giao, thêm một dòng nhỏ Hộp Xanh trên tổng', async ({ page, api }) => {
      mockGreenCart(api, greenCart(2, 60_000, { tier: null, next: TIERS[0]!, discount: 0 }));
      await page.goto('/cart');
      await expect(page.getByTestId('freeship-progress')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('green-box-progress')).toHaveCount(0);
      await expect(page.getByTestId('green-box-hint')).toHaveText('Thêm 1 món nữa giảm 3% Hộp Xanh');
      await expect(page.locator('[data-ds="cart-green-box"]')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shoot(page, 'cart-green-box-hint');
    });

    test('API không có trường Hộp Xanh (cờ tắt): giỏ như cũ, không dải, không dòng, không gợi ý', async ({ page, api }) => {
      mockGreenCart(api, greenCart(4, 60_000, null));
      await page.goto('/cart');
      await expect(page.getByTestId('freeship-progress')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('green-box-progress')).toHaveCount(0);
      await expect(page.getByTestId('green-box-hint')).toHaveCount(0);
      await expect(page.locator('[data-ds="cart-green-box"]')).toHaveCount(0);
      await shoot(page, 'cart-before-flag-off');
    });

    test('thanh toán: dòng Hộp Xanh tách khỏi combo, tổng giữ nguyên số máy chủ', async ({ page, api }) => {
      mockCheckout(api);
      const quote = { ...CHECKOUT_QUOTE, comboDiscount: 3_900, greenBoxDiscount: 3_900, total: CHECKOUT_QUOTE.total - 3_900 };
      api.post('/checkout/quote', quote);
      await page.goto('/checkout');
      const total = page.locator('[data-ds="checkout-summary-total"]');
      await expect(total).toContainText(vnd(quote.total), { timeout: 20_000 });
      await expect(page.getByText('Hộp Xanh', { exact: true }).first()).toBeVisible();
      await expect(page.getByText(`-${vnd(3_900)}`).first()).toBeVisible();
      await expect(page.getByText(/combo/i)).toHaveCount(0);
      await shoot(page, 'checkout-green-box');
    });
  });
}
