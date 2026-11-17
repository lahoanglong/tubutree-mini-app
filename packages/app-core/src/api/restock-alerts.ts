import type { HttpClient } from '../http';

/** Trạng thái "Báo tôi khi có hàng" của một sản phẩm cho khách đang xem. */
export interface RestockStatus {
  /** Cờ catalog.restock_alert_enabled: tắt thì nút giữ "Tạm hết hàng" xám như cũ. */
  enabled: boolean;
  /** Phân loại của sản phẩm mà khách đang chờ báo hàng về (rỗng khi chưa đăng nhập). */
  variationIds: string[];
}

export interface RestockToggleResult {
  variationId: string;
  subscribed: boolean;
}

/**
 * Công khai. Khách đã đăng nhập gửi kèm phiên để biết mình đã đăng ký phân loại nào; khách chưa đăng nhập gọi `anonymous`
 * (không qua luồng làm mới phiên khi 401).
 */
export const fetchRestockStatus = (http: HttpClient, productId: string, opts: { anonymous: boolean }) =>
  http.get<RestockStatus>('/restock-alerts', { query: { productId }, ...(opts.anonymous ? { anonymous: true } : {}) });

export const subscribeRestock = (http: HttpClient, variationId: string) =>
  http.post<RestockToggleResult>('/me/restock-alerts', { variationId });

export const unsubscribeRestock = (http: HttpClient, variationId: string) =>
  http.delete<RestockToggleResult>(`/me/restock-alerts/${encodeURIComponent(variationId)}`);

/** Khoá cache dùng chung hai app: theo sản phẩm và theo việc có phiên hay không (bản không phiên luôn rỗng). */
export const restockStatusKey = (productId: string, authed: boolean) => ['restock-alerts', productId, authed ? 'me' : 'guest'] as const;
