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

/**
 * Độ dài tối đa slug sản phẩm/danh mục gắn vào chiến dịch (cột linkValue). Slug sản phẩm đối tác là tên (≤ 200 ký tự) + `-` + mã thời gian
 * (≤ 9 ký tự), slug Pancake là tên + `-` + 6 ký tự, slug danh mục là tên (≤ 60) + hậu tố trùng: 240 chứa trọn mọi slug sinh từ tên trong trần DTO.
 * API (regex, @MaxLength của DTO), app-core (campaignHref) và ô nhập ở admin đều đọc hằng này, không viết số tay.
 */
export const CAMPAIGN_ENTITY_SLUG_MAX = 240;
export const CAMPAIGN_ENTITY_SLUG_RE = new RegExp(`^[A-Za-z0-9][A-Za-z0-9_-]{0,${CAMPAIGN_ENTITY_SLUG_MAX - 1}}$`);
