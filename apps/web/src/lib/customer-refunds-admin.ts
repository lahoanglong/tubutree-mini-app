import type { AdminCustomerRefund, AdminCustomerRefundStatus } from './admin-client';

export const CUSTOMER_REFUND_FILTERS: { status: AdminCustomerRefundStatus; label: string }[] = [
  { status: 'PENDING', label: 'Chờ chuyển khoản' },
  { status: 'COMPLETED', label: 'Đã chuyển' },
];

export const CUSTOMER_REFUND_EMPTY: Record<AdminCustomerRefundStatus, string> = {
  PENDING: 'Không có khoản hoàn nào đang chờ chuyển khoản.',
  COMPLETED: 'Chưa có khoản hoàn nào đã xử lý.',
};

const REASON_LABEL: Record<string, string> = {
  CANCELLED: 'Đơn bị huỷ',
  RETURNED: 'Đơn trả hàng',
};

/** BE lưu `reason` là chuỗi tự do (trạng thái đơn); giá trị chưa biết hiện nguyên văn để admin vẫn đối chiếu được. */
export const refundReasonLabel = (reason: string) => REASON_LABEL[reason] ?? reason;

/**
 * WALLET chỉ là dòng vết (tiền đã vào ví khách lúc huỷ/trả) nên không có thao tác; chỉ MANUAL_TRANSFER cần
 * admin chuyển khoản tay, khớp điều kiện của CustomerRefundsService.markPaid.
 */
export type CustomerRefundView = 'WALLET' | 'PENDING' | 'COMPLETED';
export const customerRefundView = (r: Pick<AdminCustomerRefund, 'method' | 'status'>): CustomerRefundView =>
  r.method === 'WALLET' ? 'WALLET' : r.status;
