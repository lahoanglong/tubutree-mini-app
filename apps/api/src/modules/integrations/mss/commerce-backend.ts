/**
 * Điểm cắt strangler giữa Tubu và kho/đơn phía sau (hợp đồng commerce v0.9 mục 0.3 và 0.5): mỗi đơn mang `Order.backendRoute`
 * ghi lúc tạo và không bao giờ đổi, nên lật cờ chỉ ảnh hưởng đơn mới và không đơn nào bị đẩy hai đường.
 *
 * Khai báo kiểu ở file riêng không import service: PancakeModule hiện thực interface này mà không tạo vòng module với MssModule.
 */

export const BACKEND_ROUTES = ['PANCAKE_DIRECT', 'MSS'] as const;
export type BackendRoute = (typeof BACKEND_ROUTES)[number];
/** Giá trị mặc định của cột `orders.backendRoute` (migration) và tuyến của mọi đơn khi cờ MSS tắt. */
export const DEFAULT_BACKEND_ROUTE: BackendRoute = 'PANCAKE_DIRECT';

export function isBackendRoute(v: unknown): v is BackendRoute {
  return (BACKEND_ROUTES as readonly unknown[]).includes(v);
}

/**
 * Các việc Tubu nhờ phía sau làm cho một đơn đã commit cục bộ. Mọi hàm là "xếp việc" (bất đồng bộ, an toàn khi gọi lặp):
 * kết quả thật về qua hàng đợi/cron đối soát của từng hiện thực, không qua giá trị trả về.
 */
export interface CommerceBackend {
  readonly route: BackendRoute;
  pushOrder(orderId: string): Promise<void>;
  cancelOrder(orderId: string): Promise<void>;
  confirmPayment(orderId: string): Promise<void>;
  requestInvoice(orderId: string): Promise<void>;
}

/** Token DI của hiện thực đường MSS. Wave này KHÔNG đăng ký provider nào cho token (MssBackend chưa vào đường chạy). */
export const MSS_COMMERCE_BACKEND = Symbol('MSS_COMMERCE_BACKEND');

/** Đơn mang tuyến chưa có hiện thực trong bản build này (ví dụ `MSS` trước wave đẩy đơn qua MSS): không được rơi về Pancake. */
export class CommerceBackendUnavailableError extends Error {
  constructor(readonly route: string) {
    super(`Chưa có hiện thực cho tuyến đơn ${route}`);
    this.name = 'CommerceBackendUnavailableError';
  }
}
