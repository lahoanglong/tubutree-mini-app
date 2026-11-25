import type { Page } from '@playwright/test';
import { LEGACY_ORDER_CODE_RE, SHORT_ORDER_CODE_RE } from '@tubutree/shared-types';
import { expect, type MockApi } from './mock-api';
import { placedOrderFor } from './checkout-mocks';
import { bankQrFor, PNG_1X1, vietQrImageUrl } from './bank-fixture';
import { decodeVietQr } from './emvco';

/**
 * Bộ kiểm trước khi gửi duyệt Zalo (tubu-w36-02): mã đơn mẫu, đường dẫn Mini App theo bản chạy (Vite dev hay bản build `www`), đơn đặt xong
 * mang mã ngắn và trang QR đọc tài khoản từ `support/bank-fixture.ts`.
 */

/** Mã ngắn (w34-01) của đơn COD và đơn chuyển khoản, mã dài cũ còn trên đơn, tin nhắn và hoá đơn đã gửi. */
export const SHORT_COD = 'TB7K4M';
export const SHORT_BANK = 'TB9QRB';
export const LEGACY_CODE = 'TUBU2026112212345';

for (const c of [SHORT_COD, SHORT_BANK]) if (!SHORT_ORDER_CODE_RE.test(c)) throw new Error(`${c} không còn là mã ngắn hợp lệ`);
if (!LEGACY_ORDER_CODE_RE.test(LEGACY_CODE)) throw new Error(`${LEGACY_CODE} không còn là mã dài hợp lệ`);

/**
 * Tiền tố đường dẫn Mini App. Vite dev phục vụ ở gốc; bản build `www` (playwright.mini-www.config.ts) chạy dưới `/zapps/<appId>/` như ZMPRouter
 * production (ngoài Zalo appId rỗng nên là `/zapps/undefined`).
 */
export const MINI_BASE = process.env.E2E_MINI_BASE ?? '';
export const builtWww = MINI_BASE !== '';
export const miniPath = (p: string): string => `${MINI_BASE}${p}`;

/** Đơn trả về từ place-order mang mã ngắn và phản chiếu ô Zalo của body như máy chủ ghi cột `orderZaloConsent`. */
export function placeWithShortCodes(api: MockApi, zaloOn = true): void {
  api.post('/checkout/place-order', ({ call }) => {
    const body = (call.body ?? {}) as Record<string, unknown>;
    const bank = body.paymentMethod === 'BANK_TRANSFER';
    const code = bank ? SHORT_BANK : SHORT_COD;
    return { ...placedOrderFor(body), id: `id-${code}`, code, orderZaloConsent: zaloOn && body.orderZaloConsent === true };
  });
}

/** Trang QR của mọi đơn: tài khoản trong fixture, số tiền `amount`. */
export function mockBankQr(api: MockApi, amount: number): void {
  api.get('/payments/bank-qr/:code', ({ params }) => bankQrFor(params.code!, amount));
}

/**
 * Ảnh QR img.vietqr.io: trả PNG 1×1 và ghi URL trình duyệt xin. mock-api chặn mọi host ngoài, ảnh lỗi thì trang thay khung QR bằng câu báo lỗi
 * và không còn thẻ `img` để đọc. Đăng ký sau fixture `api` nên thắng luật chặn host ngoài.
 */
export async function captureVietQrImage(page: Page): Promise<string[]> {
  const urls: string[] = [];
  await page.route(
    (u) => u.hostname === 'img.vietqr.io',
    (route) => {
      urls.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
    },
  );
  return urls;
}

/** Thẻ 38 (BIN + số tài khoản), 54 (số tiền), 62.08 (mã đơn) của `qrString` và CRC16 đúng. */
export function expectEmvQr(qrString: string, code: string, amount: number, bank: { bin: string; accountNo: string }): void {
  const qr = decodeVietQr(qrString);
  expect(qr).toMatchObject({
    pointOfInitiation: '12',
    guid: 'A000000727',
    bin: bank.bin,
    accountNo: bank.accountNo,
    service: 'QRIBFTTA',
    currency: '704',
    amount: String(amount),
    country: 'VN',
    purpose: code,
  });
  expect(qr.crcValid, `CRC ${qr.crc} ≠ ${qr.crcExpected}`).toBe(true);
}

/** URL ảnh QR trên trang đúng khuôn API (`vietQrImageUrl`): số tiền và nội dung = mã đơn. */
export function expectQrImage(src: string | null | undefined, code: string, amount: number): void {
  expect(src).toBe(vietQrImageUrl(code, amount));
  const u = new URL(src!);
  expect(u.searchParams.get('amount')).toBe(String(amount));
  expect(u.searchParams.get('addInfo')).toBe(code);
}

/** "149.000đ" như `formatVnd` của hai app. */
export const vnd = (n: number): string => `${n.toLocaleString('vi-VN')}đ`;
