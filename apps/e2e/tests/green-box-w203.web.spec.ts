import { mkdirSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';
import { CHECKOUT_QUOTE, mockCheckout, mockWebCheckoutExtras } from './support/checkout-mocks';
import { probeTapTargets } from './support/touch-probe';

/**
 * Wave tubu-w2-03, web khách ở 390×844 ("Web Customer Mobile") và 1440×900 ("Web Customer"); lời gọi /api/** từ trình duyệt đi qua mock:
 * - giỏ đã đạt Miễn phí giao: dải Hộp Xanh thay dải đó, nút "Ghép thêm" mở /hop-xanh; chưa đạt: một dòng nhỏ dưới tổng;
 * - /hop-xanh: nhóm theo danh mục, nút ＋ thêm vào giỏ thường, thanh "Đã chọn {n} món · giảm {pct}%" + "Xem giỏ"; cờ tắt thì báo chưa mở;
 * - thanh toán: dòng "Hộp Xanh −{tiền}" tách khỏi combo;
 * - tab Định kỳ chưa có gói: một dòng gợi ý theo nhịp mua, chạm mở sheet Đặt định kỳ đã chọn sẵn chu kỳ.
 * Đặt W203_SHOT_DIR để chụp ảnh.
 */
const TIERS = [
  { minItems: 3, pct: 3 },
  { minItems: 5, pct: 5 },
  { minItems: 7, pct: 7 },
];
const THRESHOLD = 200_000;
const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const viewportOf = (project: string) => (project === 'Web Customer Mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
const runsHere = (project: string) => project === 'Web Customer' || project === 'Web Customer Mobile';

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.W203_SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `web-${page.viewportSize()?.width}-${name}.png`) });
}

type Box = { tier: (typeof TIERS)[number] | null; next: (typeof TIERS)[number] | null; discount: number };
function greenCart(n: number, price: number, box: Box | null) {
  const subtotal = n * price;
  return {
    items: Array.from({ length: n }, (_, i) => ({
      id: `gb-${i}`,
      variationId: `v-gb-${i}`,
      productName: `Sản phẩm xanh ${i + 1}`,
      variationName: 'Mặc định',
      slug: `sp-gb-${i}`,
      thumbnail: null,
      unitPrice: price,
      quantity: 1,
      stock: 20,
      total: price,
      fulfiller: TUBU,
    })),
    couponCode: null,
    subtotal,
    discount: 0,
    freeship: subtotal >= THRESHOLD,
    freeshipThreshold: THRESHOLD,
    itemCount: n,
    ...(box ? { comboDiscount: box.discount, greenBoxDiscount: box.discount, greenBox: { items: n, tier: box.tier, next: box.next, tiers: TIERS, discount: box.discount } } : {}),
  };
}

const card = (slug: string, name: string, price: number) => ({
  id: `p-${slug}`, slug, brand: 'Tubu', name, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${slug}`, fulfiller: TUBU,
});
const PAGE_ON = {
  enabled: true,
  tiers: TIERS,
  groups: [
    { category: { id: 'c-bep', name: 'Nhà bếp', slug: 'nha-bep' }, products: [card('rua-chen', 'Nước rửa chén', 65_000), card('khan-lau', 'Khăn lau', 35_000)] },
    { category: { id: 'c-tam', name: 'Phòng tắm', slug: 'phong-tam' }, products: [card('xa-phong', 'Xà phòng', 45_000), card('ban-chai', 'Bàn chải', 30_000)] },
  ],
};

async function session(api: MockApi, page: Page): Promise<void> {
  mockSession(api, makeUser({ id: 'u-w203', fullName: 'Nguyễn Văn An' }));
  api.get('/me/coupons', []);
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 0, pointsConvertedBalance: 0 });
  api.get('/products', { data: [], meta: { page: 1, limit: 10, total: 0 } });
  api.allowUnmocked('POST /events', 'GET /me/notifications', 'GET /auth/me', 'GET /me', 'GET /flash-sales/active', 'GET /me/wishlist/ids', 'GET /dealer/me', 'GET /me/new-customer-offer');
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
}

test.describe('w2-03 Hộp Xanh web', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!runsHere(testInfo.project.name), 'chỉ hai project web khách');
    await page.setViewportSize(viewportOf(testInfo.project.name));
  });

  test('giỏ đã đạt Miễn phí giao: dải Hộp Xanh thay dải đó, dòng Hộp Xanh trong tóm tắt, "Ghép thêm" mở /hop-xanh', async ({ page, api }) => {
    await session(api, page);
    api.get('/cart', greenCart(4, 60_000, { tier: TIERS[0]!, next: TIERS[1]!, discount: 7_200 }));
    api.get('/bundles/green-box', PAGE_ON);
    await page.goto('/gio-hang');
    const strip = page.getByTestId('green-box-progress');
    await expect(strip).toContainText('Hộp Xanh đang giảm 3%. Thêm 1 món nữa giảm 5%', { timeout: 20_000 });
    await expect(page.getByTestId('freeship-progress')).toHaveCount(0);
    await expect(page.getByTestId('green-box-marks')).toHaveText('Mốc 3 · 5 · 7 món');
    await expect(strip.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '57');
    // tubu-w47-01: ở điện thoại dòng Hộp Xanh nằm trong chi tiết tính tiền gập của chân dính; chạm khối tổng mới hiện.
    const total = page.getByTestId('cart-total-toggle');
    if (await total.isVisible()) await total.click();
    await expect(page.getByText(`-${vnd(7_200)}`).filter({ visible: true }).first()).toBeVisible();
    expect(await probeTapTargets(page, { scope: '[data-testid="green-box-progress"]' })).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await shoot(page, 'cart-green-box');
    await page.getByTestId('green-box-more-cta').click();
    await expect(page).toHaveURL(/\/hop-xanh$/);
    await expect(page.getByRole('heading', { name: 'Hộp Xanh tự chọn' })).toBeVisible();
  });

  test('giỏ chưa đạt Miễn phí giao: chỉ dải Miễn phí giao, một dòng nhỏ Hộp Xanh', async ({ page, api }) => {
    await session(api, page);
    api.get('/cart', greenCart(2, 60_000, { tier: null, next: TIERS[0]!, discount: 0 }));
    await page.goto('/gio-hang');
    await expect(page.getByTestId('freeship-progress')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('green-box-progress')).toHaveCount(0);
    await expect(page.getByTestId('green-box-hint').filter({ visible: true })).toHaveText('Thêm 1 món nữa giảm 3% Hộp Xanh');
    await shoot(page, 'cart-green-box-hint');
  });

  test('API không có trường Hộp Xanh (cờ tắt): giỏ như cũ, không dải, không dòng, không gợi ý', async ({ page, api }) => {
    await session(api, page);
    api.get('/cart', greenCart(4, 60_000, null));
    await page.goto('/gio-hang');
    await expect(page.getByTestId('freeship-progress')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('green-box-progress')).toHaveCount(0);
    await expect(page.getByTestId('green-box-hint')).toHaveCount(0);
    await expect(page.getByTestId('cart-green-box')).toHaveCount(0);
    await shoot(page, 'cart-before-flag-off');
  });

  test('/hop-xanh: nhóm theo danh mục, ＋ thêm vào giỏ thường, thanh đổi theo giỏ máy chủ, "Xem giỏ" về giỏ', async ({ page, api }) => {
    await session(api, page);
    let cart = greenCart(3, 60_000, { tier: TIERS[0]!, next: TIERS[1]!, discount: 5_400 });
    api.get('/cart', () => cart);
    api.get('/bundles/green-box', PAGE_ON);
    api.get('/products/:slug', {
      ...card('rua-chen', 'Nước rửa chén', 65_000),
      images: [],
      description: '',
      shortDesc: null,
      certifications: [],
      variations: [{ id: 'v-rua-chen', sku: 'v-rua-chen', name: '500ml', attributes: {}, retailPrice: 65_000, salePrice: null, stock: 8 }],
    });
    api.post('/cart/items', () => {
      cart = greenCart(4, 60_000, { tier: TIERS[0]!, next: TIERS[1]!, discount: 7_200 });
      return cart;
    });
    await page.goto('/hop-xanh');
    await expect(page.getByRole('heading', { name: 'Hộp Xanh tự chọn' })).toBeVisible({ timeout: 20_000 });
    // Thanh nhiều bậc thay câu liệt kê bậc (tubu-w22-01): mỗi bậc máy chủ trả một đoạn, số món còn thiếu và mức giảm bậc kế.
    const stepper = page.getByTestId('green-box-stepper');
    await expect(stepper.getByTestId('green-box-step')).toHaveText(['3 món-3%', '5 món-5%', '7 món-7%']);
    await expect(stepper.getByTestId('green-box-stepper-text')).toHaveText('Thêm 2 món nữa');
    await expect(stepper).toContainText('Giảm 5%');
    await expect(page.getByRole('heading', { name: 'Nhà bếp' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Phòng tắm' })).toBeVisible();
    const bar = page.getByTestId('green-box-bar-text').filter({ visible: true });
    await expect(bar).toHaveText('Đã chọn 3 món · giảm 3%');
    await expect(page.getByRole('link', { name: 'Xem giỏ', exact: true }).filter({ visible: true })).toHaveCount(1);
    const jump = page.getByRole('region', { name: 'Chọn nhanh danh mục' });
    await expect(jump.getByRole('button')).toHaveText(['Nhà bếp(2)', 'Phòng tắm(2)']);
    expect(await probeTapTargets(page, { scope: '[data-testid="green-box-jump"]' })).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await shoot(page, 'hop-xanh');
    // Chạm chip: tiêu đề mục nằm ngay dưới khối dính, không bị che.
    await jump.getByRole('button', { name: /^Phòng tắm/ }).click();
    const heading = page.getByRole('heading', { name: 'Phòng tắm' });
    await expect.poll(async () => {
      const [h, j] = await Promise.all([heading.boundingBox(), jump.boundingBox()]);
      return h && j ? Math.round(h.y - (j.y + j.height)) : -999;
    }).toBeGreaterThanOrEqual(0);
    await expect(heading).toBeInViewport();
    await page.getByRole('button', { name: /^Thêm Nước rửa chén vào giỏ/ }).click();
    await expect(bar).toHaveText('Đã chọn 4 món · giảm 3%');
    await expect(stepper.getByTestId('green-box-stepper-text')).toHaveText('Thêm 1 món nữa');
    await page.getByRole('link', { name: 'Xem giỏ', exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/gio-hang$/);
  });

  test('/hop-xanh khi cờ tắt: báo chưa mở, có lối sang danh mục', async ({ page, api }) => {
    await session(api, page);
    api.get('/cart', greenCart(1, 60_000, null));
    api.get('/bundles/green-box', { enabled: false, tiers: [], groups: [] });
    await page.goto('/hop-xanh');
    await expect(page.getByText('Hộp Xanh chưa mở. Bạn quay lại sau nhé.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('green-box-bar-text')).toHaveCount(0);
  });

  test('thanh toán: dòng Hộp Xanh tách khỏi combo, tổng là số máy chủ', async ({ page, api }) => {
    mockCheckout(api);
    mockWebCheckoutExtras(api);
    api.get('/me', { id: 'user-checkout', fullName: 'Nguyễn Văn A', email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], walletBalance: 200000 });
    const quote = { ...CHECKOUT_QUOTE, comboDiscount: 3_900, greenBoxDiscount: 3_900, total: CHECKOUT_QUOTE.total - 3_900 };
    api.post('/checkout/quote', quote);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: trang vẫn mở
      }
    });
    await page.goto('/thanh-toan');
    await expect(page.locator('[data-ds="checkout-summary-total"]').first()).toContainText(vnd(quote.total), { timeout: 20_000 });
    await expect(page.getByText('Hộp Xanh', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/combo/i).filter({ visible: true })).toHaveCount(0);
    await shoot(page, 'checkout-green-box');
  });

  test('tab Định kỳ chưa có gói: dòng gợi ý theo nhịp mua, chạm mở sheet đã chọn sẵn 6 tuần', async ({ page, api }) => {
    await session(api, page);
    api.get('/cart', greenCart(1, 60_000, null));
    api.get('/me/subscriptions', []);
    api.get('/me/subscriptions/suggestions', {
      enabled: true,
      items: [
        {
          variationId: 'v-rua-chen', productName: 'Nước rửa chén', variationName: '500ml', slug: 'rua-chen', thumbnail: null, unitPrice: 65_000, intervalWeeks: 6,
          lastDeliveredAt: '2026-11-01T03:00:00Z',
        },
      ],
    });
    api.get('/me/addresses', []);
    api.get('/me/wallet', { walletBalance: 0 });
    api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
    api.allowUnmocked('GET /me/purchased-items', 'GET /orders/me/refunds', 'GET /waste/me', 'GET /affiliate/me');
    await page.goto('/tai-khoan/don-hang?tab=subscriptions');
    const row = page.getByTestId('subscription-suggestion');
    await expect(row).toHaveText(/Bạn thường mua Nước rửa chén khoảng 6 tuần một lần\. Đặt giao định kỳ, giảm 12%/, { timeout: 20_000 });
    const box = (await row.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await shoot(page, 'subscription-suggestion');
    await row.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('group', { name: 'Chu kỳ giao' }).getByRole('button', { name: '6 tuần' })).toHaveAttribute('aria-pressed', 'true');
  });
});
