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
 * Độ dài tối đa slug sản phẩm (và danh mục) ở mọi nơi nhận slug: chiến dịch (linkValue), chat hỗ trợ (productSlug), bài cộng đồng (productSlugs).
 * Slug sản phẩm đối tác là tên (≤ 200 ký tự) + `-` + mã thời gian (≤ 9) + 6 ký tự ngẫu nhiên, slug Pancake bị cắt về đúng trần này khi sinh,
 * slug danh mục là tên (≤ 60) + hậu tố trùng: 240 chứa trọn mọi slug do hệ thống sinh.
 */
export const PRODUCT_SLUG_MAX = 240;

/**
 * Danh sách slug cách nhau bằng dấu phẩy (`GET /products?slugs=`, dải "Đã xem gần đây"): tối đa PRODUCT_SLUGS_LIST_MAX slug, chuỗi nối tối đa
 * 20 × (240 + 1) = 4820 ký tự. Dòng yêu cầu 4820 ký tự cộng đường dẫn và tham số khác vẫn dưới giới hạn header mặc định của Caddy (proxy thật, `Caddyfile`
 * ở gốc repo, Go mặc định khoảng 1 MB) và 16 KB của Node; slug chỉ gồm chữ, số, "-", "_" nên không phình thêm khi mã hoá URL, dấu phẩy thành %2C chỉ thêm 38 ký tự.
 */
export const PRODUCT_SLUGS_LIST_MAX = 20;
export const PRODUCT_SLUGS_QUERY_MAX_CHARS = PRODUCT_SLUGS_LIST_MAX * (PRODUCT_SLUG_MAX + 1);

/** Slug sản phẩm/danh mục gắn vào chiến dịch dùng chung trần với mọi slug sản phẩm. */
export const CAMPAIGN_ENTITY_SLUG_MAX = PRODUCT_SLUG_MAX;
export const CAMPAIGN_ENTITY_SLUG_RE = new RegExp(`^[A-Za-z0-9][A-Za-z0-9_-]{0,${CAMPAIGN_ENTITY_SLUG_MAX - 1}}$`);
