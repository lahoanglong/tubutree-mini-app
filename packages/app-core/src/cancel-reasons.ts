/** Lý do khách chọn khi tự huỷ đơn: cùng mã với API (apps/api/src/modules/orders/cancel-reasons.ts). "Lý do khác" cho viết thêm. */
export const CANCEL_REASONS = [
  { code: 'CHANGED_MIND', label: 'Đổi ý, không muốn mua nữa' },
  { code: 'WRONG_ORDER', label: 'Đặt nhầm sản phẩm hoặc số lượng' },
  { code: 'CHANGE_DETAILS', label: 'Muốn đổi địa chỉ hoặc cách thanh toán' },
  { code: 'FOUND_BETTER', label: 'Tìm được nơi bán giá tốt hơn' },
  { code: 'OTHER', label: 'Lý do khác' },
] as const;

export type CancelReasonCode = (typeof CANCEL_REASONS)[number]['code'];

export const CANCEL_REASON_TEXT_MAX = 200;

export interface CancelReasonBody {
  cancelReasonCode: CancelReasonCode;
  cancelReasonText?: string;
}

/** Phần body huỷ đơn mang lý do; lời viết thêm chỉ gửi khi khách chọn "Lý do khác" và có viết. */
export function cancelReasonBody(code: CancelReasonCode, text: string): CancelReasonBody {
  const detail = code === 'OTHER' ? text.trim().slice(0, CANCEL_REASON_TEXT_MAX) : '';
  return detail ? { cancelReasonCode: code, cancelReasonText: detail } : { cancelReasonCode: code };
}
