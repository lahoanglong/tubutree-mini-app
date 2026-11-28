import type { Page } from '@playwright/test';
import { expect, publicConfig, test } from './support/mock-api';
import { STATES, mockWorld } from './support/order-detail-states';

/**
 * Wave tubu-w17-01, web khách ở hai project (390 và 1280):
 * - Chi tiết đơn đang giao: viên "Tra cứu hành trình · {hãng}" ngay dưới thẻ trạng thái là lối tra cứu duy nhất của trang (mở tab mới, cao ≥ 44px);
 * - Chi tiết đơn đã giao, cờ `catalog.refill_first_enabled` bật: thẻ gói Refill thay cho chai có trong đơn, "+ Thêm" một chạm thêm đúng gói;
 * - `/tiet-kiem-refill`: dựng được, canonical đúng, không tràn ngang (nội dung danh sách do spec đơn vị kiểm: bản ISR dựng theo API lúc build).
 * Đặt `REFILL_SHOTS_DIR` để chụp ảnh.
 */
const SHOTS = process.env.REFILL_SHOTS_DIR;
const runsHere = (project: string) => project === 'Web Customer' || project === 'Web Customer Mobile';

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-${page.viewportSize()?.width}-${name}.png`, fullPage: true });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const stateOf = (key: string) => STATES.find((s) => s.key === key)!;

const LANDING = {
  enabled: true,
  pairs: [
    {
      bottle: { productId: 'p-san-pham-1', slug: 'san-pham-1', name: 'Nước Rửa Chén Sinh Học Tubu 500ml', thumbnail: null, price: 65_000, compareAt: null, sizeLabel: '500ml', inStock: true },
      refill: {
        productId: 'p-refill-rua-chen', slug: 'refill-rua-chen-5l', name: 'Refill Nước Rửa Chén Sinh Học Tubu 5L', thumbnail: null, variationId: 'v-refill-rua-chen',
        price: 480_000, compareAt: null, sizeLabel: '5L', inStock: true, tubu: true,
      },
      savingPct: 26,
    },
  ],
};

test.describe('w17-01 vòng sau mua trên web', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!runsHere(testInfo.project.name), 'chỉ hai project web khách');
  });

  test('Chi tiết đơn đang giao: thẻ Vận chuyển gồm viên chép mã và một lối tra cứu hành trình mở tab mới (W47)', async ({ page, api }) => {
    const w = await mockWorld(api, page, 'web', stateOf('shipping'), Date.now());
    await page.goto(`/tai-khoan/don-hang/${w.order.code}`);
    const card = page.getByTestId('order-shipping');
    const pill = card.getByTestId('order-tracking-pill');
    await expect(pill).toBeVisible({ timeout: 20_000 });
    await expect(pill).toContainText('GHN6789012345');
    await expect(pill).toContainText('Giao Hàng Nhanh');
    const link = card.getByTestId('order-tracking-link');
    await expect(link).toContainText('Tra cứu hành trình');
    await expect(link).toHaveAttribute('href', 'https://tracking.ghn.vn/?code=GHN6789012345');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(page.locator('a[href^="https://tracking.ghn.vn"]').filter({ visible: true })).toHaveCount(1);
    expect((await pill.getByRole('button').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, 'order-tracking-pill');
  });

  test('Chi tiết đơn đã giao, cờ Refill bật: thẻ gói thay cho chai trong đơn, "+ Thêm" thêm đúng gói', async ({ page, api }) => {
    const w = await mockWorld(api, page, 'web', stateOf('delivered'), Date.now());
    api.get('/config/public', { ...publicConfig({ shippingEta: { minDays: 1, maxDays: 3 }, returnWindowDays: 7 }), refillFirstEnabled: true });
    api.get('/catalog/refill-pairs/landing', LANDING);
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199_000, itemCount: 0 });
    api.post('/cart/items', { items: [], couponCode: null, subtotal: 480_000, discount: 0, freeship: true, freeshipThreshold: 199_000, itemCount: 1 });
    await page.goto(`/tai-khoan/don-hang/${w.order.code}`);
    const card = page.getByTestId('order-refill');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole('heading', { name: 'Lần sau rót lại bằng Refill' })).toBeVisible();
    await expect(card).toContainText('Chọn túi Refill 5L tiết kiệm 170.000đ (~26%)');
    await expect(card.getByRole('button', { name: /Refill Nước Rửa Chén Sinh Học Tubu 5L/ })).toHaveCount(1);
    // Thẻ Refill là phần phụ sau mua: nằm DƯỚI thẻ Vận chuyển (W47).
    expect((await card.boundingBox())!.y).toBeGreaterThan((await page.getByTestId('order-shipping').boundingBox())!.y);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, 'order-refill');
    const add = card.getByTestId('pdp-refill-add');
    expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await add.click();
    await expect.poll(() => api.callsTo('POST', '/cart/items').length).toBe(1);
    expect(api.callsTo('POST', '/cart/items')[0]!.body).toMatchObject({ variationId: 'v-refill-rua-chen', quantity: 1 });
  });

  test('Chi tiết đơn đã giao, cờ Refill tắt: không thẻ, không hỏi trang Refill', async ({ page, api }) => {
    const w = await mockWorld(api, page, 'web', stateOf('delivered'), Date.now());
    await page.goto(`/tai-khoan/don-hang/${w.order.code}`);
    await expect(page.getByText(/Giao thành công/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('order-refill')).toHaveCount(0);
    expect(api.callsTo('GET', '/catalog/refill-pairs/landing')).toHaveLength(0);
  });

  test('/tiet-kiem-refill dựng được: tiêu đề, canonical, không tràn ngang', async ({ page, api }) => {
    api.get('/config/public', { ...publicConfig({}), refillFirstEnabled: true });
    api.get('/catalog/refill-pairs/landing', LANDING);
    await page.goto('/tiet-kiem-refill');
    await expect(page.getByRole('heading', { level: 1, name: 'Tiết kiệm với Refill' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/tiet-kiem-refill$/);
    await expect(page).toHaveTitle(/Tiết kiệm với Refill/);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, 'tiet-kiem-refill');
  });
});
