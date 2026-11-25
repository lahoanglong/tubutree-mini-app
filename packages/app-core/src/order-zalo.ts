import type { HttpClient } from './http';
import { parseTypedVnPhone } from './affiliate-rules';

/**
 * Ô "Nhận hành trình đơn hàng qua Zalo" ở thanh toán và nút kết bạn Zalo Tubu Tree (quyết định PO số 3, wave tubu-mss-consent-ui).
 * Máy chủ tính sẵn cho từng khách (cờ `mss.order_events_enabled`, MSS nhận sự kiện, tỉ lệ rollout, số đã xác minh); hai app chỉ vẽ.
 */
export interface OrderZaloStatus {
  enabled: boolean;
  prechecked: boolean;
  /** Lựa chọn gần nhất của khách; null khi chưa từng chọn. */
  choice: boolean | null;
  /** Số tài khoản (đã xác minh hay chưa) dạng `090•••4567`; null khi tài khoản chưa có số: ô ở thanh toán dùng số nhận hàng. */
  phoneMasked: string | null;
  /** Số tài khoản `0xxxxxxxxx` của chính khách, để so với số nhận hàng. Thiếu ở API cũ. */
  buyerPhone?: string | null;
  phoneSource?: 'account_verified' | 'checkout_contact' | null;
  /** Được hỏi "gửi thêm thông báo giao hàng cho số người nhận" (cờ người nhận + năng lực MSS). Thiếu ở API cũ = không. */
  recipientEnabled?: boolean;
  tubuZaloPhone: string;
  /** Khách đã là bạn Zalo của Tubu Tree (MSS gửi được tin đơn như bạn bè trong 90 ngày): ẩn lời mời kết bạn. Thiếu ở API cũ = chưa biết. */
  friendKnown?: boolean;
}

export const fetchOrderZaloStatus = (http: HttpClient) => http.get<OrderZaloStatus>('/config/order-zalo');

/** Công tắc ở Cài đặt; máy chủ ghi nguồn `account_settings` và phiên bản câu chữ. */
export const saveOrderZaloChoice = (http: HttpClient, enabled: boolean) =>
  http.patch<{ enabled: boolean }>('/me/order-zalo-updates', { enabled });

export const TUBU_ZALO_PHONE = '0899149229';

/** Đơn còn hành trình để báo: chưa giao, chưa huỷ, chưa trả. */
const ORDER_ZALO_ACTIVE = /^(PENDING_PAYMENT|CONFIRMED|PACKED|SHIPPING)$/;

// Cùng tập số với `normalizeVnPhone` của API. Không lấy hàm SĐT liên hệ ở phone-input: mô-đun đó thành chunk dùng chung nhỏ và bị gộp vào entry Mini.
export function orderZaloMobileOf(raw: string | null | undefined): string | null {
  const parsed = parseTypedVnPhone(raw ?? '');
  return parsed && /^0[35789]\d{8}$/.test(parsed) ? parsed : null;
}

/** Số `0xxxxxxxxx` → `090•••4567`, cùng dạng máy chủ trả ở `phoneMasked` (khác `maskPhone` của thanh toán). */
export function maskOrderZaloPhone(phone: string | null | undefined): string | null {
  return phone ? `${phone.slice(0, 3)}•••${phone.slice(-4)}` : null;
}

/**
 * Có hiện ô không (null = không) và trạng thái tick ban đầu: lần đầu theo cấu hình, sau đó theo lựa chọn gần nhất. Số nhận tin là số tài khoản;
 * tài khoản chưa có số thì số nhận hàng của địa chỉ đang chọn (PO A2, máy chủ gửi với nguồn `checkout_contact`).
 */
export function orderZaloConsentView(s: OrderZaloStatus | null | undefined, shippingPhone?: string | null): { checked: boolean; phone: string } | null {
  if (!s?.enabled) return null;
  const phone = s.phoneMasked ?? maskOrderZaloPhone(orderZaloMobileOf(shippingPhone));
  return phone ? { checked: s.choice ?? s.prechecked, phone } : null;
}

/**
 * Lời báo và công tắc người nhận dưới ô đồng ý (PO A1): chỉ khi ô đang tick, cờ người nhận bật, tài khoản có số và số nhận hàng đọc được, khác số đó.
 * Máy chủ xét lại lúc từng tin giao hàng; hai bên đọc số lệch nhau thì chỉ ẩn công tắc hoặc bỏ dòng người nhận, không bao giờ gửi nhầm.
 */
export function orderZaloRecipientView(
  s: OrderZaloStatus | null | undefined,
  shippingPhone: string | null | undefined,
  consentChecked: boolean,
): { buyerPhoneMasked: string } | null {
  if (!s?.enabled || !s.recipientEnabled || !consentChecked || !s.buyerPhone) return null;
  const to = orderZaloMobileOf(shippingPhone);
  if (!to || to === s.buyerPhone) return null;
  return { buyerPhoneMasked: s.phoneMasked ?? maskOrderZaloPhone(s.buyerPhone)! };
}

export function tubuZaloNumber(phone: string | null | undefined): string {
  return phone && /^0\d{9}$/.test(phone) ? phone : TUBU_ZALO_PHONE;
}

export function tubuZaloUrl(phone: string | null | undefined): string {
  return `https://zalo.me/${tubuZaloNumber(phone)}`;
}

/**
 * Lời mời kết bạn ở màn đặt thành công và chi tiết đơn: cờ chung bật, đơn này có đồng ý, hành trình chưa xong và khách chưa được biết là bạn Zalo
 * (`friendKnown` của GET /config/order-zalo). Đơn đã giao, huỷ, trả thì không còn tin hành trình nào để nhận. `orderZaloConsent` có trong
 * GET /orders/:code và place-order nhưng chưa khai ở kiểu đơn chung.
 */
export function showOrderZaloFriend(enabled: boolean | undefined, order: { status: string; orderZaloConsent?: unknown }, friendKnown = false): boolean {
  return enabled === true && order.orderZaloConsent === true && ORDER_ZALO_ACTIVE.test(order.status) && !friendKnown;
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
