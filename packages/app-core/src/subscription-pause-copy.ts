/**
 * Chữ giải thích vì sao một gói giao định kỳ đang tạm dừng và khách làm gì để chạy lại, dùng chung cho Mini App và web.
 * Mã lý do do API ghi (`Subscription.pausedReason`): 'customer' khi khách tự bấm Tạm dừng, còn lại là mã hệ thống tự dừng
 * (cùng bộ với `reasonCode` của `SubscriptionsService.pauseSubscription`). Gói tạm dừng từ trước khi có cột, hoặc mã lạ do API mới hơn app,
 * chỉ hiện dòng chung "Đang tạm dừng" chứ không đoán lý do.
 * Độ dài tối đa (giữ vừa thẻ 320px, 2 dòng gợi ý): `title` 48 ký tự, `hint` 120 ký tự; `subscription-pause-copy.spec.ts` ghim.
 */
export const SUBSCRIPTION_PAUSE_REASONS = ['customer', 'inactive_product', 'invalid_address', 'partner_goods', 'insufficient_wallet', 'cod_limit'] as const;
export type SubscriptionPauseReason = (typeof SUBSCRIPTION_PAUSE_REASONS)[number];

export interface SubscriptionPauseView {
  title: string;
  /** Rỗng khi không biết lý do (không có gì để khuyên). */
  hint: string;
}

export const SUBSCRIPTION_PAUSE_MAX = { title: 48, hint: 120 } as const;

export const SUBSCRIPTION_PAUSED_GENERIC = 'Đang tạm dừng';

const COPY: Record<SubscriptionPauseReason, SubscriptionPauseView> = {
  customer: { title: 'Bạn đã tạm dừng gói này', hint: 'Bấm Tiếp tục khi muốn Tubu giao lại.' },
  inactive_product: { title: 'Sản phẩm đã ngừng bán', hint: 'Gói không giao được nữa. Bạn có thể huỷ gói và chọn sản phẩm khác.' },
  invalid_address: { title: 'Địa chỉ giao hàng không còn dùng được', hint: 'Bấm Sửa để chọn lại địa chỉ, rồi bấm Tiếp tục.' },
  partner_goods: { title: 'Sản phẩm không đặt định kỳ được nữa', hint: 'Sản phẩm thuộc gian hàng đối tác nên không có giảm giá định kỳ. Bạn có thể huỷ gói.' },
  insufficient_wallet: { title: 'Ví Tubu chưa đủ tiền cho kỳ này', hint: 'Đợi Ví Tubu đủ số dư hoặc bấm Sửa để đổi cách thanh toán, rồi bấm Tiếp tục.' },
  cod_limit: { title: 'Đơn kỳ vượt hạn mức thanh toán khi nhận hàng', hint: 'Bấm Sửa để giảm số lượng hoặc đổi sang Ví Tubu/chuyển khoản, rồi bấm Tiếp tục.' },
};

const isKnown = (reason: string): reason is SubscriptionPauseReason => Object.prototype.hasOwnProperty.call(COPY, reason);

/** Chữ cho gói PAUSED. `reason` null/undefined/lạ → dòng chung, không gợi ý. */
export function subscriptionPauseView(reason: string | null | undefined): SubscriptionPauseView {
  if (typeof reason === 'string' && isKnown(reason)) return COPY[reason];
  return { title: SUBSCRIPTION_PAUSED_GENERIC, hint: '' };
}
