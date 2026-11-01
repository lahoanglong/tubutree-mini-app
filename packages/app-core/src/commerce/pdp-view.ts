import { applyShelfDedupe } from '../merch/shelves';

/** Dòng giỏ có giá gạch (`listUnitPrice`, luật `strikePrice`) cao hơn giá bán mới gạch giá; API cũ chưa trả `listUnitPrice` thì không gạch. */
export function lineCompareAt(l: { unitPrice: number; listUnitPrice?: number | null }): number | null {
  return typeof l.listUnitPrice === 'number' && l.listUnitPrice > l.unitPrice ? l.listUnitPrice : null;
}

/** Tiền khách tiết kiệm được ở một dòng (chỉ để hiển thị; tiền thật do API tính). */
export function lineSaving(l: { unitPrice: number; listUnitPrice?: number | null; quantity: number }): number {
  const was = lineCompareAt(l);
  return was === null ? 0 : (was - l.unitPrice) * l.quantity;
}

/**
 * "Tiết kiệm" của giỏ: giá gạch của các dòng + giảm combo đang hiển thị (`comboDiscount`, cùng số với dòng "Giảm giá combo", nên giỏ chọn một phần
 * chưa có giá phần chọn thì truyền 0 chứ không mượn số của cả giỏ). Mã giảm giá và ưu đãi hạng không cộng: mỗi cái đã có dòng riêng ngay trên.
 * Chỉ để hiển thị; số tiền khách trả do API tính.
 */
export function cartSaving(
  items: readonly { unitPrice: number; listUnitPrice?: number | null; quantity: number }[],
  comboDiscount = 0,
): number {
  const combo = Number.isFinite(comboDiscount) && comboDiscount > 0 ? comboDiscount : 0;
  return items.reduce((sum, l) => sum + lineSaving(l), 0) + combo;
}

interface QuickReviewInput {
  rating: number;
  comment: string | null;
  images: string[];
  videoUrl: string | null;
  createdAt: string;
}

/** "Đánh giá nhanh" ở PDP: chỉ đánh giá có chữ; có ảnh/video trước (bằng chứng thật nhất), rồi mới nhất. */
export function pickQuickReviews<T extends QuickReviewInput>(items: readonly T[], n = 2): T[] {
  const hasMedia = (r: T) => r.images.length > 0 || Boolean(r.videoUrl);
  const time = (r: T) => {
    const t = Date.parse(r.createdAt);
    return Number.isNaN(t) ? 0 : t;
  };
  return items
    .filter((r) => (r.comment ?? '').trim() !== '')
    .sort((a, b) => Number(hasMedia(b)) - Number(hasMedia(a)) || time(b) - time(a))
    .slice(0, n);
}

const BRAND_RAIL_MAX = 8;

/**
 * Ba dải cuối PDP không trùng nhau và không có món đang xem: "Khách thường mua cùng" (kệ `pdp.boughtTogether`) > "Cùng nhà" >
 * "Có thể bạn cũng thích" (kệ `pdp.related`). Trần/sàn lấy từ `SHELVES`; dải dưới sàn thì ẩn và không chiếm món của dải dưới.
 */
export function pdpShelves<T extends { id: string }>(i: { currentId: string; boughtTogether: T[]; brand: T[]; feed: T[] }): {
  boughtTogether: T[];
  brand: T[];
  feed: T[];
} {
  // Dải phụ chỉ là gợi ý: API trả sai dạng (không phải mảng) thì dải đó rỗng, không được làm sập cả trang sản phẩm khi vẽ.
  const notCurrent = (list: unknown) => (Array.isArray(list) ? (list as T[]).filter((x) => x.id !== i.currentId) : []);
  const [together] = applyShelfDedupe([{ id: 'pdp.boughtTogether', items: notCurrent(i.boughtTogether) }]);
  const togetherIds = new Set(together!.items.map((x) => x.id));
  const brand = notCurrent(i.brand)
    .filter((x) => !togetherIds.has(x.id))
    .slice(0, BRAND_RAIL_MAX);
  const taken = new Set([...togetherIds, ...brand.map((x) => x.id)]);
  const [feed] = applyShelfDedupe([{ id: 'pdp.related', items: notCurrent(i.feed).filter((x) => !taken.has(x.id)) }]);
  return { boughtTogether: together!.items, brand, feed: feed!.items };
}
