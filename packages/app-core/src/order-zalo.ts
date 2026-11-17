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

export const TUBU_ZALO_PHONE = '0899149229';

/** Đơn còn hành trình để báo: chưa giao, chưa huỷ, chưa trả. */
const ORDER_ZALO_ACTIVE = /^(PENDING_PAYMENT|CONFIRMED|PACKED|SHIPPING)$/;

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
  return enabled === true && order.orderZaloConsent === true && ORDER_ZALO_ACTIVE.test(order.status);
}


/**
 * Bật tin hành trình qua Zalo cho một đơn đang đi (nút ở chi tiết đơn). Máy chủ ghi đồng ý của đơn (nguồn `order_detail`, phiên bản câu chữ) và
 * lựa chọn gần nhất của khách; chỉ sự kiện xảy ra sau đó mới được báo. Gọi lại khi đã bật trả cùng kết quả.
 */
export const enableOrderZaloForOrder = (http: HttpClient, code: string) =>
  http.post<{ orderZaloConsent: true }>(`/orders/${encodeURIComponent(code)}/order-zalo-consent`);

export type OrderZaloDetailView = { kind: 'offer'; phone: string } | { kind: 'on'; phone: string } | null;

/**
 * Dòng Zalo trong khối hành trình ở chi tiết đơn: nút "Nhận thông báo Zalo cho đơn này" (kèm đúng câu đồng ý và số nhận như ô ở thanh toán, vì máy chủ
 * ghi cùng phiên bản câu chữ) khi cờ chung bật, có số đã xác minh, đơn còn đang đi, chưa có đồng ý và máy chủ báo đơn nhắn được (`orderZaloAvailable`).
 * Dòng "Sẽ báo qua Zalo số …" chỉ khi máy chủ báo tin đang thật sự được gửi (`orderZaloOn`): đơn có đồng ý mà khách đã tắt ở Cài đặt, nhắn dừng
 * trên Zalo, hay đơn giao tới số khác thì bộ ghi sự kiện bỏ qua, màn không được hứa. API cũ không trả hai trường này thì không có gì.
 */
export function orderZaloDetailView(
  s: OrderZaloStatus | null | undefined,
  order: { status: string; orderZaloConsent?: unknown; orderZaloAvailable?: unknown; orderZaloOn?: unknown },
): OrderZaloDetailView {
  if (!s?.enabled || !s.phoneMasked || !ORDER_ZALO_ACTIVE.test(order.status)) return null;
  if (order.orderZaloOn === true) return { kind: 'on', phone: s.phoneMasked };
  return order.orderZaloAvailable === true && order.orderZaloConsent !== true ? { kind: 'offer', phone: s.phoneMasked } : null;
}
