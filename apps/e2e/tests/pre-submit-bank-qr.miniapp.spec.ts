import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockCheckout } from './support/checkout-mocks';
import { BANK_FIXTURE, bankQrFor } from './support/bank-fixture';
import { captureVietQrImage, expectEmvQr, expectQrImage, LEGACY_CODE, miniPath, SHORT_BANK, vnd } from './support/pre-submit';

/**
 * Trước khi gửi duyệt Zalo (tubu-w36-02), màn QR chuyển khoản Mini App `/bank-payment/<mã>` ở 375px: tên ngân hàng, BIN trong ảnh QR, số tài khoản
 * và chủ tài khoản đọc từ `support/bank-fixture.ts`, số tiền, nội dung = mã đơn (mã ngắn và mã dài cũ), nút chép. Chạy cả Vite dev lẫn bản build `www`.
 */
test.use({ viewport: { width: 375, height: 812 } });

const AMOUNT = 149_000;

async function stubClipboard(page: Page): Promise<void> {
  // Project Mini chạy WebKit (iPhone 12): không cấp được quyền clipboard, giả writeText.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => { (window as unknown as { __copied?: string }).__copied = t; return Promise.resolve(); } },
    });
  });
}
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied?: string }).__copied);

test.describe('Trước gửi duyệt: màn QR chuyển khoản Mini App', () => {
  for (const code of [SHORT_BANK, LEGACY_CODE]) {
    test(`đơn ${code}: ngân hàng, số tài khoản, chủ tài khoản, số tiền, nội dung = mã đơn, ảnh QR đúng khuôn, chuỗi EMV đúng CRC, nút chép`, async ({ page, api }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await stubClipboard(page);
      mockCheckout(api);
      api.get('/payments/bank-qr/:code', ({ params }) => bankQrFor(params.code!, AMOUNT));
      api.allowUnmocked('GET /flash-sales/upcoming', 'POST /events');
      const images = await captureVietQrImage(page);
      const qrResponse = page.waitForResponse((r) => r.url().includes(`/payments/bank-qr/${code}`));
      await page.goto(miniPath(`/bank-payment/${code}`));
      const qr = (await (await qrResponse).json()) as { qrString: string };
      expectEmvQr(qr.qrString, code, AMOUNT, BANK_FIXTURE);

      await expect(page.getByText('Quét QR để chuyển khoản')).toBeVisible({ timeout: 20_000 });
      for (const text of [BANK_FIXTURE.name, BANK_FIXTURE.accountNo, BANK_FIXTURE.accountName, vnd(AMOUNT)]) {
        await expect(page.getByText(text).first()).toBeVisible();
      }
      await expect(page.getByTestId('memo-note')).toContainText(code);
      const img = page.locator('img[alt="VietQR"]');
      await expect(img).toBeVisible();
      expectQrImage(await img.getAttribute('src'), code, AMOUNT);
      await expect.poll(() => images.length).toBeGreaterThan(0);

      await page.getByRole('button', { name: 'Sao chép số tài khoản' }).click();
      await expect.poll(() => copied(page)).toBe(BANK_FIXTURE.accountNo);
      await page.getByRole('button', { name: 'Sao chép số tiền' }).click();
      await expect.poll(() => copied(page)).toBe(String(AMOUNT));
      await page.getByRole('button', { name: 'Sao chép nội dung chuyển khoản' }).click();
      await expect.poll(() => copied(page)).toBe(code);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      expect(errors).toEqual([]);
    });
  }

  test('chuyển thiếu: số tiền và ảnh QR theo phần còn thiếu, có dòng đã nhận', async ({ page, api }) => {
    mockCheckout(api);
    const left = AMOUNT - 50_000;
    api.get('/payments/bank-qr/:code', ({ params }) => bankQrFor(params.code!, left, { paidSoFar: 50_000 }));
    api.allowUnmocked('GET /flash-sales/upcoming', 'POST /events');
    await captureVietQrImage(page);
    await page.goto(miniPath(`/bank-payment/${SHORT_BANK}`));
    await expect(page.getByTestId('paid-so-far')).toContainText(vnd(50_000), { timeout: 20_000 });
    expectQrImage(await page.locator('img[alt="VietQR"]').getAttribute('src'), SHORT_BANK, left);
  });
});
