import { formatVnd } from './format-vnd';

/** Chữ của trang Danh mục / Tìm kiếm, giữ y như `vi.browse` của Mini App. */

const numberFormat = new Intl.NumberFormat('vi-VN');
const formatNumber = (n: number) => numberFormat.format(n);

/** 50000 → "50k", 1500000 → "1,5tr"; số lẻ không tròn nghìn thì in đủ để không nói sai con số (như formatVndShort của Mini App). */
export function formatVndShort(amount: number): string {
  const v = Number.isFinite(amount) ? amount : 0;
  if (v <= 0) return '0đ';
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v >= 1_000_000 && v % 100_000 === 0) return `${trim(v / 1_000_000)}tr`;
  if (v >= 1_000 && v % 1_000 === 0) return `${Math.round(v / 1_000)}k`;
  return formatVnd(v);
}

export const browseText = {
  title: 'Danh mục',
  categoryChips: 'Đổi danh mục',
  searchPlaceholder: 'Tìm sản phẩm...',
  searchLabel: 'Tìm sản phẩm',
  clearSearch: 'Xoá từ khoá',
  cancel: 'Huỷ',
  retry: 'Thử lại',
  noResultHeading: (q: string) => `Không tìm thấy "${q}"`,
  noResultBody: 'Thử từ khoá khác hoặc bỏ bớt bộ lọc',
  noResultFiltered: 'Chưa có sản phẩm khớp bộ lọc',
  clearAll: 'Xoá tìm kiếm & bộ lọc',
  loadMoreFailed: 'Không tải thêm được sản phẩm',
  emptyHeading: 'Chưa có sản phẩm',
  emptyBody: 'Tubu đang chuẩn bị thêm sản phẩm mới',
  loadMore: 'Xem thêm',
  categories: 'Danh mục',
  sidebar: { all: 'Tất cả sản phẩm' },
  recentlyViewed: 'Đã xem gần đây',
  segments: {
    mom_baby: 'Cho mẹ & bé',
    home_clean: 'Nhà bếp xanh',
    skincare: 'Chăm sóc cá nhân',
    eco: 'Sống xanh',
  },
  sortGroup: 'Sắp xếp',
  sort: {
    suggested: 'Gợi ý',
    best_seller: 'Bán chạy',
    newest: 'Mới nhất',
    price_asc: 'Giá tăng',
    price_desc: 'Giá giảm',
  },
  resultCount: (n: number) => `${formatNumber(n)} sản phẩm`,
  filterButton: 'Bộ lọc',
  filterButtonCount: (n: number) => `Bộ lọc (${n})`,
  activeFilters: 'Đang lọc',
  removeFilter: (label: string) => `Bỏ lọc ${label}`,
  filtersIgnored: 'Bộ lọc nâng cao chưa dùng được lúc này — đang hiện mọi kết quả.',
  inStockChip: 'Còn hàng',
  rating4Chip: 'Từ 4★',
  price: {
    under: (max: string) => `Dưới ${max}`,
    between: (min: string, max: string) => `${min}–${max}`,
    from: (min: string) => `Từ ${min}`,
  },
  filter: {
    title: 'Bộ lọc',
    price: 'Khoảng giá',
    availability: 'Tình trạng',
    inStock: 'Chỉ hiện còn hàng',
    brand: 'Thương hiệu',
    rating: 'Đánh giá',
    rating4: 'Từ 4★ trở lên',
    reset: 'Xoá bộ lọc',
    apply: (n: number) => `Xem ${formatNumber(n)} sản phẩm`,
    applyLoading: 'Xem kết quả',
    applyFallback: 'Áp dụng',
  },
  suggest: {
    title: 'Gợi ý tìm kiếm',
    recent: 'Tìm gần đây',
    clearRecent: 'Xoá lịch sử tìm',
    categories: 'Danh mục',
    products: 'Sản phẩm',
    searchFor: (q: string) => `Tìm “${q}”`,
    none: 'Chưa có gợi ý. Chạm dòng “Tìm” ở trên hoặc nhấn Enter để xem kết quả.',
    failed: 'Không tải được gợi ý',
  },
} as const;
