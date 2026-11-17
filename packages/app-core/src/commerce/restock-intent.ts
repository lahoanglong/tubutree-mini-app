import type { RestockStatus } from '../api/restock-alerts';

/** "Báo tôi khi có hàng" khách bấm khi chưa đăng nhập (web): đăng ký nốt sau khi đăng nhập xong, khách không phải bấm lần hai. */
export interface RestockIntent {
  variationId: string;
}

/**
 * Làm gì với ý định khi đã có phiên và đã tải trạng thái báo hàng về của sản phẩm. Chỉ đăng ký khi tính năng còn bật, phân loại vẫn hết hàng
 * và khách CHƯA đăng ký: nút là công tắc, nên gửi lại cho phân loại đã đăng ký từ trước (trên máy khác) là huỷ, ngược ý khách.
 */
export function restockIntentAction(
  intent: RestockIntent,
  status: RestockStatus,
  variations: readonly { id: string; stock: number }[],
): 'subscribe' | 'drop' {
  if (!status.enabled || status.variationIds.includes(intent.variationId)) return 'drop';
  const v = variations.find((x) => x.id === intent.variationId);
  return v && v.stock <= 0 ? 'subscribe' : 'drop';
}

export type RestockButtonView =
  /** Tính năng tắt hoặc chưa biết: nút xám "Tạm hết hàng" như trước. */
  | { kind: 'off' }
  | { kind: 'subscribe' }
  | { kind: 'subscribed' };

/** Nút chính của thanh mua khi phân loại đang chọn hết hàng. Trạng thái chưa về (đang tải, lỗi) giữ nút xám để không nhảy chữ hai lần. */
export function restockButtonView(status: RestockStatus | undefined, variationId: string | undefined): RestockButtonView {
  if (!status?.enabled || !variationId) return { kind: 'off' };
  return status.variationIds.includes(variationId) ? { kind: 'subscribed' } : { kind: 'subscribe' };
}
