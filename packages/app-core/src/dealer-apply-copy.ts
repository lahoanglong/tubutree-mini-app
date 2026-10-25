/** Chữ màn đăng ký đại lý và thẻ gian hàng đối tác, dùng chung web và Mini App. */

export const DEALER_REQUIREMENTS: readonly string[] = [
  'Có cửa hàng hoặc doanh nghiệp đang kinh doanh',
  'Số điện thoại liên hệ dùng được (Tubu gọi hoặc nhắn Zalo)',
  'Ảnh CCCD hai mặt của người đại diện',
];

export const DEALER_BENEFITS: readonly string[] = [
  'Giá sỉ theo bậc đại lý',
  'Công nợ theo hạn mức',
  'Đặt hàng nhanh số lượng lớn',
];

export const DEALER_REQUIREMENTS_TITLE = 'Điều kiện đăng ký';
export const DEALER_BENEFITS_TITLE = 'Quyền lợi';

export function dealerReviewLine(hours: number | null | undefined): string {
  return hours ? `Tubu duyệt hồ sơ trong vòng ${hours} giờ và liên hệ lại qua Zalo.` : 'Tubu duyệt hồ sơ rồi liên hệ lại qua Zalo.';
}

export const PARTNER_STOREFRONT_TITLE = 'Gian hàng đối tác';
export const PARTNER_STOREFRONT_WEB_HINT =
  'Quản lý gian hàng đối tác (sản phẩm, đơn, đối soát) trên web Tubu Tree, mục Gian hàng đối tác. Đăng nhập cùng tài khoản Zalo.';
export const PARTNER_STOREFRONT_WEB_CTA = 'Mở trang quản lý';
