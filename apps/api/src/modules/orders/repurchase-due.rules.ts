/**
 * Thẻ "Mua lại" cho hàng tiêu hao (w36-01): nước rửa chén, nước rửa rau khách nhận 25–40 ngày trước. Hàm thuần và hằng; file không
 * nhập service nào để service, admin-config-rules và spec dùng chung.
 */
import { foldVietnamese } from '../catalog/search-text';
import { vnDateKey } from '../../common/vn-time';

export const REPURCHASE_DUE_CARD_ENABLED_KEY = 'retention.repurchase_due_card_enabled';

export const REPURCHASE_DUE_MIN_DAYS = 25;
export const REPURCHASE_DUE_MAX_DAYS = 40;

/**
 * Danh mục không có trường nhóm hàng hay chu kỳ dùng, nên nhận diện hàng tiêu hao theo tên đã bỏ dấu. Chỉ nhóm dùng hết trong khoảng
 * một tháng; thêm từ khoá ở đây khi mở rộng.
 */
export const CONSUMABLE_KEYWORDS: readonly string[] = ['rua chen', 'rua bat', 'ngam rua', 'rua rau', 'rua thuc pham'];

const DAY_MS = 864e5;

export function isConsumableName(name: string): boolean {
  const folded = foldVietnamese(name);
  return CONSUMABLE_KEYWORDS.some((k) => folded.includes(k));
}

/** Số ngày lịch Việt Nam từ ngày nhận tới hôm nay (nhận 23:59 hôm qua là 1 ngày). */
export function vnDaysSince(from: Date, now: Date): number {
  const a = Date.parse(`${vnDateKey(from)}T00:00:00Z`);
  const b = Date.parse(`${vnDateKey(now)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/** Cửa sổ thô cho truy vấn (thừa một ngày mỗi đầu); lọc đúng theo ngày lịch VN bằng `vnDaysSince`. */
export function repurchaseDueWindow(now: Date): { deliveredFrom: Date; deliveredTo: Date } {
  return {
    deliveredFrom: new Date(now.getTime() - (REPURCHASE_DUE_MAX_DAYS + 1) * DAY_MS),
    deliveredTo: new Date(now.getTime() - (REPURCHASE_DUE_MIN_DAYS - 1) * DAY_MS),
  };
}

export interface RepurchaseCandidateLine {
  orderId: string;
  orderCreatedAt: Date;
  deliveredAt: Date;
  variationId: string;
  productId: string;
  productName: string;
  quantity: number;
  /** Số đã trả (yêu cầu trả chưa bị từ chối). */
  returnedQty: number;
  /** Sản phẩm của gian hàng đối tác. */
  partnerOwned: boolean;
}

export interface RepurchaseDuePick {
  line: RepurchaseCandidateLine;
  days: number;
}

/**
 * Dòng đủ điều kiện, xếp từ lâu nhất: trong 25–40 ngày lịch VN kể từ ngày nhận, hàng tiêu hao của Tubu, chưa trả hết, và khách chưa đặt
 * lại sản phẩm đó (hay gói Refill của nó) ở đơn sau, chưa có gói định kỳ cho nó. Mỗi sản phẩm một dòng (đơn nhận lâu nhất).
 */
export function pickRepurchaseDue(input: {
  lines: readonly RepurchaseCandidateLine[];
  now: Date;
  /** id chai → id gói Refill. */
  pairs: ReadonlyMap<string, string>;
  /** Sản phẩm khách đã đặt lại (đơn chưa huỷ, tạo sau đơn của dòng): id sản phẩm → mốc tạo đơn mới nhất. */
  reorderedAt: ReadonlyMap<string, Date>;
  /** Sản phẩm có gói định kỳ đang chạy. */
  subscribedProductIds: ReadonlySet<string>;
}): RepurchaseDuePick[] {
  const seen = new Set<string>();
  const picks: RepurchaseDuePick[] = [];
  for (const line of input.lines) {
    const days = vnDaysSince(line.deliveredAt, input.now);
    if (days < REPURCHASE_DUE_MIN_DAYS || days > REPURCHASE_DUE_MAX_DAYS) continue;
    if (line.partnerOwned || line.quantity - line.returnedQty <= 0) continue;
    if (!isConsumableName(line.productName)) continue;
    const refillId = input.pairs.get(line.productId);
    const related = refillId ? [line.productId, refillId] : [line.productId];
    if (related.some((id) => input.subscribedProductIds.has(id))) continue;
    if (related.some((id) => (input.reorderedAt.get(id)?.getTime() ?? 0) > line.orderCreatedAt.getTime())) continue;
    if (seen.has(line.productId)) continue;
    seen.add(line.productId);
    picks.push({ line, days });
  }
  return picks.sort((a, b) => b.days - a.days || a.line.orderId.localeCompare(b.line.orderId));
}
