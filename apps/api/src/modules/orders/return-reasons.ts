/** Lý do trả hàng chọn sẵn (D3). shopFault = lỗi phía shop/nhà sản xuất → hoàn cả phí ship dù chỉ trả một phần. */
export const RETURN_REASONS = {
  DEFECTIVE: { label: 'Sản phẩm lỗi, hỏng', shopFault: true },
  WRONG_ITEM: { label: 'Giao sai sản phẩm', shopFault: true },
  DAMAGED: { label: 'Bể vỡ, móp méo khi vận chuyển', shopFault: true },
  EXPIRED: { label: 'Hết hạn hoặc sai hạn sử dụng', shopFault: true },
  OTHER: { label: 'Lý do khác', shopFault: false },
} as const;

export type ReturnReasonCode = keyof typeof RETURN_REASONS;
export const RETURN_REASON_CODES = Object.keys(RETURN_REASONS) as ReturnReasonCode[];

/** Yêu cầu cũ (không có mã lý do) vốn chỉ nhận lỗi nhà sản xuất — mặc định là lỗi do shop. */
export function defaultShopFault(reasonCode: string | null | undefined): boolean {
  if (!reasonCode) return true;
  return RETURN_REASONS[reasonCode as ReturnReasonCode]?.shopFault ?? false;
}
