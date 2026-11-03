/**
 * Câu lỗi form nhận tiền hoàn và lý do đổi/trả mà khách đọc. Tách khỏi `refund-destination.ts` và `order-returns.service.ts` để bộ quét chữ cấm
 * (`terminology.spec.ts`, đuôi `*-notice.ts`) tự quét và để app-core ghim câu của client (`client-copy.ts`) bằng đúng câu này.
 */
export const REFUND_BANK_NAME_REQUIRED = 'Nhập tên ngân hàng nhận tiền hoàn.';
export const REFUND_ACCOUNT_NUMBER_INVALID = 'Số tài khoản nhận tiền hoàn chỉ gồm chữ số, từ 6 đến 24 số.';
export const REFUND_ACCOUNT_NAME_REQUIRED = 'Nhập tên chủ tài khoản nhận tiền hoàn.';
export const RETURN_REASON_REQUIRED = 'Bạn mô tả lý do đổi/trả (ít nhất 5 ký tự) nhé.';
