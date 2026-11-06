/**
 * Chữ khách đọc ở cả Mini App và web: viết một chỗ để hai app ra cùng một câu.
 * Giọng "bạn" và "Tubu"; câu lỗi nói chuyện gì xảy ra và khách làm gì tiếp.
 */

export const ERROR_GENERIC = 'Đã có lỗi xảy ra. Bạn thử lại nhé.';
export const ERROR_NETWORK = 'Mất kết nối. Kiểm tra mạng rồi thử lại.';
export const AVATAR_READ_FAILED = 'Không tải được ảnh. Thử lại sau ít phút.';
export const loadMoreFailed = (what: string): string => `Không tải thêm được ${what}. Bạn thử lại nhé.`;

export const PRODUCT_NOT_FOUND = 'Không tìm thấy sản phẩm này.';

export const REQUIRED_FIELD = 'Bạn điền giúp Tubu mục này nhé';
export const BANK_NAME_REQUIRED = 'Nhập tên ngân hàng nhận tiền hoàn.';
export const ACCOUNT_NUMBER_INVALID = 'Số tài khoản nhận tiền hoàn chỉ gồm chữ số, từ 6 đến 24 số.';
export const ACCOUNT_NAME_REQUIRED = 'Nhập tên chủ tài khoản nhận tiền hoàn.';
export const RETURN_REASON_REQUIRED = 'Bạn mô tả lý do đổi/trả (ít nhất 5 ký tự) nhé.';
export const BANK_TX_FAILED = 'Giao dịch không thành công hoặc đã được hoàn lại. Liên hệ Tubu để được hỗ trợ.';
export const BANK_NOT_RECEIVED =
  'Chưa thấy tiền về. Ngân hàng thường xử lý trong 30 giây đến 1 phút sau khi chuyển. Bạn kiểm tra lại sau ít phút nhé.';
export const BANK_CHECK_NETWORK = 'Không kết nối được tới Tubu Tree. Bạn kiểm tra mạng rồi bấm lại nhé.';
export const bankCopyFailed = (label: string): string => `Không thể sao chép ${label}. Bạn chép thủ công nhé.`;

export const INVOICE_ISSUE_FAILED = 'Phát hành lỗi. Liên hệ Tubu để được hỗ trợ.';
export const returnWindowExpired = (days: number): string =>
  `Đã quá hạn đổi/trả (${days} ngày kể từ khi nhận hàng). Cần hỗ trợ thêm, liên hệ Tubu bên dưới.`;

export const DEALER_REJECTED_RESUBMIT = 'Hồ sơ trước bị từ chối. Kiểm tra lại thông tin rồi nộp lại.';
export const DEALER_PRICE_LOADING = 'Đang tải bảng giá, đợi chút rồi dán đơn…';

/** Câu báo dòng hết hàng/vượt tồn ở màn thanh toán. */
export function overStockMessage(productName: string, stock: number): string {
  if (!(stock > 0)) return `Sản phẩm "${productName}" đã hết hàng. Bỏ khỏi giỏ để đặt các món còn lại.`;
  // Tồn trên LOW_STOCK_NOTICE (20) không bao giờ ghi số (Smart Stock).
  return stock <= 20
    ? `Sản phẩm "${productName}" hiện còn ${stock} sản phẩm. Sửa số lượng trong giỏ để tiếp tục.`
    : `Số lượng sản phẩm "${productName}" vượt số hàng đang có. Sửa số lượng trong giỏ để tiếp tục.`;
}

export const STOREFRONT_TEMPLATE_HINT = 'Chọn danh mục gần với sản phẩm bạn muốn giới thiệu. Tubu tự thêm sẵn 8 sản phẩm nổi bật, bạn chỉnh sửa sau cũng được.';
export const STOREFRONT_TEMPLATE_BUSY = 'Đang dựng…';
export const STOREFRONT_PUBLIC_TITLE = 'Gian hàng';
export const STOREFRONT_NOT_FOUND = 'Gian hàng này không tồn tại hoặc đã ngừng hoạt động.';
export const NOT_FOUND_TITLE = 'Không tìm thấy';
export const GO_HOME_LABEL = 'Về trang chủ';
export const DEALER_PAY_AMOUNT_LABEL = 'Số tiền đã chuyển';

export const ABOUT_MISSION =
  'Tubu Tree tin rằng mỗi lựa chọn tiêu dùng nhỏ đều là một hạt mầm cho thiên nhiên. Tubu kết nối bạn với những thương hiệu Việt tử tế — minh bạch nguồn gốc, lành cho da, nhẹ với đất.';
export const CASHBACK_REDIRECT = 'Đã ghi nhận hoàn tiền! Đang chuyển hướng sang sàn…';

export const BRAND_OWNER_TITLE = 'Quản lý thương hiệu';
export const BRAND_BADGE = 'Thương hiệu trên Tubu Tree';
export const BRAND_OWNER_NONE = 'Bạn chưa được cấp quyền quản lý thương hiệu nào. Liên hệ Tubu để trở thành đối tác thương hiệu.';
export const BRAND_OWNER_INFO = 'Thông tin thương hiệu';
export const BRAND_OWNER_SAVED = 'Đã lưu thông tin thương hiệu';
export const BRAND_OWNER_VIEW_PAGE = 'Xem trang thương hiệu';
export const BRAND_OWNER_DRAFT = 'Thương hiệu đang là nháp — Tubu duyệt xong khách mới xem được.';
export const BRAND_OWNER_EDIT_HINT = 'Bạn sửa được thông tin & khuyến mãi. Tên thương hiệu, chứng nhận, đăng/ẩn do Tubu duyệt.';
export const BRAND_OWNER_NO_ORDERS = 'Khi khách đặt sản phẩm của thương hiệu, số liệu sẽ hiện ở đây.';
export const BRAND_OWNER_REVENUE_NOTE =
  'Doanh thu là giá bán sản phẩm của thương hiệu trong các đơn đã xác nhận (chưa trừ mã giảm giá của đơn, chưa gồm phí vận chuyển; không tính đơn chờ thanh toán, đã huỷ, đã trả hoặc đã hoàn tiền). Số liệu tổng hợp, không hiện thông tin khách.';
export const BRAND_OWNER_COUPON_HINT =
  'Có mã thì khách chạm để sao chép ngay trên trang thương hiệu. Mã giảm giá phải do Tubu tạo sẵn, công khai và còn hạn — mã không có trong hệ thống sẽ bị từ chối khi lưu. Để trống ô này khi sửa để gỡ mã.';
