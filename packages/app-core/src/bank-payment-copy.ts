/** Câu hướng dẫn trả bằng mã QR khi mã nằm ngay trên máy của khách (điện thoại không tự quét được mã của chính mình). */
export const BANK_QR_HINT = 'Lưu mã QR rồi mở app ngân hàng, chọn quét từ ảnh. Hoặc chép số tài khoản bên dưới.';

/** Câu hạn chuyển khoản trước khi quá hạn, ghép: LEAD + ngày giờ (in đậm) + TAIL. Không hứa hoàn tiền ở đây. */
export const BANK_DEADLINE_LEAD = 'Chuyển khoản trước';
export const BANK_DEADLINE_TAIL = '— quá hạn đơn sẽ tự huỷ.';

/** Thay chỗ ảnh QR khi ảnh không tải được (mạng yếu, dịch vụ VietQR chậm): khách vẫn chuyển khoản được bằng số tài khoản hiển thị bên dưới. */
export const BANK_QR_LOAD_FAILED = 'Chưa tải được mã QR. Bạn chép số tài khoản bên dưới để chuyển khoản nhé.';

export const BANK_QR_SAVED = 'Đã lưu ảnh QR vào máy.';
export const BANK_QR_SAVE_FAILED = 'Chưa lưu được. Bạn nhấn giữ vào ảnh QR để lưu, hoặc chụp màn hình nhé.';

/**
 * Đổi đơn chuyển khoản chưa trả sang trả tiền khi nhận (COD): nút phụ ở trang mã QR và chi tiết đơn (Mini App, web, trang theo dõi của khách
 * vãng lai), luôn qua một tấm xác nhận. Câu xác nhận nhắc khách đã chuyển rồi thì không đổi, để không trả hai lần.
 */
export const COD_SWITCH_CTA = 'Đổi sang trả tiền khi nhận (COD)';
export const COD_SWITCH_CONFIRM_TITLE = 'Đổi sang trả tiền khi nhận?';
export const codSwitchConfirmBody = (total: string) =>
  `Bạn trả ${total} cho shipper khi nhận hàng. Đã chuyển khoản rồi thì đừng đổi: Tubu tự xác nhận khi tiền về.`;
export const COD_SWITCH_CONFIRM = 'Đổi sang COD';
export const COD_SWITCH_KEEP = 'Giữ chuyển khoản';
export const COD_SWITCH_DONE = 'Đã đổi sang trả tiền khi nhận. Đơn đã được xác nhận.';
