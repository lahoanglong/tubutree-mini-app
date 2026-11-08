import type { ProductCard } from '../api/catalog';
import { discountView } from '../flash-price';
import { fillCopy } from '../shop-copy';

/**
 * Dải lọc nhanh của trang Sản phẩm yêu thích (Mini App và web cùng gọi `wishlistFilterView`): số trên chip, danh sách sau lọc và
 * lời báo khi lọc ra rỗng không được lệch giữa hai nền tảng.
 *
 * "Đang giảm" là món có giá khuyến mãi của chính sản phẩm: `salePrice` hợp lệ và thấp hơn `basePrice`, qua `discountView` (cùng hàm thẻ dùng
 * để vẽ giá gạch), nên món giá khuyến mãi hỏng hoặc không thấp hơn giá gốc không được đếm. Giá Giờ vàng KHÔNG tính: thẻ tự đọc `flash-sales/active`
 * theo khung giờ còn trang Yêu thích không tải nó, nên một thẻ đang gạch giá vì Giờ vàng có thể không nằm trong "Đang giảm".
 * "Còn hàng" là `inStock !== false`: API cũ chưa trả cờ thì coi là còn, cùng luật với nút giỏ nhanh.
 */

export type WishlistFilterKey = 'all' | 'sale' | 'inStock';

export type WishlistFilterItem = Pick<ProductCard, 'basePrice' | 'salePrice' | 'inStock'>;

export interface WishlistFilterChip {
  key: WishlistFilterKey;
  label: string;
  count: number;
  selected: boolean;
}

export interface WishlistFilterEmpty {
  /** Câu báo lọc ra rỗng, đặt làm tiêu đề trạng thái rỗng. */
  message: string;
  ctaLabel: string;
}

export interface WishlistFilterView<T extends WishlistFilterItem> {
  groupAria: string;
  chips: WishlistFilterChip[];
  /** Danh sách sau lọc, giữ nguyên thứ tự gốc. */
  items: T[];
  /** Có khi danh sách gốc còn món nhưng bộ lọc đang chọn không khớp món nào; danh sách gốc rỗng thì null (trang có trạng thái rỗng riêng). */
  empty: WishlistFilterEmpty | null;
}

const ORDER: readonly WishlistFilterKey[] = ['all', 'sale', 'inStock'];

export function isOnSale(p: Pick<ProductCard, 'basePrice' | 'salePrice'>): boolean {
  return discountView(p.salePrice ?? 0, p.basePrice).compareAt !== null;
}

export function isInStock(p: Pick<ProductCard, 'inStock'>): boolean {
  return p.inStock !== false;
}

const MATCH: Record<WishlistFilterKey, (p: WishlistFilterItem) => boolean> = {
  all: () => true,
  sale: isOnSale,
  inStock: isInStock,
};

export function wishlistFilterView<T extends WishlistFilterItem>(items: readonly T[], active: WishlistFilterKey): WishlistFilterView<T> {
  const shown = items.filter(MATCH[active]);
  return {
    groupAria: fillCopy('wishlist.filter.groupAria'),
    chips: ORDER.map((key) => ({ key, label: fillCopy(`wishlist.filter.${key}`), count: items.filter(MATCH[key]).length, selected: key === active })),
    items: shown,
    empty:
      items.length > 0 && shown.length === 0 && active !== 'all'
        ? { message: fillCopy(`wishlist.empty.${active}`), ctaLabel: fillCopy('wishlist.empty.cta') }
        : null,
  };
}
