import { BadRequestException } from '@nestjs/common';

/** Mã lỗi ổn định: tổng lúc đặt cao hơn tổng khách đã thấy (giá/phí vừa đổi) — FE báo và tải lại báo giá. */
export const TOTAL_CHANGED = 'TOTAL_CHANGED';
export const TOTAL_CHANGED_MESSAGE_PREFIX = 'Tổng tiền đơn vừa thay đổi';

const NO_COUPON = { removed: null, notAppliedNotice: null };

/**
 * Câu báo TOTAL_CHANGED. Nêu đúng nguyên nhân khi máy chủ biết: mã giảm giá vừa bị gỡ khỏi giỏ ngay lần đặt này (hết hạn, bị
 * tắt, hết lượt), hoặc mã còn trong giỏ mà không áp được (kèm lời báo của mã). Còn lại là câu trung tính, không đổ riêng cho giá
 * hay phí giao.
 */
export function totalChangedMessage(
  expectedTotal: number,
  total: number,
  coupon: { removed: { code: string; reason: string } | null; notAppliedNotice: string | null } = NO_COUPON,
): string {
  const head = `${TOTAL_CHANGED_MESSAGE_PREFIX} từ ${expectedTotal.toLocaleString('vi-VN')}đ thành ${total.toLocaleString('vi-VN')}đ`;
  const tail = 'Vui lòng xem lại trước khi đặt.';
  if (coupon.removed) {
    return `${head} vì mã ${coupon.removed.code} không còn được áp dụng. Lý do: ${coupon.removed.reason} ${tail}`;
  }
  if (coupon.notAppliedNotice) return `${head}. ${coupon.notAppliedNotice} ${tail}`;
  return `${head} do giá, phí giao hoặc ưu đãi vừa thay đổi. ${tail}`;
}

export function totalChangedError(message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code: TOTAL_CHANGED, message });
}
