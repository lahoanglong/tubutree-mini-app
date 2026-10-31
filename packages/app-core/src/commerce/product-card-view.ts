import type { ProductCard } from '../api/catalog';
import { cardPricing, type FlashPriceItem } from '../flash-price';
import { isNewProduct } from '../product-badges';
import { fillCopy } from '../shop-copy';
import { cardMetaLine } from './card-meta';
import { vnd } from './money';

export type CardVariant = 'grid' | 'rail-sm' | 'rail-md' | 'flash' | 'rank' | 'line';
export type CardBadgeKind = 'flash' | 'discount' | 'combo' | 'featured' | 'loved' | 'new' | 'freeship';
export interface CardBadge {
  kind: CardBadgeKind;
  text: string;
  /** Chữ cho trình đọc màn hình ("Giờ vàng giảm 25%"), vì "-25%" bị đọc thành "gạch ngang 25%". */
  spoken: string;
}

export interface ProductCardInput {
  /** Thẻ từ API; `fulfiller` và `isLoved` do P3a thêm vào dữ liệu. */
  product: ProductCard;
  flash?: FlashPriceItem | null;
  variant: CardVariant;
  now: number;
  rank?: number;
  inCombo?: boolean;
  /** Mặc định true; trang thương hiệu truyền false. */
  showBrand?: boolean;
  /** Ngưỡng miễn phí giao của khách; null hoặc thiếu = không gắn nhãn. */
  freeShipThreshold?: number | null;
  /** `catalog.launch_date` (YYYY-MM-DD giờ Việt Nam): hàng tạo trước ngày này không gắn "Mới", như `ProductTile` hiện nay. Thiếu → luật 30 ngày. */
  launchDate?: string | null;
}

export interface ProductCardView {
  id: string;
  slug: string;
  name: string;
  brandLine: string | null;
  price: number;
  compareAt: number | null;
  discountPct: number;
  isFlash: boolean;
  isDeal: boolean;
  /** Khe A trên ảnh: Giờ vàng -x% hoặc -x%, tối đa một. */
  imageBadge: CardBadge | null;
  /** Một nhãn đứng đầu dòng tên: combo > Tubu chọn > Được yêu thích > Mới > Miễn phí giao hàng. */
  label: CardBadge | null;
  meta: string | null;
  stock: 'in' | 'out';
  stockText: string | null;
  rank: number | null;
  spoken: { price: string; stock: string | null; badges: string | null };
}

// Khe nhãn theo biến thể (design-system B2–B3): thẻ hẹp không đủ chỗ cho nhãn, thẻ Giờ vàng chỉ mang nhãn Giờ vàng,
// thẻ hạng để tile vẽ ruy-băng hạng nên không thêm nhãn đầu tên, dòng 56px không có nhãn.
const SLOTS: Record<CardVariant, { image: 'any' | 'flash' | false; label: boolean; brand: boolean }> = {
  grid: { image: 'any', label: true, brand: true },
  'rail-md': { image: 'any', label: true, brand: true },
  'rail-sm': { image: false, label: false, brand: false },
  flash: { image: 'flash', label: false, brand: false },
  rank: { image: 'any', label: false, brand: false },
  line: { image: false, label: false, brand: false },
};

const plain = (kind: CardBadgeKind, key: string): CardBadge => {
  const text = fillCopy(key);
  return { kind, text, spoken: text };
};

function imageBadgeOf(variant: CardVariant, isFlash: boolean, pct: number): CardBadge | null {
  const slot = SLOTS[variant].image;
  if (slot === false || pct <= 0) return null;
  if (isFlash) {
    // Thẻ Giờ vàng 128px nằm trong khối đã có tiêu đề "Giờ vàng", nên chỉ "-x%" kèm biểu tượng.
    const text = variant === 'flash' ? fillCopy('badge.discount', { pct }) : fillCopy('flash.badge', { pct });
    return { kind: 'flash', text, spoken: fillCopy('badge.flashSpoken', { pct }) };
  }
  if (slot === 'flash') return null;
  return { kind: 'discount', text: fillCopy('badge.discount', { pct }), spoken: fillCopy('badge.discountSpoken', { pct }) };
}

function labelOf(input: ProductCardInput, price: number): CardBadge | null {
  if (!SLOTS[input.variant].label) return null;
  const p = input.product;
  if (input.inCombo) return plain('combo', 'combo.tileTag');
  if (p.isFeatured) return plain('featured', 'badge.featured');
  if (p.isLoved) return plain('loved', 'badge.loved');
  if (isNewProduct(p.createdAt, input.now, input.launchDate)) return plain('new', 'badge.new');
  // Chỉ nói "Miễn phí giao hàng" khi biết chắc riêng món này được miễn: Tubu giao và giá đạt ngưỡng. Chưa biết thì im, không đoán.
  if (p.fulfiller?.kind === 'TUBU' && input.freeShipThreshold != null && price >= input.freeShipThreshold) return plain('freeship', 'badge.freeship');
  return null;
}

/**
 * Một nơi quyết định giá, nhãn, dòng meta và chữ đọc của thẻ sản phẩm; Mini App và web chỉ vẽ `ProductCardView`.
 * Giá đi qua `cardPricing` (cùng luật với trang chi tiết và giỏ): Giờ vàng chỉ thắng khi còn hạn theo `now` và rẻ hơn giá bán.
 * Hết hàng ẩn mọi nhãn (giữ hạng và giá).
 */
export function productCardView(input: ProductCardInput): ProductCardView {
  const { product: p, variant } = input;
  const pricing = cardPricing(p, input.flash ? [input.flash] : [], input.now);
  const inStock = p.inStock !== false;
  const imageBadge = inStock ? imageBadgeOf(variant, pricing.isFlash, pricing.salePct) : null;
  const label = inStock ? labelOf(input, pricing.price) : null;
  const stockText = inStock ? null : fillCopy('stock.out');
  const priceNow = fillCopy(pricing.isFlash ? 'price.flashSpoken' : 'price.spoken', { price: vnd(pricing.price) });
  const badges = [imageBadge, label].filter((b): b is CardBadge => b !== null).map((b) => b.spoken);

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brandLine: SLOTS[variant].brand && input.showBrand !== false ? p.brand : null,
    price: pricing.price,
    compareAt: pricing.compareAt,
    discountPct: pricing.salePct,
    isFlash: pricing.isFlash,
    isDeal: pricing.isFlash || pricing.salePct > 0,
    imageBadge,
    label,
    meta: cardMetaLine(p),
    stock: inStock ? 'in' : 'out',
    stockText,
    rank: input.rank ?? null,
    spoken: {
      price: pricing.compareAt ? priceNow + fillCopy('price.compareSpoken', { price: vnd(pricing.compareAt) }) : priceNow,
      stock: stockText,
      badges: badges.length > 0 ? badges.join(', ') : null,
    },
  };
}
