import { ACCOUNT_NAME_REQUIRED, ACCOUNT_NUMBER_INVALID, BANK_NAME_REQUIRED, RETURN_REASON_REQUIRED } from '@tubutree/app-core/client-copy';
import type { RefundBankInput, RefundMethodChoice, ReturnLineState, ReturnReasonCode } from './refund-rules';

/** Tách khỏi refund-rules để câu lỗi form chỉ nằm trong chunk lazy của sheet trả hàng/hoàn tiền, không vào entry. */
/** Kiểm tài khoản nhận hoàn tiền giống API (refund-destination.ts), lỗi theo từng ô để hiện dưới đúng ô sai. */
export function bankFieldErrors(b: RefundBankInput): Partial<Record<keyof RefundBankInput, string>> {
  const errors: Partial<Record<keyof RefundBankInput, string>> = {};
  if (b.bankName.trim().length < 2) errors.bankName = BANK_NAME_REQUIRED;
  if (!/^\d{6,24}$/.test(b.accountNumber.replace(/[\s.-]/g, ''))) errors.accountNumber = ACCOUNT_NUMBER_INVALID;
  if (b.accountName.trim().length < 2) errors.accountName = ACCOUNT_NAME_REQUIRED;
  return errors;
}

/** Lỗi đầu tiên của tài khoản nhận hoàn tiền, null khi hợp lệ. */
export function bankDetailsError(b: RefundBankInput): string | null {
  const e = bankFieldErrors(b);
  return e.bankName ?? e.accountNumber ?? e.accountName ?? null;
}

/** Kiểm form đổi/trả trước khi gửi. Trả câu lỗi đầu tiên, hoặc null khi hợp lệ. */
export function returnFormError(input: {
  lines: ReturnLineState[];
  reasonCode: ReturnReasonCode | null;
  reason: string;
  refundMethod: RefundMethodChoice;
  bank: RefundBankInput;
}): string | null {
  if (!input.lines.some((l) => l.selected && l.quantity > 0)) return 'Chọn ít nhất một sản phẩm muốn trả.';
  if (!input.reasonCode) return 'Chọn lý do đổi/trả.';
  if (input.reasonCode === 'OTHER' && input.reason.trim().length < 5) return RETURN_REASON_REQUIRED;
  if (input.refundMethod === 'BANK') return bankDetailsError(input.bank);
  return null;
}
