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

/** Một phân loại khách đang chờ hàng về (`GET /me/restock-alerts`), kèm sản phẩm để trang Yêu thích gắn vào thẻ. */
export interface MyRestockAlert {
  variationId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variationName: string;
  /** Tồn bán được lúc đọc; > 0 là hàng đã về, tin báo đang chờ lượt gửi kế tiếp. */
  stock: number;
  createdAt: string;
}

export interface MyRestockAlerts {
  /** Cờ catalog.restock_alert_enabled: tắt thì trang Yêu thích không có chuông, nhãn hay chip "Chờ hàng về" (danh sách luôn rỗng). */
  enabled: boolean;
  items: MyRestockAlert[];
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

/** Cần đăng nhập: mọi phân loại khách đang chờ hàng về, một lần gọi cho cả trang Yêu thích. */
export const fetchMyRestockAlerts = (http: HttpClient) => http.get<MyRestockAlerts>('/me/restock-alerts');

/**
 * Khoá cache danh sách đăng ký của khách. Cùng tiền tố `restock-alerts` với khoá theo sản phẩm (`invalidateQueries(['restock-alerts'])` làm
 * mới cả hai); `@me` không bao giờ trùng mã sản phẩm.
 */
export const myRestockAlertsKey = ['restock-alerts', '@me'] as const;

/** Khoá cache dùng chung hai app: theo sản phẩm và theo việc có phiên hay không (bản không phiên luôn rỗng). */
export const restockStatusKey = (productId: string, authed: boolean) => ['restock-alerts', productId, authed ? 'me' : 'guest'] as const;
