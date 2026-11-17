import type { HttpClient } from './http';

/**
 * Ô "Nhận hành trình đơn hàng qua Zalo" ở thanh toán và nút kết bạn Zalo Tubu Tree (quyết định PO số 3, wave tubu-mss-consent-ui).
 * Máy chủ tính sẵn cho từng khách (cờ `mss.order_events_enabled`, MSS nhận sự kiện, tỉ lệ rollout, số đã xác minh); hai app chỉ vẽ.
 */
export interface OrderZaloStatus {
  enabled: boolean;
  prechecked: boolean;
  /** Lựa chọn gần nhất của khách; null khi chưa từng chọn. */
  choice: boolean | null;
  /** Số đã xác minh dạng `090•••4567`; null thì MSS không nhắn được nên không hỏi. */
  phoneMasked: string | null;
  tubuZaloPhone: string;
}

export const fetchOrderZaloStatus = (http: HttpClient) => http.get<OrderZaloStatus>('/config/order-zalo');

/** Công tắc ở Cài đặt; máy chủ ghi nguồn `account_settings` và phiên bản câu chữ. */
export const saveOrderZaloChoice = (http: HttpClient, enabled: boolean) =>
  http.patch<{ enabled: boolean }>('/me/order-zalo-updates', { enabled });

/** Cùng phiên bản câu chữ máy chủ lưu kèm lựa chọn (`ORDER_ZALO_CONSENT_TEXT_VERSION` ở API): đổi câu `checkout.orderZalo*` thì đổi cả hai. */
export const ORDER_ZALO_CONSENT_TEXT_VERSION = 'order-zalo-v1-2026-11-17';

export const TUBU_ZALO_PHONE = '0899149229';

/** Có hiện ô không (null = không) và trạng thái tick ban đầu: lần đầu theo cấu hình, sau đó theo lựa chọn gần nhất. */
export function orderZaloConsentView(s: OrderZaloStatus | null | undefined): { checked: boolean; phone: string } | null {
  if (!s?.enabled || !s.phoneMasked) return null;
  return { checked: s.choice ?? s.prechecked, phone: s.phoneMasked };
}

export function tubuZaloNumber(phone: string | null | undefined): string {
  return phone && /^0\d{9}$/.test(phone) ? phone : TUBU_ZALO_PHONE;
}

export function tubuZaloUrl(phone: string | null | undefined): string {
  return `https://zalo.me/${tubuZaloNumber(phone)}`;
}

/**
 * Lời mời kết bạn ở chi tiết đơn: cờ chung bật, đơn này có đồng ý và hành trình chưa xong. Đơn đã giao, huỷ, trả thì không còn tin
 * hành trình nào để nhận. `orderZaloConsent` có trong GET /orders/:code và place-order nhưng chưa khai ở kiểu đơn chung.
 */
export function showOrderZaloFriend(enabled: boolean | undefined, order: { status: string; orderZaloConsent?: unknown }): boolean {
  return enabled === true && order.orderZaloConsent === true && /^(PENDING_PAYMENT|CONFIRMED|PACKED|SHIPPING)$/.test(order.status);
}
