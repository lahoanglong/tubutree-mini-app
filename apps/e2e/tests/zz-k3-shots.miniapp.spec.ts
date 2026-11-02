import type { Page } from '@playwright/test';
import path from 'node:path';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockFooterCart } from './support/cart-footer-mocks';
import { mockPilotProduct, PILOT_SLUG } from './support/pilot-mocks';

test.use({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const OUT = process.env.K3_SHOTS!;
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();
const WALLET = [
  { code: 'XANH10', type: 'PERCENT', value: 10, minOrder: 900_000, maxDiscount: 50_000, endAt: inDays(30) },
  { code: 'SHIPDEP', type: 'FREESHIP', value: 0, minOrder: null, maxDiscount: null, endAt: inDays(2) },
  { code: 'GIAM30K', type: 'AMOUNT', value: 30_000, minOrder: null, maxDiscount: null, endAt: inDays(12) },
  { code: 'WELCOME-2026-11-CMV9MLSLB009KFKRUMVZQLRA7', type: 'PERCENT', value: 15, minOrder: 150_000, maxDiscount: 40_000, endAt: inDays(400) },
];
const PREVIEWS = [
  { code: 'XANH10', eligible: false, discount: 0, reason: 'Đơn tối thiểu 900.000đ để dùng mã này.' },
  { code: 'SHIPDEP', eligible: false, discount: 0, reason: 'Đơn này đã được miễn phí giao hàng.' },
  { code: 'GIAM30K', eligible: true, discount: 30_000 },
  { code: 'WELCOME-2026-11-CMV9MLSLB009KFKRUMVZQLRA7', eligible: true, discount: 19_500 },
];
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

test('mini: giỏ, tấm chọn mã (khách mới, ví trống)', async ({ page, api }) => {
  mockSession(api, makeUser({ id: 'k3-new', fullName: 'Khách Mới' }));
  mockFooterCart(api, { lines: 2 });
  api.get('/me/coupons', []);
  await page.goto('/cart');
  await page.getByText('Chọn mã', { exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Chọn mã giảm giá' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Bạn chưa có mã giảm giá trong ví')).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, 'mini375__checkout-voucher-new__sheet1');
});

test('mini: giỏ, tấm chọn mã (khách cũ, 4 mã)', async ({ page, api }) => {
  mockSession(api, makeUser({ id: 'k3-ret', fullName: 'Khách Cũ' }));
  mockFooterCart(api, { lines: 2 });
  api.get('/me/coupons', WALLET);
  api.post('/checkout/coupon-previews', { coupons: PREVIEWS });
  await page.goto('/cart');
  await page.getByText('Chọn mã', { exact: true }).click();
  await expect(page.getByRole('dialog').getByTestId('voucher-reason').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await shot(page, 'mini375__checkout-voucher__sheet1');
  await page.getByRole('dialog').getByRole('list', { name: 'Mã giảm giá của bạn' }).evaluate((ul) => ul.scrollIntoView({ block: 'end' }));
  await page.waitForTimeout(300);
  await shot(page, 'mini375__checkout-voucher__sheet2');
});

test('mini: trang sản phẩm, sheet Ưu đãi (xếp theo lợi, Mua thêm … để dùng)', async ({ page, api }) => {
  mockSession(api, makeUser({ id: 'k3-pdp', fullName: 'Khách Cũ' }));
  mockPilotProduct(api);
  api.get('/me/coupons', WALLET);
  await page.goto(`/product/${PILOT_SLUG}`);
  await page.getByRole('button', { name: /Ưu đãi/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Mã giảm giá' });
  await expect(dlg).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await shot(page, 'mini375__offers-sheet__sheet1');
  await dlg.getByRole('button', { name: 'Sao chép' }).first().click();
  await page.waitForTimeout(400);
  await shot(page, 'mini375__offers-sheet__copied');
});
