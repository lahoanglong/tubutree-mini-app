export interface CampaignInternalTarget {
  value: string;
  label: string;
  /** Route web tương ứng với route Mini `value`. */
  web: string;
}

/**
 * Đích nội bộ admin được chọn cho banner (route Mini). Danh sách đóng và là nguồn duy nhất: app-core chỉ dựng liên kết cho các đích này,
 * nên API cũng chỉ nhận đúng chúng (đích khác lưu được thì banner lặng lẽ biến mất ở app).
 */
export const CAMPAIGN_INTERNAL_TARGETS: readonly CampaignInternalTarget[] = [
  { value: '/offers', label: 'Ưu đãi', web: '/uu-dai' },
  { value: '/browse', label: 'Danh mục sản phẩm', web: '/san-pham' },
  { value: '/flash-sale', label: 'Giờ vàng', web: '/gio-vang' },
  { value: '/best-sellers', label: 'Bán chạy nhất', web: '/ban-chay' },
  { value: '/vouchers', label: 'Mã giảm giá', web: '/ma-giam-gia' },
  { value: '/group-buy', label: 'Mua chung', web: '/mua-chung' },
  { value: '/rewards', label: 'Đổi quà', web: '/kho-qua' },
];
