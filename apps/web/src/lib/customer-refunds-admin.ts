import type { AdminCustomerRefund, AdminCustomerRefundKind, AdminCustomerRefundStatus } from './admin-client';
import { ApiError } from './client-api';

/** Tiền tố khoá query của mọi truy vấn hoàn tiền khách (danh sách, số đếm), để invalidate một lần sau khi ghi. */
export const CUSTOMER_REFUNDS_QUERY_KEY = 'admin-customer-refunds';

export const CUSTOMER_REFUND_FILTERS: { status: AdminCustomerRefundStatus; label: string }[] = [
  { status: 'PENDING', label: 'Chờ chuyển khoản' },
  { status: 'PROCESSING', label: 'Đang chuyển khoản' },
  { status: 'COMPLETED', label: 'Đã chuyển' },
];

export const CUSTOMER_REFUND_EMPTY: Record<AdminCustomerRefundStatus, string> = {
  PENDING: 'Không có khoản hoàn nào đang chờ chuyển khoản.',
  PROCESSING: 'Không có khoản hoàn nào đang được chuyển khoản.',
  COMPLETED: 'Chưa có khoản hoàn nào đã xử lý.',
};

/** Bộ lọc loại khoản; chuỗi rỗng = mọi loại. */
export const CUSTOMER_REFUND_KINDS: { kind: AdminCustomerRefundKind | ''; label: string }[] = [
  { kind: '', label: 'Tất cả loại' },
  { kind: 'CANCEL', label: 'Huỷ đơn' },
  { kind: 'RETURN', label: 'Trả hàng' },
  { kind: 'LATE_PAYMENT', label: 'Tiền về muộn' },
  { kind: 'OVERPAYMENT', label: 'Tiền trả dư' },
  { kind: 'END_CUSTOMER', label: 'Đơn CTV lên hộ' },
];

export const refundKindLabel = (kind: AdminCustomerRefundKind) => CUSTOMER_REFUND_KINDS.find((k) => k.kind === kind)?.label ?? kind;

/** Khoản của khách có tài khoản phải chuyển về tài khoản ngân hàng; khoản khách cuối đơn CTV chuyển theo SĐT. */
export const needsBankAccount = (r: Pick<AdminCustomerRefund, 'kind'>) => r.kind !== 'END_CUSTOMER';

const REASON_LABEL: Record<string, string> = {
  CANCELLED: 'Đơn bị huỷ',
  RETURNED: 'Đơn trả hàng',
};

/** BE lưu `reason` là chuỗi tự do (trạng thái đơn); giá trị chưa biết hiện nguyên văn để admin vẫn đối chiếu được. */
export const refundReasonLabel = (reason: string) => REASON_LABEL[reason] ?? reason;

/**
 * Khoản của khách có tài khoản: khách tự đổi được nơi nhận (sang Ví Tubu) tới khi admin bấm "Bắt đầu chuyển khoản".
 * Admin phải khoá trước khi chuyển tiền, rồi mới xác nhận "Đã chuyển khoản" (CustomerRefundsService.claim/markPaid).
 * Khoản khách cuối đơn CTV (không có tài khoản) không ai đổi được nên xác nhận thẳng.
 */
export const needsClaim = (r: Pick<AdminCustomerRefund, 'userId'>) => r.userId !== null;

/** Lý do tiếp quản tối thiểu — khớp CustomerRefundsService.claimGuard. */
export const TAKE_OVER_REASON_MIN = 5;

/**
 * Khoản đang chuyển khoản do admin KHÁC giữ (R3-MONEY-4): chỉ người đó được xác nhận/trả về hàng chờ, người xem phải
 * tiếp quản kèm lý do. null khi không phải (chưa ai giữ, chính mình giữ, hoặc không biết mình là ai — API vẫn chặn).
 */
export function takeOverFrom(
  r: Pick<AdminCustomerRefund, 'status' | 'claimedBy' | 'claimedByName' | 'claimedAt'>,
  meId: string | undefined,
): { holder: string; since: string | null } | null {
  if (r.status !== 'PROCESSING' || !r.claimedBy || !meId || r.claimedBy === meId) return null;
  return { holder: r.claimedByName || 'một quản trị viên khác', since: r.claimedAt ?? null };
}

/** "bởi bạn" / "bởi Admin An" sau "Bắt đầu chuyển lúc …"; rỗng khi không biết ai. */
export function claimHolderSuffix(r: Pick<AdminCustomerRefund, 'claimedBy' | 'claimedByName'>, meId: string | undefined): string {
  if (!r.claimedBy) return '';
  if (meId && r.claimedBy === meId) return ' bởi bạn';
  return r.claimedByName ? ` bởi ${r.claimedByName}` : '';
}

/**
 * WALLET chỉ là dòng vết (tiền đã vào ví khách lúc huỷ/trả) nên không có thao tác; chỉ MANUAL_TRANSFER cần
 * admin chuyển khoản tay, khớp điều kiện của CustomerRefundsService.markPaid.
 */
export type CustomerRefundView = 'WALLET' | 'PENDING' | 'PROCESSING' | 'COMPLETED';
export const customerRefundView = (r: Pick<AdminCustomerRefund, 'method' | 'status'>): CustomerRefundView =>
  r.method === 'WALLET' ? 'WALLET' : r.status;

export interface MarkPaidFailure {
  /** true = khoản đã đổi trạng thái (admin khác vừa xử lý): đóng hộp và tải lại; false = giữ hộp để thử lại. */
  stale: boolean;
  message: string;
}

/** Câu dặn đi kèm thông báo "đã bị xử lý": lần ghi trước có thể đã thành công (lỗi mạng giữa chừng) nên đừng chuyển khoản lần hai. */
export const CUSTOMER_REFUND_STALE_HINT =
  'Khoản này có thể đã được ghi nhận, kể cả từ lần bấm trước bị lỗi mạng. Mở bộ lọc "Đã chuyển" để kiểm tra trước khi chuyển khoản lại.';

/** Câu API khi khoản đã đổi trạng thái giữa chừng (khách vừa chọn Ví, admin khác vừa nhận/xác nhận). */
const STALE_PATTERN =
  /không còn chờ|vừa được xử lý|vừa thay đổi|về Ví Tubu|đã được xác nhận chuyển khoản|quản trị viên khác|không còn ở trạng thái|đang (?:được|do) .+ chuyển khoản/i;
/** Câu nghiệp vụ của API (không phải lỗi DTO) — hiện nguyên văn, giữ hộp để admin sửa. */
const BUSINESS_PATTERN = /chưa có tài khoản nhận|Bắt đầu chuyển khoản/i;

/** Nút người dùng bấm lại ở hộp đang mở: hộp "Bắt đầu chuyển khoản" hay hộp "Đã chuyển khoản". */
export type RefundAction = 'claim' | 'paid';
const ACTION_LABEL: Record<RefundAction, string> = { claim: 'Bắt đầu chuyển khoản', paid: 'Đã chuyển khoản' };

/**
 * BE trả 400 "không còn chờ chuyển khoản" khi updateMany count=0 (admin khác vừa xử lý, khách vừa chọn Ví): đóng hộp,
 * tải lại, hiện nguyên câu của API. 400 nghiệp vụ khác (chưa có tài khoản, chưa khoá) hiện nguyên câu và giữ hộp; 400
 * của ValidationPipe giữ hộp để không mất nội dung đã nhập. Lỗi khác cũng giữ hộp: lời nhắn 401/403/5xx của Nest là
 * tiếng Anh nên thay bằng câu tiếng Việt, và 5xx/mạng nói rõ chưa chắc đã ghi được để admin thử lại thay vì chuyển
 * khoản lần hai.
 */
export function markPaidFailure(e: unknown, action: RefundAction = 'paid'): MarkPaidFailure {
  const button = ACTION_LABEL[action];
  if (!(e instanceof ApiError)) {
    return {
      stale: false,
      message: `Không kết nối được máy chủ. Kiểm tra mạng rồi bấm "${button}" để thử lại; nếu khoản đã được ghi nhận, danh sách sẽ tự cập nhật.`,
    };
  }
  if (e.status === 400) {
    if (STALE_PATTERN.test(e.message)) return { stale: true, message: e.message };
    if (BUSINESS_PATTERN.test(e.message)) return { stale: false, message: e.message };
    return {
      stale: false,
      message:
        action === 'paid'
          ? 'Dữ liệu chưa hợp lệ nên chưa ghi nhận được. Kiểm tra mã giao dịch (tối đa 100 ký tự) và ghi chú (tối đa 500 ký tự) rồi bấm "Đã chuyển khoản" lại.'
          : 'Dữ liệu chưa hợp lệ nên chưa ghi nhận được. Kiểm tra tài khoản nhận rồi bấm "Bắt đầu chuyển khoản" lại.',
    };
  }
  if (e.status === 401 || e.status === 403) {
    return { stale: false, message: 'Phiên đăng nhập đã hết hạn hoặc bạn không có quyền ghi nhận khoản này. Đăng nhập lại bằng tài khoản quản trị rồi thử lại.' };
  }
  if (e.status === 429) return { stale: false, message: `Thao tác quá nhanh. Đợi vài giây rồi bấm "${button}" lại.` };
  if (e.status >= 500) {
    return {
      stale: false,
      message: `Máy chủ đang gặp lỗi nên chưa rõ khoản này đã được ghi nhận chưa. Bấm "${button}" để thử lại; nếu đã ghi nhận, danh sách sẽ tự cập nhật.`,
    };
  }
  return { stale: false, message: e.message || 'Không ghi nhận được. Vui lòng thử lại.' };
}
