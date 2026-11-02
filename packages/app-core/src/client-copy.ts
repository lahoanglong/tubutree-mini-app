/**
 * Chữ khách đọc ở cả Mini App và web: viết một chỗ để hai app ra cùng một câu.
 * Giọng "bạn" và "Tubu"; câu lỗi nói chuyện gì xảy ra và khách làm gì tiếp.
 */

export const ERROR_GENERIC = 'Đã có lỗi xảy ra. Thử lại sau ít phút.';
export const ERROR_NETWORK = 'Mất kết nối. Kiểm tra mạng rồi thử lại.';
export const AVATAR_READ_FAILED = 'Không tải được ảnh. Thử lại sau ít phút.';
export const loadMoreFailed = (what: string): string => `Không tải thêm được ${what}. Thử lại sau ít phút.`;

export const BANK_NAME_REQUIRED = 'Nhập tên ngân hàng.';
export const ACCOUNT_NAME_REQUIRED = 'Nhập tên chủ tài khoản.';
export const BANK_TX_FAILED = 'Giao dịch không thành công hoặc đã được hoàn lại. Liên hệ Tubu để được hỗ trợ.';
export const bankCopyFailed = (label: string): string => `Không thể sao chép ${label}. Bạn chép thủ công nhé.`;

export const INVOICE_ISSUE_FAILED = 'Phát hành lỗi. Liên hệ Tubu để được hỗ trợ.';
export const returnWindowExpired = (days: number): string =>
  `Đã quá hạn đổi/trả (${days} ngày kể từ khi nhận hàng). Cần hỗ trợ thêm, liên hệ Tubu bên dưới.`;

export const DEALER_REJECTED_RESUBMIT = 'Hồ sơ trước bị từ chối. Kiểm tra lại thông tin rồi nộp lại.';
export const DEALER_PRICE_LOADING = 'Đang tải bảng giá, đợi chút rồi dán đơn…';

/** Câu báo dòng hết hàng/vượt tồn ở màn thanh toán. */
export function overStockMessage(productName: string, stock: number): string {
  return stock > 0
    ? `Sản phẩm "${productName}" hiện còn ${stock} sản phẩm. Sửa số lượng trong giỏ để tiếp tục.`
    : `Sản phẩm "${productName}" đã hết hàng. Bỏ khỏi giỏ để đặt các món còn lại.`;
}

export const STOREFRONT_TEMPLATE_HINT = 'Chọn danh mục gần với sản phẩm bạn muốn giới thiệu. Tubu tự thêm sẵn 8 sản phẩm nổi bật, bạn chỉnh sửa sau cũng được.';
export const STOREFRONT_TEMPLATE_BUSY = 'Đang dựng…';

export const ABOUT_MISSION =
  'Tubu Tree tin rằng mỗi lựa chọn tiêu dùng nhỏ đều là một hạt mầm cho thiên nhiên, và kết nối bạn với những thương hiệu Việt tử tế — minh bạch nguồn gốc, lành cho da, nhẹ với đất.';
export const CASHBACK_REDIRECT = 'Đã ghi nhận hoàn tiền! Đang chuyển hướng sang sàn…';

export const BRAND_OWNER_TITLE = 'Quản lý thương hiệu';
export const BRAND_BADGE = 'Thương hiệu trên Tubu Tree';
