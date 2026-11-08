import type { ProductCard } from '../api/catalog';
import { cardPricing, type FlashPriceItem } from '../flash-price';
import { serverNow } from '../server-clock';
import { fillCopy } from '../shop-copy';

/**
 * Dải lọc nhanh của trang Sản phẩm yêu thích (Mini App và web cùng gọi `wishlistFilterView`): số trên chip, danh sách sau lọc và
 * lời báo khi lọc ra rỗng không được lệch giữa hai nền tảng.
 *
 * "Đang giảm" là món mà thẻ đang vẽ giá giảm: giá khuyến mãi của chính sản phẩm HOẶC suất Giờ vàng đang chạy thắng trên thẻ. Cùng một hàm với thẻ
 * (`cardPricing`: giá gạch, hết hạn theo `endAt`, suất rẻ hơn giá đang bán, phân loại CTV ghim), nên một thẻ gạch giá thì luôn nằm trong "Đang giảm" và
 * ngược lại; giá khuyến mãi hỏng hoặc không thấp hơn giá gốc không được đếm. Nơi gọi truyền danh sách Giờ vàng và mốc giờ MÀ THẺ ĐANG DÙNG (cùng khoá
 * `flash-sales/active`, cùng đồng hồ), không truyền thì chỉ xét giá khuyến mãi.
 * "Còn hàng" là `inStock !== false`: API cũ chưa trả cờ thì coi là còn, cùng luật với nút giỏ nhanh.
 */

export type WishlistFilterKey = 'all' | 'sale' | 'inStock';

export type WishlistFilterItem = Pick<ProductCard, 'slug' | 'basePrice' | 'salePrice' | 'inStock' | 'repVariationId' | 'pinnedVariationId'>;

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

export function isOnSale(
  p: Pick<ProductCard, 'slug' | 'basePrice' | 'salePrice' | 'repVariationId' | 'pinnedVariationId'>,
  allFlash: readonly FlashPriceItem[] = [],
  now: number = serverNow(),
): boolean {
  const pricing = cardPricing(p, allFlash, now);
  // `isFlash` riêng: suất Giờ vàng thắng mà giá 0 không gạch được thì thẻ vẫn mang nhãn Giờ vàng.
  return pricing.isFlash || pricing.compareAt !== null;
}

export function isInStock(p: Pick<ProductCard, 'inStock'>): boolean {
  return p.inStock !== false;
}

export function wishlistFilterView<T extends WishlistFilterItem>(
  items: readonly T[],
  active: WishlistFilterKey,
  allFlash: readonly FlashPriceItem[] = [],
  now: number = serverNow(),
): WishlistFilterView<T> {
  const match: Record<WishlistFilterKey, (p: WishlistFilterItem) => boolean> = {
    all: () => true,
    sale: (p) => isOnSale(p, allFlash, now),
    inStock: isInStock,
  };
  const shown = items.filter(match[active]);
  return {
    groupAria: fillCopy('wishlist.filter.groupAria'),
    chips: ORDER.map((key) => ({ key, label: fillCopy(`wishlist.filter.${key}`), count: items.filter(match[key]).length, selected: key === active })),
    items: shown,
    empty:
      items.length > 0 && shown.length === 0 && active !== 'all'
        ? { message: fillCopy(`wishlist.empty.${active}`), ctaLabel: fillCopy('wishlist.empty.cta') }
        : null,
  };
}
