/** Lý do khách chọn khi tự huỷ đơn. Bản chép của packages/app-core/src/cancel-reasons.ts (API không import từ app-core); sửa một nơi thì sửa cả nơi kia. */
export const CANCEL_REASONS = {
  CHANGED_MIND: 'Đổi ý, không muốn mua nữa',
  WRONG_ORDER: 'Đặt nhầm sản phẩm hoặc số lượng',
  CHANGE_DETAILS: 'Muốn đổi địa chỉ hoặc cách thanh toán',
  FOUND_BETTER: 'Tìm được nơi bán giá tốt hơn',
  OTHER: 'Lý do khác',
} as const;

export type CancelReasonCode = keyof typeof CANCEL_REASONS;
export const CANCEL_REASON_CODES = Object.keys(CANCEL_REASONS) as CancelReasonCode[];

/** Tiền tố ghi chú dòng lịch sử khi khách huỷ; customerCancelReason đọc lại đúng khuôn này. */
export const CUSTOMER_CANCEL_NOTE_PREFIX = 'Khách huỷ: ';

/** Ghi chú gắn vào dòng lịch sử huỷ đơn; không có mã thì null (app bản cũ không gửi lý do). */
export function cancelReasonNote(code: string | undefined, text: string | undefined): string | null {
  if (!code || !Object.hasOwn(CANCEL_REASONS, code)) return null;
  const label = CANCEL_REASONS[code as CancelReasonCode];
  const detail = text?.trim();
  return detail ? `${CUSTOMER_CANCEL_NOTE_PREFIX}${label}. ${detail}` : `${CUSTOMER_CANCEL_NOTE_PREFIX}${label}`;
}
