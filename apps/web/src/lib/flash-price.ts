import { cardPricing as sharedCardPricing } from '@tubutree/app-core/flash-price';

/**
 * Giá Giờ vàng (flash sale) cho web shop, cùng quy tắc với giỏ hàng và đơn: giá Giờ vàng chỉ thắng khi RẺ HƠN giá đang bán
 * (salePrice ?? giá gốc), nên khách không thấy giá nhảy giữa trang chủ/chi tiết và giỏ. Dữ liệu đợt đang chạy lấy ở trình duyệt
 * (GET /flash-sales/active, không cache) chứ không nằm trong HTML ISR 5 phút, vì đợt bắt đầu/kết thúc theo từng phút.
 */
export interface FlashItem {
  itemId: string;
  variationId: string;
  productSlug: string;
  flashPrice: number;
  retailPrice: number;
  salePrice?: number | null;
  soldCount: number;
  quota: number;
  endAt: string;
  /** Giờ máy chủ lúc dựng danh sách; thiếu thì dùng đồng hồ trình duyệt. */
  serverNow?: string;
}

export interface CardPricing {
  /** Giá khách thật sự trả cho một đơn vị (đã gồm Giờ vàng). */
  price: number;
  /** Giá gạch (xem `cardPricing` ở app-core): giá đang bán khi Giờ vàng thắng, ngược lại giá niêm yết; null = không gạch. */
  compareAt: number | null;
  /** Giá để gạch; chỉ có nghĩa khi `hasSale`. */
  originalPrice: number;
  hasSale: boolean;
  isFlash: boolean;
  salePct: number;
  flashVariationId?: string;
}

const pct = (price: number, original: number) => (original > 0 && price < original ? Math.round((1 - price / original) * 100) : 0);

/**
 * Giá thẻ sản phẩm (trang chủ, nhãn hàng, gian hàng): quy tắc DUY NHẤT dùng chung với Mini App (`@tubutree/app-core/flash-price`),
 * để cùng một sản phẩm không hiện hai giá gạch hay hai phần trăm giảm khác nhau giữa hai nền tảng.
 */
export function cardPricing(
  product: { slug: string; basePrice: number; salePrice?: number | null },
  flash: readonly FlashItem[],
): CardPricing {
  const r = sharedCardPricing(product, flash);
  return {
    price: r.price,
    compareAt: r.compareAt,
    originalPrice: r.compareAt ?? product.basePrice,
    hasSale: r.compareAt !== null,
    isFlash: r.isFlash,
    salePct: r.salePct,
    flashVariationId: r.flashVariationId,
  };
}

export interface VariationPricing {
  price: number;
  originalPrice: number;
  hasSale: boolean;
  isFlash: boolean;
  salePct: number;
  /** Hạn đợt Giờ vàng đang áp cho phân loại này (ISO); chỉ có khi `isFlash`. */
  endAt?: string;
}

/** Giá một phân loại ở trang chi tiết: đợt Giờ vàng gắn đúng phân loại đó, nếu rẻ hơn giá đang bán. */
export function variationPricing(
  v: { id: string; retailPrice: number; salePrice?: number | null },
  flash: readonly FlashItem[],
): VariationPricing {
  const item = flash.find((f) => f.variationId === v.id);
  const standing = v.salePrice ?? v.retailPrice;
  const isFlash = !!item && item.flashPrice < standing;
  const price = isFlash ? item!.flashPrice : standing;
  const hasSale = price < v.retailPrice;
  return {
    price,
    originalPrice: v.retailPrice,
    hasSale,
    isFlash,
    salePct: hasSale ? pct(price, v.retailPrice) : 0,
    ...(isFlash ? { endAt: item!.endAt } : {}),
  };
}
