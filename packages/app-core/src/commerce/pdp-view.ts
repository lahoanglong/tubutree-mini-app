import { applyShelfDedupe } from '../merch/shelves';
import type { DeliverySchedule, ShippingEta } from '../api/config';
import { fillCopy } from '../shop-copy';
import { checkoutEtaLabel, scheduleEtaLabel } from '../shipping-eta';
import { vnd } from './money';

/**
 * "Nhận dự kiến 20/11 – 24/11" ở khối vận chuyển của trang chi tiết (cờ `shipping.pdp_eta_enabled`); có lịch kho (`schedule`) thì
 * "Dự kiến nhận T6 20/11 – T3 24/11 · Đặt trước 15:00 giao sớm hơn". Gọi đúng `checkoutEtaLabel` của thanh toán với
 * cùng cấu hình nên hai nơi ra cùng khoảng ngày ở cùng thời điểm. Chỉ hàng kho Tubu giao còn hàng; hàng gian hàng tự giao, hết hàng hay không rõ nơi giao thì null.
 */
export function pdpEtaText(
  eta: ShippingEta | null | undefined,
  kind: string | null | undefined,
  inStock: boolean,
  now?: Date,
  schedule?: DeliverySchedule | null,
): string | null {
  if (!inStock || kind !== 'TUBU') return null;
  // Lịch kho: trang chi tiết chưa biết tỉnh của khách nên nói khoảng rộng nhất (scheduleEtaLabel), thanh toán thu hẹp theo địa chỉ.
  if (schedule) return fillCopy('pdp.etaSchedule', { range: scheduleEtaLabel(schedule, null, now), cutoff: schedule.cutoff });
  const range = checkoutEtaLabel(eta, [kind], now);
  return range ? fillCopy('pdp.eta', { range }) : null;
}

/** Dòng giỏ đủ để tính phần còn thiếu: giỏ máy chủ (`CartLine`) và giỏ khách của web cùng dạng này. */
export interface GapCartLine {
  variationId: string;
  total: number;
  stock: number;
  fulfiller?: { kind: string; name?: string } | null;
}

/**
 * Câu Miễn phí giao hàng ở trang chi tiết khi khách thêm món đang xem: giỏ hiện có cộng đúng phân loại và số lượng đang chọn, so với ngưỡng máy chủ đã tính
 * cho chính khách (`CartSummary.freeshipThreshold`, đã gồm hạng và đơn đầu) hay ngưỡng chung của khách chưa đăng nhập. Cùng luật với thanh tiến độ ở giỏ:
 * dòng hết hàng không cộng; hàng Tubu chỉ cộng phần Tubu giao; món của gian hàng tự giao (`store` = tên gian hàng) cộng phần của gian hàng đó và dùng
 * `freeShipFrom` của gian hàng. `serverFree` (mã miễn phí giao của máy chủ) chỉ tin khi giỏ toàn hàng Tubu còn hàng. `lineTotal`: tiền cả dòng của phân loại
 * này sau khi thêm (luật Giờ vàng của máy chủ), null khi không thêm được (hết hàng). null = không nói gì, app giữ câu tĩnh cũ.
 */
export function pdpFreeshipGap(p: {
  lines: readonly GapCartLine[] | null | undefined;
  threshold: number | null | undefined;
  serverFree?: boolean;
  variationId: string;
  lineTotal: number | null;
  store?: string | null;
}): string | null {
  const { lines, threshold } = p;
  if (!lines || typeof threshold !== 'number' || !(threshold > 0)) return null;
  const mine = (l: GapCartLine) => (p.store ? l.fulfiller?.kind === 'MERCHANT' && l.fulfiller.name === p.store : (l.fulfiller?.kind ?? 'TUBU') === 'TUBU');
  const group = lines.filter((l) => l.stock > 0 && mine(l));
  const before = group.reduce((s, l) => s + l.total, 0);
  if ((!p.store && p.serverFree && group.length === lines.length) || before >= threshold) return fillCopy('pdp.freeshipFree');
  if (p.lineTotal === null) return null;
  const after = before - group.filter((l) => l.variationId === p.variationId).reduce((s, l) => s + l.total, 0) + p.lineTotal;
  return after >= threshold ? fillCopy('pdp.freeshipReach') : fillCopy('pdp.freeshipGap', { amount: vnd(threshold - after) });
}

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
 * Số món lấy làm nguồn cho dải "Có thể bạn cũng thích". `GET /products/for-you` của API trả tối đa 10 món nên Mini chỉ bao giờ có
 * ngần ấy; khách web chưa đăng nhập (nguồn bán chạy) lấy cùng trần để hai app dài bằng nhau.
 */
export const PDP_FEED_SOURCE_LIMIT = 10;

/**
 * Ba dải cuối PDP không trùng nhau và không có món đang xem: "Khách thường mua cùng" (kệ `pdp.boughtTogether`) > "Cùng thương hiệu" >
 * "Có thể bạn cũng thích" (kệ `pdp.related`). Trần/sàn lấy từ `SHELVES`; dải dưới sàn thì ẩn và không chiếm món của dải dưới.
 */
export function pdpShelves<T extends { id: string }>(i: { currentId: string; boughtTogether: T[]; brand: T[]; feed: T[]; claimed?: ReadonlySet<string> }): {
  boughtTogether: T[];
  brand: T[];
  feed: T[];
} {
  // Dải phụ chỉ là gợi ý: API trả sai dạng (không phải mảng) thì dải đó rỗng, không được làm sập cả trang sản phẩm khi vẽ.
  // `claimed`: món đã nằm trong khối "Gợi ý mua kèm hợp vị" (`pickFbtPartners`) ngay trên các dải này, nên không lặp lại ở dải nào.
  const notCurrent = (list: unknown) => (Array.isArray(list) ? (list as T[]).filter((x) => x.id !== i.currentId && !i.claimed?.has(x.id)) : []);
  const [together] = applyShelfDedupe([{ id: 'pdp.boughtTogether', items: notCurrent(i.boughtTogether) }]);
  const togetherIds = new Set(together!.items.map((x) => x.id));
  const brand = notCurrent(i.brand)
    .filter((x) => !togetherIds.has(x.id))
    .slice(0, BRAND_RAIL_MAX);
  const taken = new Set([...togetherIds, ...brand.map((x) => x.id)]);
  const [feed] = applyShelfDedupe([{ id: 'pdp.related', items: notCurrent(i.feed).filter((x) => !taken.has(x.id)) }]);
  return { boughtTogether: together!.items, brand, feed: feed!.items };
}
