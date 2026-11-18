import { mkdirSync } from 'fs';
import type { Page } from '@playwright/test';
import { checkoutEtaLabel } from '../../../packages/app-core/src/shipping-eta';
import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_SLUG } from './support/pilot-mocks';

/**
 * Trang sản phẩm Mini App (tubu-w4-02): giá theo đơn vị (cờ catalog.unit_price_enabled), "Nhận dự kiến …" và câu còn thiếu để miễn phí giao
 * (cờ shipping.pdp_eta_enabled) ở 360×640 và 390×844. Cờ tắt thì trang như cũ; khối Vận chuyển cao thêm ≤ 24px; CLS không tăng so với cờ tắt.
 * PDP_DECISION_SHOTS=<thư mục> thì chụp trước/sau.
 */
const SHOTS = process.env.PDP_DECISION_SHOTS;
const ETA = { minDays: 2, maxDays: 4 };
const TUBU = { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null };
const variation = (id: string, name: string, price: number, stock: number) => ({ id, sku: id, name, attributes: {}, retailPrice: price, salePrice: null, stock });
const SIZES = [variation('v-500', '500ml', 79_000, 30), variation('v-3l5', '3,5L', 375_000, 12), variation('v-10l', 'Refill 10L', 990_000, 5)];
const cartLine = (variationId: string, total: number) => ({
  id: `l-${variationId}`, variationId, productName: 'Món khác', variationName: '1 hộp', slug: 'mon-khac', thumbnail: null, unitPrice: total, quantity: 1, stock: 9, total,
  fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' },
});
const cart = (items: ReturnType<typeof cartLine>[]) => ({
  items, couponCode: null, subtotal: items.reduce((s, l) => s + l.total, 0), discount: 0, freeship: false, freeshipThreshold: 199_000, itemCount: items.length, unavailableItems: [],
});

function mock(api: MockApi, o: { flags: boolean; product?: Record<string, unknown> }): void {
  mockPilotProduct(api);
  api.get('/products/:slug', { ...PILOT_PRODUCT, name: 'Nước giặt sinh học Fuwa3e', variations: SIZES, fulfiller: TUBU, ...o.product });
  api.get('/cart', cart([cartLine('khac', 60_000)]));
  api.get('/config/public', publicConfig({ freeshipThreshold: 199_000, shippingEta: ETA, ...(o.flags ? { unitPriceEnabled: true, pdpEtaEnabled: true } : {}) }));
  api.get('/products/:slug/reviews/can-review', { canReview: false, reason: 'NOT_PURCHASED', rewardAvailable: false, purchaseCount: 0, reviewableOrders: [], myReviews: [] });
}

async function openPdp(page: Page): Promise<void> {
  await page.goto(`/product/${PILOT_SLUG}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-pdp-block="shipping"]')).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shipHeight = async (page: Page) => (await page.locator('[data-pdp-block="shipping"]').boundingBox())!.height;

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}-top.png` });
  await page.locator('[data-pdp-block="shipping"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/${name}-ship.png` });
}

for (const vp of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
]) {
  test.describe(`Mini App ${vp.width}×${vp.height}: trang sản phẩm giúp chốt nhanh`, () => {
    test.use({ viewport: vp });

    test('cờ tắt rồi bật: các dòng mới chỉ có khi bật, khối Vận chuyển cao thêm ≤ 24px, CLS không tăng, không tràn ngang', async ({ page, api }) => {
      mock(api, { flags: false });
      await observeCls(page);
      await openPdp(page);
      await expect(page.getByText('Miễn phí giao hàng cho đơn từ 199.000đ')).toBeVisible();
      await expect(page.getByTestId('pdp-unit-price')).toHaveCount(0);
      await expect(page.getByTestId('variation-unit-price')).toHaveCount(0);
      await expect(page.getByTestId('pdp-eta')).toHaveCount(0);
      await expect(page.getByTestId('pdp-freeship-gap')).toHaveCount(0);
      const offHeight = await shipHeight(page);
      const off = await readClsTotal(page);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shoot(page, `mini-${vp.width}-before`);

      mock(api, { flags: true });
      await page.reload();
      await openPdp(page);
      await expect(page.getByTestId('pdp-unit-price')).toHaveText('≈ 15.800đ / 100ml');
      const chips = page.getByRole('group', { name: 'Phân loại nhanh' }).getByTestId('variation-unit-price');
      await expect(chips).toHaveText(['≈ 15.800đ / 100ml', '≈ 10.700đ / 100ml', '≈ 9.900đ / 100ml · Lợi hơn 37% mỗi 100ml']);
      await expect(page.getByText(/Lợi hơn/)).toHaveCount(1);
      await expect(page.getByTestId('pdp-eta')).toHaveText(`Nhận dự kiến ${checkoutEtaLabel(ETA, ['TUBU'])}`);
      await expect(page.getByTestId('pdp-freeship-gap')).toHaveText('Món này + 60.000đ là miễn phí giao');
      await expect(page.getByText('Miễn phí giao hàng cho đơn từ 199.000đ')).toHaveCount(0);
      const onHeight = await shipHeight(page);
      const on = await readClsTotal(page);
      await shoot(page, `mini-${vp.width}-after`);
      expect(onHeight - offHeight, `khối Vận chuyển ${offHeight} → ${onHeight}`).toBeLessThanOrEqual(24);
      expect(on.cls, `CLS bật ${on.cls} so với tắt ${off.cls}: ${on.sources.join(' ; ')}`).toBeLessThanOrEqual(Math.max(off.cls, 0) + 0.001);
      expect(await noHorizontalScroll(page)).toBe(true);
      test.info().annotations.push({ type: 'đo', description: `ship ${offHeight}→${onHeight}px, CLS ${off.cls.toFixed(4)}→${on.cls.toFixed(4)}` });
    });

    test('bảng chọn phân loại: mỗi chip còn hàng có giá theo đơn vị, đổi chip thì nhãn tính lại', async ({ page, api }) => {
      mock(api, { flags: true });
      await openPdp(page);
      await page.getByRole('button', { name: 'Thêm vào giỏ' }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      const lines = sheet.getByRole('group', { name: 'Phân loại' }).getByTestId('variation-unit-price');
      await expect(lines).toHaveText(['≈ 15.800đ / 100ml', '≈ 10.700đ / 100ml', '≈ 9.900đ / 100ml · Lợi hơn 37% mỗi 100ml']);
      await sheet.getByRole('button', { name: /Refill 10L/ }).click();
      await expect(lines).toHaveText(['≈ 15.800đ / 100ml', '≈ 10.700đ / 100ml', '≈ 9.900đ / 100ml']);
      expect(await noHorizontalScroll(page)).toBe(true);
      if (SHOTS && vp.width === 390) await page.screenshot({ path: `${SHOTS}/mini-390-after-sheet.png` });
    });

    test('một phân loại: có dòng dưới giá, không có chip', async ({ page, api }) => {
      mock(api, { flags: true, product: { variations: [variation('v-500', '500ml', 79_000, 30)] } });
      await openPdp(page);
      await expect(page.getByTestId('pdp-unit-price')).toHaveText('≈ 15.800đ / 100ml');
      await expect(page.getByRole('group', { name: 'Phân loại nhanh' })).toHaveCount(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-${vp.width}-after-single.png` });
    });

    test('hàng gian hàng tự giao: không hứa ngày, câu còn thiếu theo ngưỡng của gian hàng', async ({ page, api }) => {
      mock(api, { flags: true, product: { fulfiller: { kind: 'MERCHANT', name: 'Shop A', shippingFee: 20_000, freeShipFrom: 300_000 } } });
      await openPdp(page);
      await expect(page.getByTestId('pdp-freeship-gap')).toHaveText('Món này + 221.000đ là miễn phí giao');
      await expect(page.getByTestId('pdp-eta')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      if (SHOTS) {
        await page.locator('[data-pdp-block="shipping"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/mini-${vp.width}-after-merchant.png` });
      }
    });

    test('hết hàng: không hứa ngày, giữ câu miễn phí giao tĩnh, chip hết hàng không có dòng giá theo đơn vị', async ({ page, api }) => {
      mock(api, { flags: true, product: { variations: SIZES.map((v) => ({ ...v, stock: 0 })) } });
      await openPdp(page);
      await expect(page.getByText('Miễn phí giao hàng cho đơn từ 199.000đ')).toBeVisible();
      await expect(page.getByTestId('pdp-eta')).toHaveCount(0);
      await expect(page.getByTestId('pdp-freeship-gap')).toHaveCount(0);
      await expect(page.getByTestId('variation-unit-price')).toHaveCount(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/mini-${vp.width}-after-oos.png` });
    });
  });
}
