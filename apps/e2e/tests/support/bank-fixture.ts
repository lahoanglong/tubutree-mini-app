import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BankQr } from '../../../miniapp/src/services/payment-api';
import { buildVietQrPayload } from '../../../api/src/modules/integrations/payment/vietqr';

/**
 * Tài khoản nhận chuyển khoản dùng trong mọi spec e2e: chép đúng bốn dòng `payment.bank_*` của `apps/api/prisma/seed.ts` (tài khoản công ty).
 * Spec đọc số từ đây, không gõ số tài khoản vào spec: khi đổi tài khoản chỉ sửa seed và tệp này, `seedBank()` bắt chỗ lệch.
 *
 * PROD đang dùng tài khoản tạm của chủ (Techcombank, BIN 970407, đuôi 6774) trong `system_configs` theo chốt của PO ngày 24/11; seed giữ tài
 * khoản công ty. go-live báo WARN `db.bank_account` khi PROD còn số đó: xem `scripts/release/pre-submit-check.sh`.
 */
export const BANK_FIXTURE = {
  bin: '970407',
  name: 'Ngân hàng TMCP Kỹ Thương Việt Nam',
  accountNo: '8386790906',
  accountName: 'CONG TY TNHH TUBU TREE',
} as const;

const SEED_KEYS = { bin: 'payment.bank_bin', accountNo: 'payment.bank_account_no', accountName: 'payment.bank_account_name', name: 'payment.bank_name' } as const;

/** Bốn giá trị `payment.bank_*` đọc thẳng từ văn bản seed.ts (không chạy seed). Thiếu dòng nào thì giá trị là null. */
export function seedBank(): Record<keyof typeof SEED_KEYS, string | null> {
  const seed = readFileSync(path.resolve(__dirname, '../../../api/prisma/seed.ts'), 'utf8');
  const read = (key: string): string | null => {
    const m = new RegExp(`key:\\s*'${key.replace(/\./g, '\\.')}',\\s*value:\\s*'([^']*)'`).exec(seed);
    return m?.[1] ?? null;
  };
  return { bin: read(SEED_KEYS.bin), accountNo: read(SEED_KEYS.accountNo), accountName: read(SEED_KEYS.accountName), name: read(SEED_KEYS.name) };
}

/** Ảnh QR đúng khuôn `BankTransferService.getBankQr`: mẫu compact2 của img.vietqr.io, số tiền, nội dung = mã đơn, tên chủ tài khoản. */
export function vietQrImageUrl(code: string, amount: number, bank: { bin: string; accountNo: string; accountName: string } = BANK_FIXTURE): string {
  return (
    `https://img.vietqr.io/image/${bank.bin}-${bank.accountNo}-compact2.png` +
    `?amount=${amount}&addInfo=${encodeURIComponent(code)}&accountName=${encodeURIComponent(bank.accountName)}`
  );
}

/**
 * Lời đáp `GET /payments/bank-qr/:code` cho một đơn đang chờ chuyển khoản: `qrString` do chính hàm sinh QR của API dựng (không phải chuỗi giả),
 * nên spec giải lại bằng `support/emvco.ts` là kiểm cả hai bên.
 */
export function bankQrFor(code: string, amount: number, over: Partial<BankQr> = {}): BankQr {
  return {
    orderCode: code,
    amount,
    paidSoFar: 0,
    paymentStatus: 'UNPAID',
    paymentDeadline: '2099-01-01T03:00:00.000Z',
    bank: { ...BANK_FIXTURE },
    memo: code,
    qrString: buildVietQrPayload({ bin: BANK_FIXTURE.bin, accountNo: BANK_FIXTURE.accountNo, amount, addInfo: code }),
    qrImageUrl: vietQrImageUrl(code, amount),
    codSwitchable: false,
    ...over,
  };
}

/** PNG 1×1 trong suốt: trả thay ảnh img.vietqr.io (mock-api chặn host ngoài, ảnh lỗi thì màn thay khung QR bằng câu báo lỗi). */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
