import type { AdminCustomerRefund, AdminCustomerRefundStatus } from './admin-client';
import { ApiError } from './client-api';

/** Tiền tố khoá query của mọi truy vấn hoàn tiền khách (danh sách, số đếm), để invalidate một lần sau khi ghi. */
export const CUSTOMER_REFUNDS_QUERY_KEY = 'admin-customer-refunds';

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

export interface MarkPaidFailure {
  /** true = khoản đã đổi trạng thái (admin khác vừa xử lý): đóng hộp và tải lại; false = giữ hộp để thử lại. */
  stale: boolean;
  message: string;
}

const NETWORK_MESSAGE =
  'Không kết nối được máy chủ. Kiểm tra mạng rồi bấm "Đã chuyển khoản" để thử lại; nếu khoản đã được ghi nhận, danh sách sẽ tự cập nhật.';

/**
 * BE trả 400 duy nhất cho "không còn chờ chuyển khoản" (updateMany count=0) nên 400 = đã bị xử lý, hiện nguyên câu của
 * API rồi tải lại. Lỗi khác giữ nguyên hộp: lời nhắn 401/403/5xx của Nest là tiếng Anh nên thay bằng câu tiếng Việt, và
 * 5xx/mạng nói rõ chưa chắc đã ghi được để admin thử lại thay vì chuyển khoản lần hai.
 */
export function markPaidFailure(e: unknown): MarkPaidFailure {
  if (!(e instanceof ApiError)) return { stale: false, message: NETWORK_MESSAGE };
  if (e.status === 400) {
    return {
      stale: true,
      message: e.message || 'Khoản hoàn không còn chờ chuyển khoản hoặc vừa được xử lý — danh sách đã được tải lại.',
    };
  }
  if (e.status === 401 || e.status === 403) {
    return { stale: false, message: 'Phiên đăng nhập đã hết hạn hoặc bạn không có quyền ghi nhận khoản này. Đăng nhập lại bằng tài khoản quản trị rồi thử lại.' };
  }
  if (e.status === 429) return { stale: false, message: 'Thao tác quá nhanh. Đợi vài giây rồi bấm "Đã chuyển khoản" lại.' };
  if (e.status >= 500) {
    return {
      stale: false,
      message: 'Máy chủ đang gặp lỗi nên chưa rõ khoản này đã được ghi nhận chưa. Bấm "Đã chuyển khoản" để thử lại; nếu đã ghi nhận, danh sách sẽ tự cập nhật.',
    };
  }
  return { stale: false, message: e.message || 'Không ghi nhận được. Vui lòng thử lại.' };
}
