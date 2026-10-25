import type { OrderDTO, OrderItemDTO } from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import type { PageResponse } from './catalog';
import type { CartSummary } from './cart';
import type { SplitOrderDTO } from './checkout';

export type ReturnReasonCode = 'DEFECTIVE' | 'WRONG_ITEM' | 'DAMAGED' | 'EXPIRED' | 'OTHER';

export interface RefundBankInput {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export interface MyRefund {
  id: string;
  orderId: string;
  orderCode: string;
  kind: 'END_CUSTOMER' | 'CANCEL' | 'RETURN' | 'LATE_PAYMENT' | 'OVERPAYMENT';
  /** Khoản trả hàng: id yêu cầu trả. API cũ chưa trả. */
  refKey?: string;
  amount: number;
  method: 'WALLET' | 'MANUAL_TRANSFER';
  /** PROCESSING: Tubu đã bắt đầu chuyển khoản — nơi nhận đã chốt. */
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED';
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  bankRef: string | null;
  completedAt: string | null;
  createdAt: string;
  canChooseDestination: boolean;
}

/** Một dòng trạng thái khoản hoàn cho khách: đang ở đâu, cần làm gì. */

/** Ảnh/tồn kho từng dòng do API join theo variationId (dự án 4a). Optional: API cũ không trả. */
export interface OrderItemMedia {
  thumbnail?: string | null;
  stock?: number;
  available?: boolean;
  currentPrice?: number | null;
}
export type OrderItemView = OrderItemDTO & OrderItemMedia;
export type OrderView = Omit<OrderDTO, 'items'> & {
  items: OrderItemView[];
  /** Mã giảm giá đã dùng và các phần của `discount` (API cũ chưa trả; đơn cũ để 0). */
  couponCode?: string | null;
  /** Mã của lần đặt khi đơn tách này không giữ lượt dùng mã (đơn đầu của nhóm giữ) — để ghi đúng tên mã ở dòng giảm giá. */
  groupCouponCode?: string | null;
  couponDiscount?: number;
  comboDiscount?: number;
  tierDiscount?: number;
  pointsDiscount?: number;
  /** Ai giao đơn này (D4). API cũ chưa trả. */
  fulfilment?: { kind: 'TUBU' | 'MERCHANT'; name: string; phone: string | null };
  /** Các đơn khác cùng lần đặt (đơn bị tách theo nơi giao). */
  siblings?: { code: string; status: string; total: number; fulfillerName: string }[];
};

/** Response place-order: đơn chính, kèm danh sách đơn con khi lần đặt bị tách theo nơi giao. */
export type PlacedOrder = OrderDTO & { splitOrders?: SplitOrderDTO[] };

export type OrderStatusGroup = 'processing' | 'closed';
export interface OrderListFilter {
  status?: string;
  group?: OrderStatusGroup;
}

// Bug 1 fix: truoc day khong truyen page/limit -> BE mac dinh page=1 limit=20, khach co >20 don
// khong bao gio xem duoc don cu hon qua app. Nhan them page/limit de orders.tsx phan trang duoc.
export const fetchOrders = (http: HttpClient, filter: OrderListFilter = {}, page = 1, limit = 20) =>
  http.get<PageResponse<OrderView>>('/orders', {
    query: {
      ...(filter.status ? { status: filter.status } : filter.group ? { group: filter.group } : {}),
      page,
      limit,
    },
  });
export const fetchOrder = (http: HttpClient, code: string) => http.get<OrderView>(`/orders/${code}`);
/** Badge tab Đơn hàng. Dữ liệu lạ (vd mock/route khác trả nhầm) → 0 thay vì NaN. */
export const fetchActiveOrderCount = async (http: HttpClient) => {
  const body = await http.get<{ count?: unknown }>('/orders/active-count');
  return typeof body?.count === 'number' ? body.count : 0;
};

export interface PurchasedItem {
  variationId: string;
  productId: string;
  slug: string;
  productName: string;
  variationName: string;
  brand: string;
  thumbnail: string | null;
  price: number;
  salePrice: number | null;
  stock: number;
  inStock: boolean;
  timesBought: number;
  /** Hàng chỉ bán lẻ (đối tác): không đặt định kỳ được. API cũ chưa trả: coi là chưa biết, không mời "Định kỳ". */
  retailOnly?: boolean;
  lastPurchasedAt: string;
}
export interface PurchasedItemsPage {
  items: PurchasedItem[];
  nextCursor: string | null;
}
export const fetchPurchasedItems = (http: HttpClient, params: { cursor?: string; limit?: number; variationId?: string } = {}) =>
  http.get<PurchasedItemsPage>('/me/purchased-items', { query: params });

/** Nơi nhận tiền hoàn (D2). Không gửi = Ví Tubu (như bản cũ). */
export type RefundDestinationBody =
  | { refundMethod: 'WALLET' }
  | { refundMethod: 'BANK'; bankName: string; accountNumber: string; accountName: string };


export const cancelOrder = (http: HttpClient, code: string, destination?: RefundDestinationBody) =>
  http.post<OrderDTO>(`/orders/${code}/cancel`, destination ?? {});
export type RepurchaseAddSource = 'repurchase' | 'reorder_notification';
export type RepurchaseSkipReason = 'OUT_OF_STOCK' | 'INACTIVE' | 'NOT_APPROVED' | 'EXCEEDS_STOCK';
export interface RepurchaseLineResult {
  orderItemId: string;
  status: 'added' | 'partial' | 'skipped';
  reason?: RepurchaseSkipReason;
  addedQuantity: number;
}
export interface RepurchaseResponse {
  cart: CartSummary;
  results: RepurchaseLineResult[];
  /** Response không có kết quả từng dòng (API trước dự án 4a trả giỏ trơn). */
  legacy: boolean;
}
/**
 * API v2 trả `{ ...giỏ, cart, results }`: giỏ ở top-level (để bản miniapp cũ vẫn đọc được) và khoá `cart`
 * tường minh. Ưu tiên khoá `cart`; nếu thiếu thì dùng phần top-level — luôn bỏ `results`/`cart` lồng ra khỏi giỏ.
 */
export function normalizeRepurchaseResponse(
  raw: CartSummary & { cart?: CartSummary; results?: RepurchaseLineResult[] },
): RepurchaseResponse {
  const { results, cart: nested, ...top } = raw;
  const cart: CartSummary = nested ?? top;
  return Array.isArray(results) ? { cart, results, legacy: false } : { cart, results: [], legacy: true };
}
export const repurchaseOrder = (
  http: HttpClient,
  code: string,
  body: { items?: { orderItemId: string; quantity: number }[]; addSource?: RepurchaseAddSource } = {},
) =>
  http
    .post<CartSummary & { cart?: CartSummary; results?: RepurchaseLineResult[] }>(`/orders/${code}/repurchase`, body)
    .then((raw) => normalizeRepurchaseResponse(raw));
export interface ReturnRequestBody {
  reasonCode: ReturnReasonCode;
  reason?: string;
  images?: string[];
  items: { orderItemId: string; quantity: number }[];
}
export const requestReturn = (http: HttpClient, code: string, body: ReturnRequestBody & Partial<RefundDestinationBody>) =>
  http.post<ReturnRequestDTO>(`/orders/${code}/return-request`, body);
/** Số tiền dự kiến hoàn cho các dòng khách đang chọn (cùng cách tính lúc Tubu duyệt). */
export interface ReturnEstimateDTO {
  isFull: boolean;
  goods: number;
  shipping: number;
  refund: number;
  moneyRefundable: boolean;
  pointsUsedBack: number;
  lines: { orderItemId: string; quantity: number; refundAmount: number }[];
}
export const estimateReturn = (
  http: HttpClient,
  code: string,
  body: { reasonCode?: ReturnReasonCode; items: { orderItemId: string; quantity: number }[] },
) => http.post<ReturnEstimateDTO>(`/orders/${code}/return-estimate`, body);
export interface ReturnRequestDTO {
  id: string;
  orderId: string;
  reason: string;
  reasonCode?: string | null;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  adminNote: string | null;
  refundMethod?: 'WALLET' | 'BANK';
  bankName?: string | null;
  bankAccountNo?: string | null;
  /** Tiền hàng + phí ship hoàn khi duyệt (null khi chưa duyệt). */
  refundAmount?: number | null;
  shippingRefund?: number;
  pointsRefunded?: number;
  /** Điểm Xanh đã cộng từ đơn mà phiếu này thu lại khi duyệt. */
  pointsReversed?: number;
  fullReturn?: boolean;
  receivedAt?: string | null;
  items?: { orderItemId: string; quantity: number; refundAmount: number }[];
  createdAt: string;
}
export const fetchMyReturns = (http: HttpClient) => http.get<ReturnRequestDTO[]>('/orders/me/returns');

/** Các khoản hoàn tiền của khách (chuyển khoản chờ xử lý, tiền về muộn) cho một đơn. */
export const fetchMyRefunds = (http: HttpClient, orderId: string) =>
  http.get<MyRefund[]>('/orders/me/refunds', { query: { orderId } });
/** Tài khoản ngân hàng khách dùng gần nhất — điền sẵn khi chọn hoàn về ngân hàng. */
export const fetchRefundBank = (http: HttpClient) =>
  http.get<{ bank: RefundBankInput | null }>('/orders/me/refund-bank').then((r) => r.bank);
export const chooseRefundDestination = (http: HttpClient, refundId: string, body: RefundDestinationBody) =>
  http.post<MyRefund>(`/orders/me/refunds/${refundId}/destination`, body);
