import type { Page } from '@playwright/test';
import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { mockPilotCart, PILOT_CART } from './support/pilot-mocks';

/**
 * Mini App, wave tubu-w17-01: trang "Tiết kiệm với Refill" (`/refill-deals`, cùng dữ liệu với web `/tiet-kiem-refill`) và lối vào ở hub Danh mục.
 * API mock toàn bộ. Đặt `REFILL_SHOTS_DIR` thì chụp ảnh từng trạng thái.
 */
const SHOTS = process.env.REFILL_SHOTS_DIR;
const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-${name}.png` });
}
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => Math.max(...[document.documentElement, ...document.querySelectorAll<HTMLElement>('.zaui-page')].map((el) => el.scrollWidth - el.clientWidth)) <= 0);

const bottle = (slug: string, name: string, price: number) => ({ productId: `p-${slug}`, slug, name, thumbnail: null, price, compareAt: null, sizeLabel: '500ml', inStock: true });
const refill = (slug: string, name: string, price: number, inStock = true) => ({
  productId: `p-${slug}`, slug, name, thumbnail: null, variationId: `v-${slug}`, price, compareAt: null, sizeLabel: '5L', inStock, tubu: true,
});
const LANDING = {
  enabled: true,
  pairs: [
    { bottle: bottle('rua-chen-500', 'Nước rửa chén Fuwa3e 500ml', 60_000), refill: refill('refill-rua-chen-5l', 'Refill Nước rửa chén Fuwa3e 5L', 450_000), savingPct: 25 },
    { bottle: bottle('giat-1l', 'Nước giặt Fuwa3e 1L', 120_000), refill: refill('refill-giat-5l', 'Refill Nước giặt Fuwa3e 5L', 480_000), savingPct: 20 },
    { bottle: bottle('tam-500', 'Sữa tắm Fuwa3e 500ml', 90_000), refill: refill('refill-tam-5l', 'Refill Sữa tắm Fuwa3e 5L', 700_000, false), savingPct: 22 },
  ],
};

function mockLandingApi(api: MockApi, flag: boolean): void {
  api.get('/config/public', { ...publicConfig({ freeshipThreshold: 199_000 }), refillFirstEnabled: flag });
  api.get('/catalog/refill-pairs/landing', flag ? LANDING : { enabled: false, pairs: [] });
}

test.describe('Mini /refill-deals: Tiết kiệm với Refill', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.width}x${vp.height}: chỉ gói còn hàng, chú thích chai, FAQ, "+ Thêm" một chạm thêm đúng gói, không tràn ngang`, async ({ page, api }) => {
      mockPilotCart(api);
      mockLandingApi(api, true);
      api.post('/cart/items', () => ({ ...PILOT_CART, itemCount: PILOT_CART.itemCount + 1 }));
      await page.setViewportSize(vp);
      await page.goto('/refill-deals');
      await expect(page.getByRole('heading', { name: 'Tiết kiệm với Refill', level: 1 })).toBeVisible({ timeout: 20_000 });
      const rows = page.getByTestId('refill-landing-row');
      await expect(rows).toHaveCount(2, { timeout: 20_000 });
      await expect(page.getByTestId('refill-landing-bottle').first()).toHaveText('Thay cho Nước rửa chén Fuwa3e 500ml');
      await expect(rows.first()).toContainText('tiết kiệm 150.000đ (~25%)');
      await expect(page.getByRole('button', { name: /Refill Nước giặt Fuwa3e 5L/ })).toHaveCount(1);
      await expect(page.getByRole('button', { name: /Refill Sữa tắm Fuwa3e 5L/ })).toHaveCount(0);
      await expect(page.getByTestId('refill-landing-faq').getByRole('button', { name: 'Refill là gì?' })).toHaveAttribute('aria-expanded', 'false');
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, `refill-deals-${vp.width}`);

      const add = rows.first().getByTestId('pdp-refill-add');
      expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await add.click();
      await expect.poll(() => api.callsTo('POST', '/cart/items').length).toBe(1);
      expect(api.callsTo('POST', '/cart/items')[0]!.body).toMatchObject({ variationId: 'v-refill-rua-chen-5l', quantity: 1 });
    });
  }

  test('cờ tắt: trang báo chưa có gói, không FAQ, không hàng', async ({ page, api }) => {
    mockPilotCart(api);
    mockLandingApi(api, false);
    await page.setViewportSize(VIEWPORTS[1]);
    await page.goto('/refill-deals');
    await expect(page.getByText('Chưa có gói Refill nào đang mở bán')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('refill-landing-row')).toHaveCount(0);
    await expect(page.getByTestId('refill-landing-faq')).toHaveCount(0);
    await shot(page, 'refill-deals-off');
  });

  test('hub Danh mục: lối vào chỉ hiện khi cờ bật và có gói, chạm mở trang', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockLandingApi(api, true);
    await page.setViewportSize(VIEWPORTS[1]);
    await page.goto('/browse');
    const entry = page.getByTestId('refill-landing-entry');
    await expect(entry).toBeVisible({ timeout: 30_000 });
    await entry.getByText('Tiết kiệm với Refill').click();
    await expect(page).toHaveURL(/\/refill-deals$/);
    await expect(page.getByTestId('refill-landing-row')).toHaveCount(2, { timeout: 20_000 });
  });

  test('hub Danh mục khi cờ tắt: không lối vào, không hỏi trang Refill', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockLandingApi(api, false);
    await page.setViewportSize(VIEWPORTS[1]);
    await page.goto('/browse');
    await expect(page.getByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('refill-landing-entry')).toHaveCount(0);
    expect(api.callsTo('GET', '/catalog/refill-pairs/landing')).toHaveLength(0);
  });
});
