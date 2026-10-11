const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Đã giao',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã hủy',
};

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
  XU: 'TubuXu',
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
