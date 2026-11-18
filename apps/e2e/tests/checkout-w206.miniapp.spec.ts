import { mkdirSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { BANK_QR, CHECKOUT_ADDRESS, CHECKOUT_QUOTE, ORDER_CODE_BANK, mockCheckout } from './support/checkout-mocks';
import { probeTapTargets } from './support/touch-probe';

/**
 * Wave tubu-w2-06, Mini App ở 360×780 và 393×852: địa chỉ một dòng, "Đổi" mở tấm chọn, đổi sang địa chỉ đã lưu khác trong 2 chạm và tổng tiền không nhảy về "…";
 * chọn Chuyển khoản (cờ bật) thấy thẻ xem trước và không có QR trước khi có mã đơn; đặt đơn chuyển khoản thấy QR; vùng chạm ≥ 44px; 360px không tràn ngang.
 * Đặt W206_SHOT_DIR để chụp ảnh.
 */
const OTHER_ADDRESS = { ...CHECKOUT_ADDRESS, id: 'addr-office-2', recipient: 'Trần Thị B', phone: '0987654321', street: '45 Nguyễn Huệ, toà nhà văn phòng tầng 12', isDefault: false };
const QUOTE_OTHER = { ...CHECKOUT_QUOTE, shippingFee: 25000, total: CHECKOUT_QUOTE.subtotal + 25000 };
// Ảnh QR là PNG 1×1 hợp lệ: ảnh GIF cụt của BANK_QR báo lỗi tải nên trang hiện "Chưa tải được mã QR", không đo được lúc QR hiện.
const BANK_QR_PNG = { ...BANK_QR, qrImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' };
const PREVIEW_ON = { enabled: true, bank: { name: BANK_QR.bank.name, accountName: BANK_QR.bank.accountName } };
const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.W206_SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `mini-${page.viewportSize()?.width}-${name}.png`) });
}

function mockTwoAddresses(api: MockApi, { previewOn = false } = {}): void {
  mockCheckout(api);
  api.get('/me/addresses', [CHECKOUT_ADDRESS, OTHER_ADDRESS]);
  api.post('/checkout/quote', ({ call }) =>
    (call.body as { addressId?: string } | undefined)?.addressId === OTHER_ADDRESS.id ? later(QUOTE_OTHER, 1500) : CHECKOUT_QUOTE,
  );
  api.get('/payments/bank-qr/:code', BANK_QR_PNG);
  if (previewOn) api.get('/payments/bank-preview', PREVIEW_ON);
}

const totalRow = (page: Page) => page.locator('[data-ds="checkout-summary-total"]');
const placeButton = (page: Page) => page.getByRole('button', { name: /Đặt hàng/ }).last();

for (const vp of [{ width: 360, height: 780 }, { width: 393, height: 852 }]) {
  test.describe(`w2-06 thanh toán Mini ${vp.width}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(vp);
    });

    test('đổi địa chỉ đã lưu trong 2 chạm, tổng không nhảy về "…", nút khoá tới khi báo giá mới về', async ({ page, api }) => {
      mockTwoAddresses(api);
      await page.goto('/checkout');
      const row = page.getByTestId('checkout-address-row');
      await expect(row).toContainText('Nguyễn Văn A · 090****567');
      await expect(totalRow(page)).toContainText(vnd(CHECKOUT_QUOTE.total));
      await shoot(page, 'address-row');
      await row.getByRole('button', { name: /Đổi địa chỉ giao hàng/ }).click();
      const sheet = page.getByRole('dialog').filter({ hasText: 'Chọn địa chỉ giao hàng' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('radio')).toHaveCount(2);
      await shoot(page, 'address-sheet');
      await sheet.getByRole('radio', { name: /Trần Thị B/ }).click();
      await expect(row).toContainText('Trần Thị B · 098****321');
      await expect(totalRow(page)).toContainText(vnd(CHECKOUT_QUOTE.total));
      await expect(placeButton(page)).toBeDisabled();
      await expect(totalRow(page)).toContainText(vnd(QUOTE_OTHER.total), { timeout: 5_000 });
      await expect(placeButton(page)).toBeEnabled();
    });

    test('vùng chạm ≥ 44px ở dòng địa chỉ và tấm chọn; không tràn ngang', async ({ page, api }) => {
      mockTwoAddresses(api);
      await page.goto('/checkout');
      const row = page.getByTestId('checkout-address-row');
      await expect(row).toBeVisible();
      expect(await probeTapTargets(page, { scope: '[data-testid="checkout-address-row"]' })).toEqual([]);
      await row.getByRole('button', { name: /Đổi địa chỉ giao hàng/ }).click();
      const sheet = page.getByRole('dialog').filter({ hasText: 'Chọn địa chỉ giao hàng' });
      await expect(sheet).toBeVisible();
      expect(await probeTapTargets(page, { scope: '[role="radiogroup"][aria-label="Chọn địa chỉ giao hàng"]' })).toEqual([]);
      const overflow = await page.evaluate(() =>
        Math.max(...[document.documentElement, ...document.querySelectorAll<HTMLElement>('.zaui-page')].map((el) => el.scrollWidth - el.clientWidth)),
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('cờ bật: thẻ xem trước chuyển khoản, không QR trước khi đặt; đặt xong thấy QR', async ({ page, api }) => {
      mockTwoAddresses(api, { previewOn: true });
      await page.goto('/checkout');
      await expect(totalRow(page)).toContainText(vnd(CHECKOUT_QUOTE.total));
      await page.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }).click();
      const card = page.getByTestId('transfer-preview');
      await expect(card).toBeVisible();
      await expect(card).toContainText(BANK_QR.bank.name);
      await expect(card).toContainText(BANK_QR.bank.accountName);
      await expect(card).toContainText(vnd(CHECKOUT_QUOTE.total));
      await expect(card).not.toContainText(BANK_QR.bank.accountNo);
      await expect(page.locator('img[alt="VietQR"], canvas')).toHaveCount(0);
      await card.scrollIntoViewIfNeeded();
      await shoot(page, 'transfer-preview');
      const placed = page.waitForResponse((r) => r.url().includes('/checkout/place-order'));
      await placeButton(page).click();
      await placed;
      const t0 = Date.now();
      const qr = page.locator('img[alt="VietQR"]');
      await expect(qr).toBeVisible();
      await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      const msToQr = Date.now() - t0;
      console.log(`W206_QR_MS mini ${vp.width} ${msToQr}`);
      test.info().annotations.push({ type: 'W206_QR_MS', description: String(msToQr) });
      expect(msToQr).toBeLessThanOrEqual(1_000);
      expect(page.url()).toContain(ORDER_CODE_BANK);
      expect(api.callsTo('GET', '/payments/bank-qr/:code').length).toBe(1);
      await shoot(page, 'transfer-qr');
    });

    test('cờ tắt: chọn Chuyển khoản không có thẻ xem trước', async ({ page, api }) => {
      mockTwoAddresses(api);
      await page.goto('/checkout');
      await expect(totalRow(page)).toContainText(vnd(CHECKOUT_QUOTE.total));
      await page.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }).click();
      await expect(page.getByRole('radio', { name: /Chuyển khoản ngân hàng/ })).toHaveAttribute('aria-checked', 'true');
      await page.waitForTimeout(300);
      await expect(page.getByTestId('transfer-preview')).toHaveCount(0);
      await shoot(page, 'transfer-flag-off');
    });
  });
}
