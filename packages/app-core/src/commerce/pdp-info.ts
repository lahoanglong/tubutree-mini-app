import type { ProductStoryConfig } from '@tubutree/shared-types';
import type { PurchasedItem } from '../api/orders';

/**
 * Thứ tự khối trang sản phẩm (Mini App và web cùng thứ tự; web máy tính đặt phần sau nút mua ở hàng dưới nhưng giữ đúng thứ tự này trong HTML).
 * Mỗi khối có `data-pdp-block` bằng khoá ở đây; Playwright đọc thứ tự xuất hiện và so với danh sách. Khối không có dữ liệu thì không vẽ.
 */
export const PDP_BLOCK_ORDER = [
  'gallery',
  'main', // nhãn, xuất xứ, tim, chia sẻ, tên, sao, giá, Điểm Xanh, tồn
  'variations', // chip phân loại + Số lượng
  'rebuy', // một dòng nhỏ "Bạn đã mua ngày dd/mm · Mua lại"
  'modes', // MỘT dải chọn cách mua (`pdpBuyModes`): Mua lẻ / Túi Refill / Định kỳ; chỉ chế độ đang chọn mới có một dòng chi tiết bên dưới
  'shipping', // Ưu đãi, Vận chuyển, lưu ý
  'benefits', // Điểm nổi bật (`pdpHighlights`): tối đa 3 dòng gộp Điểm cộng xanh, mô tả ngắn, chứng nhận
  // Ba khối sau nằm chung một dải "Chi tiết sản phẩm" (`data-pdp-group="details"`), mỗi khối là một dòng gập sẵn.
  'ingredients',
  'origin', // "Nguồn gốc & cách dùng": xuất xứ, cách dùng/bảo quản chủ hàng viết trong mô tả, hạn dùng/số lô (`pdpOriginView`)
  'description',
  'story', // chỉ khi sản phẩm có câu chuyện riêng được bật
  'addons', // MỘT khối mua kèm: combo thật > FBT > khách thường mua cùng
  'reviews',
  'compare',
  'promises', // dải niềm tin + chính sách + chat + mua chung + nội dung CTV
  'suggestions', // cùng thương hiệu, gợi ý
] as const;
export type PdpBlock = (typeof PDP_BLOCK_ORDER)[number];

/** Nguồn của khối mua kèm duy nhất: nguồn đầu tiên có dữ liệu theo thứ tự combo/mua kèm giá tốt thật → FBT → "khách thường mua cùng". */
export type PdpAddOnSource = 'bundles' | 'fbt' | 'bought' | null;

export function pdpAddOnSource(has: { bundles: boolean; fbt: boolean; bought: boolean }): PdpAddOnSource {
  if (has.bundles) return 'bundles';
  if (has.fbt) return 'fbt';
  if (has.bought) return 'bought';
  return null;
}

/**
 * Phần trăm Đặt định kỳ để in lên màn: đọc `config.subscribeDiscountPct` (phân số, 0.12 = 12%). Thiếu, sai kiểu, 0 hay từ 100% trở lên thì null và
 * màn không nêu số (không tự đặt sàn hay trần: số trên màn phải đúng số máy chủ tính).
 */
export function subscribePct(fraction: number | null | undefined): number | null {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return null;
  const pct = Math.round(fraction * 100);
  return pct > 0 ? pct : null;
}

/**
 * Sản phẩm đưa vào khối câu chuyện: khi câu chuyện không có ảnh tách nền riêng, khung ảnh của khối lấy ảnh đầu của sản phẩm, tức lặp đúng ảnh lớn
 * đầu thư viện ngay phía trên. Bỏ ảnh đầu để khối dùng ảnh kế tiếp (không còn ảnh nào thì khung để trống theo cách của khối).
 */
export function storyProductWithoutLead<P extends { images: string[]; thumbnail?: string | null }>(
  p: P,
  config: Pick<ProductStoryConfig, 'cutoutUrl'> | null | undefined,
): P {
  if (config?.cutoutUrl) return p;
  const rest = p.images.slice(1);
  return { ...p, images: rest, thumbnail: rest[0] ?? null };
}

export interface PdpRebuy {
  variationId: string;
  /** ISO của đơn đã giao gần nhất chứa phân loại này. */
  lastPurchasedAt: string;
  /** "dd/mm" theo giờ Việt Nam. */
  dateLabel: string;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** "dd/mm" theo giờ Việt Nam (UTC+7 quanh năm), không phụ thuộc múi giờ máy. */
export function vnDayMonth(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + VN_OFFSET_MS);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

type RebuyInput = Pick<PurchasedItem, 'productId' | 'variationId' | 'lastPurchasedAt' | 'inStock'>;

/**
 * Dòng "Bạn đã mua ngày dd/mm · Mua lại": lần mua (đơn DELIVERED) gần nhất của sản phẩm này theo `GET /me/purchased-items`. Một chạm thêm đúng
 * phân loại lần trước, nên phân loại đó phải còn trên trang và còn hàng; không thì không có dòng (không lặng lẽ thêm một phân loại khác).
 */
export function pdpRebuy(
  purchased: readonly RebuyInput[] | null | undefined,
  productId: string,
  variations: readonly { id: string; stock: number }[],
): PdpRebuy | null {
  let latest: RebuyInput | null = null;
  let latestT = -Infinity;
  for (const it of purchased ?? []) {
    if (it.productId !== productId) continue;
    const t = Date.parse(it.lastPurchasedAt);
    if (Number.isNaN(t) || t <= latestT) continue;
    latest = it;
    latestT = t;
  }
  if (!latest || latest.inStock === false) return null;
  const variationId = latest.variationId;
  const v = variations.find((x) => x.id === variationId);
  if (!v || v.stock <= 0) return null;
  const dateLabel = vnDayMonth(latest.lastPurchasedAt);
  return dateLabel ? { variationId: v.id, lastPurchasedAt: latest.lastPurchasedAt, dateLabel } : null;
}

/** Số món `GET /me/purchased-items` mà trang sản phẩm hỏi để tìm lần mua trước (trần của API). */
export const PDP_PURCHASED_LIMIT = 50;
