/**
 * Thẻ "Mua lại" cho hàng tiêu hao (w36-01, w55-01): nước rửa chén, nước rửa rau và mọi chai đã ghép cặp Refill, khách nhận đúng chu kỳ của nhóm hàng đó.
 * Hàm thuần và hằng; file không nhập service nào để service, admin-config-rules và spec dùng chung.
 */
import { foldVietnamese } from '../catalog/search-text';
import { vnDateKey } from '../../common/vn-time';
import { REFILL_REMINDER_DAYS, REFILL_REMINDER_ENABLED_KEY } from '../notifications/refill-reminder.rules';

export const REPURCHASE_DUE_CARD_ENABLED_KEY = 'retention.repurchase_due_card_enabled';

/**
 * Thẻ hiện khi MỘT trong hai cờ bật: cờ riêng của thẻ, hay cờ nhắc Refill 21 ngày (w55-01: bật chương trình nhắc thì lời nhắc trong app cũng hiện, kể cả
 * khi tin chủ động tắt). Cờ ZNS `retention.refill_21d_zns_enabled` KHÔNG nằm ở đây và không bao giờ do thẻ bật: thẻ không gửi tin nào.
 */
export const REPURCHASE_DUE_GATE_KEYS = [REPURCHASE_DUE_CARD_ENABLED_KEY, REFILL_REMINDER_ENABLED_KEY] as const;

/** Khoảng ngày lịch VN từ lúc nhận tới lúc nên mời mua lại (gồm cả hai đầu). */
export interface RefillCadence {
  minDays: number;
  maxDays: number;
}

/**
 * Chu kỳ mặc định cho chai đã ghép cặp Refill nhưng chưa có chu kỳ riêng: từ mốc nhắc 21 ngày (`REFILL_REMINDER_DAYS`) tới 30 ngày. Cặp Refill là
 * siêu dữ liệu sẵn có (thẻ admin Cặp Refill) nói chai nào dùng hết rồi đổ lại được, nên không cần danh sách từ khoá cho nhóm hàng mới.
 */
export const DEFAULT_REFILL_CADENCE: RefillCadence = { minDays: REFILL_REMINDER_DAYS, maxDays: 30 };

/**
 * Danh mục không có trường nhóm hàng hay chu kỳ dùng, nên nhận diện hàng tiêu hao theo tên đã bỏ dấu. Chỉ nhóm dùng hết trong khoảng
 * một tháng; thêm từ khoá ở đây khi mở rộng.
 */
export const CONSUMABLE_KEYWORDS: readonly string[] = ['rua chen', 'rua bat', 'ngam rua', 'rua rau', 'rua thuc pham'];

/**
 * Chu kỳ riêng theo nhóm hàng, khớp theo từ khoá trên tên đã bỏ dấu; nhóm đầu khớp thắng và thắng cả chu kỳ mặc định. Muốn đổi chu kỳ một nhóm thì sửa
 * (hay thêm) một dòng ở đây. Nước rửa chén/rau giữ 25–40 ngày đã duyệt ở w36-01.
 */
export const CATEGORY_CADENCES: readonly (RefillCadence & { id: string; keywords: readonly string[] })[] = [
  { id: 'dish_veg_wash', keywords: CONSUMABLE_KEYWORDS, minDays: 25, maxDays: 40 },
];

/** Hợp các chu kỳ: cửa sổ thô cho truy vấn (mỗi dòng lọc lại theo chu kỳ riêng của nó). */
export const REPURCHASE_DUE_MIN_DAYS = Math.min(DEFAULT_REFILL_CADENCE.minDays, ...CATEGORY_CADENCES.map((c) => c.minDays));
export const REPURCHASE_DUE_MAX_DAYS = Math.max(DEFAULT_REFILL_CADENCE.maxDays, ...CATEGORY_CADENCES.map((c) => c.maxDays));

const DAY_MS = 864e5;

export function isConsumableName(name: string): boolean {
  const folded = foldVietnamese(name);
  return CONSUMABLE_KEYWORDS.some((k) => folded.includes(k));
}

/**
 * Chu kỳ của một sản phẩm: chu kỳ nhóm hàng nếu tên khớp từ khoá, không thì mặc định khi chai có cặp Refill, không thì null (không phải hàng tiêu hao
 * mà thẻ mời mua lại).
 */
export function cadenceFor(productName: string, hasRefillPair: boolean): RefillCadence | null {
  const folded = foldVietnamese(productName);
  const category = CATEGORY_CADENCES.find((c) => c.keywords.some((k) => folded.includes(k)));
  if (category) return { minDays: category.minDays, maxDays: category.maxDays };
  return hasRefillPair ? DEFAULT_REFILL_CADENCE : null;
}

/** Số ngày lịch Việt Nam từ ngày nhận tới hôm nay (nhận 23:59 hôm qua là 1 ngày). */
export function vnDaysSince(from: Date, now: Date): number {
  const a = Date.parse(`${vnDateKey(from)}T00:00:00Z`);
  const b = Date.parse(`${vnDateKey(now)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/** Cửa sổ thô cho truy vấn đơn sàn đã quét: thừa một ngày ở đầu cũ, lọc đúng theo ngày lịch VN bằng `scanAnchorDays`. */
export function scanAnchorFrom(now: Date): Date {
  return new Date(now.getTime() - (DEFAULT_REFILL_CADENCE.maxDays + 1) * DAY_MS);
}

/**
 * Mốc theo đơn sàn đã quét (w55-01): số ngày lịch VN từ lúc đơn sàn GẦN NHẤT giao xong, khi nằm trong chu kỳ mặc định; đơn sàn mới hơn chu kỳ (khách vừa
 * mua) hay cũ hơn thì null. Đơn sàn không có dòng sản phẩm (payload chỉ giữ số lượng và giá) nên mốc này chỉ nói "tới lúc nhắc", không nói món nào.
 * Mốc giao ở tương lai bị bỏ.
 */
export function scanAnchorDays(deliveredAts: readonly (Date | null | undefined)[], now: Date): number | null {
  let latest: Date | null = null;
  for (const d of deliveredAts) {
    if (!d || d.getTime() > now.getTime()) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  if (!latest) return null;
  const days = vnDaysSince(latest, now);
  return days >= DEFAULT_REFILL_CADENCE.minDays && days <= DEFAULT_REFILL_CADENCE.maxDays ? days : null;
}

/**
 * Đơn sàn đã quét giao SAU đơn trực tiếp và còn mới hơn nhịp mặc định (dưới 21 ngày lịch VN) là chu kỳ mới của khách: món của đơn trực tiếp cũ chưa tới hạn.
 * Đơn sàn giao sau mà đã tới nhịp thì không chặn: món cụ thể của đơn trực tiếp vẫn hợp hơn lời nhắc chung. Mốc giao ở tương lai bị bỏ.
 */
export function newerScanResetsCycle(scanDeliveredAt: Date | null | undefined, itemDeliveredAt: Date, now: Date): boolean {
  if (!scanDeliveredAt || scanDeliveredAt.getTime() > now.getTime()) return false;
  if (scanDeliveredAt.getTime() <= itemDeliveredAt.getTime()) return false;
  return vnDaysSince(scanDeliveredAt, now) < DEFAULT_REFILL_CADENCE.minDays;
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
 * Dòng đủ điều kiện, xếp từ lâu nhất: trong chu kỳ của nhóm hàng (`cadenceFor`: 25–40 ngày lịch VN cho nước rửa chén/rau, 21–30 ngày cho chai có cặp Refill)
 * kể từ ngày nhận, hàng tiêu hao của Tubu, chưa trả hết, và khách chưa đặt lại sản phẩm đó (hay gói Refill của nó) ở đơn sau, chưa có gói định kỳ cho nó.
 * Mỗi sản phẩm một dòng (đơn nhận lâu nhất).
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
    const refillId = input.pairs.get(line.productId);
    const cadence = cadenceFor(line.productName, refillId !== undefined);
    if (!cadence) continue;
    const days = vnDaysSince(line.deliveredAt, input.now);
    if (days < cadence.minDays || days > cadence.maxDays) continue;
    if (line.partnerOwned || line.quantity - line.returnedQty <= 0) continue;
    const related = refillId ? [line.productId, refillId] : [line.productId];
    if (related.some((id) => input.subscribedProductIds.has(id))) continue;
    if (related.some((id) => (input.reorderedAt.get(id)?.getTime() ?? 0) > line.orderCreatedAt.getTime())) continue;
    if (seen.has(line.productId)) continue;
    seen.add(line.productId);
    picks.push({ line, days });
  }
  return picks.sort((a, b) => b.days - a.days || a.line.orderId.localeCompare(b.line.orderId));
}
