import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockWorld } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { BANK_FIXTURE, bankQrFor, seedBank } from './support/bank-fixture';
import { crc16, decodeVietQr } from './support/emvco';
import { buildVietQrPayload, crc16ccitt } from '../../api/src/modules/integrations/payment/vietqr';
import { captureVietQrImage, expectEmvQr, expectQrImage, LEGACY_CODE, SHORT_BANK, vnd } from './support/pre-submit';

/**
 * Trước khi gửi duyệt Zalo (tubu-w36-02), trang QR chuyển khoản web `/thanh-toan/chuyen-khoan/<mã>` của khách đăng nhập: tên ngân hàng, BIN trong
 * ảnh QR, số tài khoản và chủ tài khoản đọc từ `support/bank-fixture.ts` (khớp seed.ts), số tiền, nội dung = mã đơn (mã ngắn và mã dài cũ), nút chép.
 * Chuỗi `qrString` dựng bằng hàm sinh QR của API rồi giải lại bằng `support/emvco.ts` viết độc lập.
 */
const WEB_PROJECTS = new Set(['Web Customer', 'Web Customer Mobile']);
const AMOUNT = 149_000;

/** Không chắc có quyền clipboard trong trình duyệt test: ghi lại chuỗi được chép. */
async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => { (window as unknown as { __copied?: string }).__copied = t; return Promise.resolve(); } },
    });
  });
}
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied?: string }).__copied);
const copyButton = (page: Page, text: string, name: string) =>
  page.locator(`button[aria-label="Sao chép: ${text}"], button[aria-label="Sao chép ${name}"]`).filter({ visible: true }).first();

test.describe('Trước gửi duyệt: tài khoản nhận và chuỗi VietQR', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'Kiểm dữ liệu, không phụ thuộc khổ màn: một project là đủ');
  });

  test('tài khoản trong bank-fixture khớp bốn dòng payment.bank_* của seed.ts (Techcombank 970407)', () => {
    expect(seedBank()).toEqual({ ...BANK_FIXTURE });
    expect(BANK_FIXTURE.bin).toBe('970407');
  });

  test('chuỗi EMV của hàm sinh QR API: thẻ 38/54/62.08 đúng với mã ngắn và mã cũ, CRC16 trùng hai cách tính, sửa một ký tự thì CRC sai', () => {
    for (const code of [SHORT_BANK, LEGACY_CODE]) {
      const qr = bankQrFor(code, AMOUNT).qrString;
      expectEmvQr(qr, code, AMOUNT, BANK_FIXTURE);
      expect(crc16(qr.slice(0, -4))).toBe(crc16ccitt(qr.slice(0, -4)));
      const last = BANK_FIXTURE.accountNo.slice(-1);
      const tampered = qr.replace(BANK_FIXTURE.accountNo, `${BANK_FIXTURE.accountNo.slice(0, -1)}${(Number(last) + 1) % 10}`);
      expect(decodeVietQr(tampered).crcValid).toBe(false);
    }
    // Không số tiền thì QR tĩnh (11) và không có thẻ 54.
    const still = decodeVietQr(buildVietQrPayload({ bin: BANK_FIXTURE.bin, accountNo: BANK_FIXTURE.accountNo }));
    expect(still).toMatchObject({ pointOfInitiation: '11', amount: undefined, purpose: undefined, crcValid: true });
    // Giá trị chuẩn của CRC-16/CCITT-FALSE: "123456789" ra 29B1.
    expect(crc16('123456789')).toBe('29B1');
  });
});

test.describe('Trước gửi duyệt: trang QR chuyển khoản web', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!WEB_PROJECTS.has(testInfo.project.name), 'Chỉ hai project web khách');
    await page.setViewportSize(testInfo.project.name === 'Web Customer Mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  });

  for (const code of [SHORT_BANK, LEGACY_CODE]) {
    test(`đơn ${code}: ngân hàng, số tài khoản, chủ tài khoản, số tiền, nội dung = mã đơn, ảnh QR đúng khuôn, nút chép`, async ({ page, api }) => {
      await stubClipboard(page);
      await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
      api.get('/payments/bank-qr/:code', ({ params }) => bankQrFor(params.code!, AMOUNT));
      const images = await captureVietQrImage(page);
      await page.goto(`/thanh-toan/chuyen-khoan/${code}`);
      await expect(page.getByRole('heading', { name: 'Quét QR để chuyển khoản' }).filter({ visible: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(BANK_FIXTURE.accountNo).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
      expect(api.callsTo('GET', '/payments/bank-qr/:code').map((c) => c.path)).toContain(`/payments/bank-qr/${code}`);

      for (const text of [BANK_FIXTURE.name, BANK_FIXTURE.accountName, vnd(AMOUNT)]) {
        await expect(page.getByText(text).filter({ visible: true }).first()).toBeVisible();
      }
      await expect(page.getByTestId('memo-note').filter({ visible: true })).toContainText(code);
      const img = page.locator('img[alt="VietQR"]').filter({ visible: true });
      await expect(img).toBeVisible();
      expectQrImage(await img.getAttribute('src'), code, AMOUNT);
      await expect.poll(() => images.length).toBeGreaterThan(0);
      await expect(page.getByTestId('bank-qr-failed')).toHaveCount(0);

      await copyButton(page, BANK_FIXTURE.accountNo, 'số tài khoản').click();
      await expect.poll(() => copied(page)).toBe(BANK_FIXTURE.accountNo);
      await copyButton(page, code, 'nội dung chuyển khoản').click();
      await expect.poll(() => copied(page)).toBe(code);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }

  test('chuyển thiếu: số tiền và ảnh QR theo phần còn thiếu, có dòng đã nhận', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    const left = AMOUNT - 50_000;
    api.get('/payments/bank-qr/:code', ({ params }) => bankQrFor(params.code!, left, { paidSoFar: 50_000 }));
    await captureVietQrImage(page);
    await page.goto(`/thanh-toan/chuyen-khoan/${SHORT_BANK}`);
    await expect(page.getByTestId('paid-so-far').filter({ visible: true })).toContainText(`Đã nhận ${vnd(50_000)}, còn thiếu ${vnd(left)}`, { timeout: 20_000 });
    expectQrImage(await page.locator('img[alt="VietQR"]').filter({ visible: true }).getAttribute('src'), SHORT_BANK, left);
  });
});
