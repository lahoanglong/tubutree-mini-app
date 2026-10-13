import { isGomdonPickedUp } from './recycling';

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Đã giao',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã hủy',
};

/** Tab lọc danh sách đơn — cùng nhóm với tab của Mini App (Đang xử lý gồm Đang đóng gói, Đã hủy/hoàn gồm Đã hoàn). */
export const ORDER_TABS = [
  { key: 'all', label: 'Tất cả', filter: {} },
  { key: 'pending_payment', label: 'Chờ thanh toán', filter: { status: 'PENDING_PAYMENT' } },
  { key: 'processing', label: 'Đang xử lý', filter: { group: 'processing' } },
  { key: 'shipping', label: 'Đang giao', filter: { status: 'SHIPPING' } },
  { key: 'delivered', label: 'Đã giao', filter: { status: 'DELIVERED' } },
  { key: 'closed', label: 'Đã hủy/hoàn', filter: { group: 'closed' } },
] as const satisfies readonly { key: string; label: string; filter: { status?: string; group?: 'processing' | 'closed' } }[];
export type OrderTabKey = (typeof ORDER_TABS)[number]['key'];

export const orderStatusLabel = (status: string): string => STATUS_LABEL[status] ?? status;

/** Chờ thanh toán là việc khách còn phải làm nên dùng màu cảnh báo; đơn đã hủy/hoàn là trạng thái kết thúc. */
export function orderStatusTone(status: string): string {
  if (status === 'PENDING_PAYMENT') return 'bg-warning-bg text-warning-fg';
  if (status === 'CANCELLED' || status === 'RETURNED') return 'bg-stone-100 text-stone-700';
  return 'bg-forest-50 text-forest-800';
}

const METHOD_LABEL: Record<string, string> = {
  COD: 'Thanh toán khi nhận hàng (COD)',
  BANK_TRANSFER: 'Chuyển khoản ngân hàng',
  ZALOPAY: 'ZaloPay',
  VNPAY: 'VNPay',
  WALLET: 'Ví Tubu',
  XU: 'Điểm Xanh (xu cũ)',
};
export const paymentMethodLabel = (method: string): string => METHOD_LABEL[method] ?? method;

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  UNPAID: 'Chưa thanh toán',
  PAID: 'Đã thanh toán',
  REFUNDED: 'Đã hoàn tiền',
  FAILED: 'Thanh toán thất bại',
};
export const paymentStatusLabel = (status: string | undefined): string =>
  status ? (PAYMENT_STATUS_LABEL[status] ?? status) : '';

export const orderDetailHref = (code: string): string => `/tai-khoan/don-hang/${encodeURIComponent(code)}`;

/**
 * Khớp điều kiện của miniapp (`canPayNow`) và của API: GET /payments/bank-qr từ chối đơn đã hủy/trả,
 * nên khung QR chỉ dựng cho đơn còn chờ thanh toán.
 */
export const canPayAgain = (o: { status: string; paymentMethod: string }): boolean =>
  o.status === 'PENDING_PAYMENT' && o.paymentMethod === 'BANK_TRANSFER';

export function addressLine(
  a: { street?: string | null; ward?: string | null; district?: string | null; province?: string | null } | null | undefined,
): string {
  if (!a) return '';
  return [a.street, a.ward, a.district, a.province].filter(Boolean).join(', ');
}

/** Link tra cứu vận đơn do đối tác vận chuyển trả về: chỉ mở http(s), không bao giờ `javascript:`/`data:`. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 5 bước hành trình chuẩn của đơn; Đã hủy/Đã hoàn là trạng thái kết thúc nên không nằm trên đường này. */
export const TIMELINE_STEPS = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] as const;

/** Vị trí trên hành trình chuẩn; -1 khi trạng thái nằm ngoài (Đã hủy/Đã hoàn). */
export const timelineIndex = (status: string): number => (TIMELINE_STEPS as readonly string[]).indexOf(status);

/** Đơn đã kết thúc thì mới có "Mua lại" — cùng điều kiện với Mini App. */
export const isReorderable = (status: string): boolean => status === 'DELIVERED' || status === 'CANCELLED' || status === 'RETURNED';

/**
 * Khách có tự hủy được không — khớp OrdersService.assertCustomerCancellable ở BE (BE vẫn là nơi quyết định, đây chỉ để
 * không bày nút chắc chắn bị từ chối): chỉ Chờ thanh toán/Đã xác nhận; đơn CTV lên hộ khách đã trả tiền chỉ admin hủy;
 * đơn thu gom tái chế mà bưu tá đã lấy hàng thì không hủy được nữa.
 */
export function canCancelOrder(
  o: {
    status: string;
    paymentStatus?: string | null;
    placedForCustomer?: boolean | null;
    referrerUserId?: string | null;
    hasRecyclingPickup?: boolean | null;
    gomdonStatus?: string | null;
  },
  userId: string | null | undefined,
): boolean {
  if (o.status !== 'PENDING_PAYMENT' && o.status !== 'CONFIRMED') return false;
  if (o.placedForCustomer && o.paymentStatus === 'PAID' && !!userId && o.referrerUserId === userId) return false;
  if (o.hasRecyclingPickup && isGomdonPickedUp(o.gomdonStatus)) return false;
  return true;
}
