import { fillTemplate } from '../copy-template';
import { fillCopy } from '../shop-copy';

/**
 * Hộp Xanh ở máy khách (giỏ, thanh toán, trang ghép hộp): chỉ ĐỌC số máy chủ trả rồi dựng chữ; máy khách không tự tính khoản giảm. API cũ hoặc cờ
 * `commerce.green_box_enabled` tắt thì không có trường nào, mọi hàm ở đây trả null/0 và giao diện giữ nguyên như trước.
 */
export interface GreenBoxTier {
  minItems: number;
  pct: number;
}

export interface GreenBoxState {
  /** Số sản phẩm khác nhau đang được đếm. */
  items: number;
  tier: GreenBoxTier | null;
  next: GreenBoxTier | null;
  tiers: GreenBoxTier[];
  /** Khoản giảm (đồng), nằm TRONG `comboDiscount` của giỏ/báo giá. */
  discount: number;
}

const nat = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

function readTier(v: unknown): GreenBoxTier | null {
  if (!v || typeof v !== 'object') return null;
  const { minItems, pct } = v as Record<string, unknown>;
  const n = nat(minItems);
  return n !== null && n > 0 && typeof pct === 'number' && Number.isFinite(pct) && pct > 0 ? { minItems: n, pct } : null;
}

/** Đọc `greenBox` của giỏ (THUẦN, phòng thủ): thiếu, sai dạng hoặc không có bậc nào thì null. */
export function readGreenBox(src: unknown): GreenBoxState | null {
  const raw = src && typeof src === 'object' ? (src as { greenBox?: unknown }).greenBox : undefined;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const tiers = Array.isArray(o.tiers) ? o.tiers.map(readTier).filter((t): t is GreenBoxTier => t !== null) : [];
  const items = nat(o.items);
  if (tiers.length === 0 || items === null) return null;
  return { items, tier: readTier(o.tier), next: readTier(o.next), tiers, discount: nat(o.discount) ?? 0 };
}

/** Phần Hộp Xanh trong `comboDiscount` (giỏ hoặc báo giá), kẹp trong [0, comboDiscount]: số cũ đang chờ máy chủ tính lại không làm dòng combo âm. */
export function greenBoxDiscountOf(src: { comboDiscount?: number | null; greenBoxDiscount?: unknown } | null | undefined): number {
  const gb = nat(src?.greenBoxDiscount) ?? 0;
  return Math.min(gb, Math.max(0, nat(src?.comboDiscount) ?? 0));
}

/** Dòng "Giảm giá combo" khi Hộp Xanh có dòng riêng: phần combo thật còn lại. */
export function comboOnlyDiscount(src: { comboDiscount?: number | null; greenBoxDiscount?: unknown } | null | undefined): number {
  return Math.max(0, (nat(src?.comboDiscount) ?? 0) - greenBoxDiscountOf(src));
}

export interface GreenBoxProgressView {
  text: string;
  /** 0–100 theo số món so với bậc cao nhất; chỉ 100 khi đã ở bậc cao nhất. */
  pct: number;
  /** Đã ở bậc cao nhất: một dòng xác nhận, không còn thanh. */
  done: boolean;
  /** "Mốc 3 · 5 · 7 món", cũng là nhãn của thanh tiến độ. */
  marksText: string;
}

/** Dải tiến độ Hộp Xanh ở đầu giỏ (chỉ hiện khi đã đạt Miễn phí giao hàng, thay cho dải đó). */
export function greenBoxProgress(state: GreenBoxState | null): GreenBoxProgressView | null {
  if (!state || state.tiers.length === 0) return null;
  const top = state.tiers[state.tiers.length - 1]!;
  const done = state.tier !== null && state.next === null;
  const base = { done, marksText: fillCopy('greenBox.marks', { marks: state.tiers.map((t) => t.minItems).join(' · ') }) };
  if (done) return { ...base, text: fillCopy('greenBox.progressTop', { pct: state.tier!.pct }), pct: 100 };
  const next = state.next ?? top;
  const n = Math.max(1, next.minItems - state.items);
  const text = state.tier
    ? fillCopy('greenBox.progressNext', { pct: state.tier.pct, n, next: next.pct })
    : fillCopy('greenBox.progressStart', { n, pct: next.pct });
  return { ...base, text, pct: Math.min(99, Math.floor((state.items / top.minItems) * 100)) };
}

/** Dòng chữ nhỏ dưới tổng tiền khi CHƯA đạt Miễn phí giao hàng: "Thêm {n} món nữa giảm {pct}% Hộp Xanh"; đã ở bậc cao nhất thì null. */
export function greenBoxCartHint(state: GreenBoxState | null): string | null {
  if (!state?.next) return null;
  return fillCopy('greenBox.cartHint', { n: Math.max(1, state.next.minItems - state.items), pct: state.next.pct });
}

/** Một dải tiến độ tại một thời điểm: chưa đạt Miễn phí giao hàng thì dải đó, đạt rồi và có Hộp Xanh thì dải Hộp Xanh. */
export function cartProgressStrip(freeshipReached: boolean, state: GreenBoxState | null): 'freeship' | 'greenBox' {
  return freeshipReached && state ? 'greenBox' : 'freeship';
}

/**
 * Chữ chỉ có ở web: trang ghép hộp `/hop-xanh`, nút "Ghép thêm" của dải giỏ và dòng gợi ý giao định kỳ (Mini không có hai phần này, xem `gaps` của
 * route-map). Tách khỏi
 * `SHOP_COPY` (nằm trong gói đầu Mini) để không tốn ngân sách gói Mini; `green-box.spec.ts` chạy thuật ngữ cấm, bộ chặn tuyên bố và
 * `GREEN_BOX_WEB_COPY_MAX` trên từng khoá.
 */
export const GREEN_BOX_WEB_COPY = {
  cta: 'Ghép thêm',
  ctaAria: 'Ghép thêm món vào Hộp Xanh',
  pageTitle: 'Hộp Xanh tự chọn',
  pageIntro: 'Ghép nhiều món khác nhau vào giỏ: {tiers}.',
  tierPart: 'từ {n} món giảm {pct}%',
  pageRule: 'Mỗi phân loại được giảm cho tối đa 2 sản phẩm. Món đang Giờ vàng hoặc đang trong combo không tính.',
  pageClosed: 'Hộp Xanh chưa mở. Bạn quay lại sau nhé.',
  pageEmpty: 'Chưa có món nào ghép được lúc này.',
  otherGroup: 'Món khác',
  barSelected: 'Đã chọn {n} món · giảm {pct}%',
  barSelectedNone: 'Đã chọn {n} món',
  viewCart: 'Xem giỏ',
  suggestLine: 'Bạn thường mua {name} khoảng {n} tuần một lần. Đặt giao định kỳ, giảm {pct}%',
} as const;

export type GreenBoxWebCopyKey = keyof typeof GREEN_BOX_WEB_COPY;

/** Số ký tự tối đa khi điền giá trị xấu nhất; null = câu dài. Chỉ spec đọc. */
export const GREEN_BOX_WEB_COPY_MAX: Record<GreenBoxWebCopyKey, number | null> = {
  cta: 9,
  ctaAria: 30,
  pageTitle: 18,
  pageIntro: null,
  tierPart: 22,
  pageRule: null,
  pageClosed: 42,
  pageEmpty: 40,
  otherGroup: 10,
  barSelected: 30,
  barSelectedNone: 20,
  viewCart: 8,
  suggestLine: null,
};

export function greenBoxWebCopy(key: GreenBoxWebCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(GREEN_BOX_WEB_COPY[key], vars, key);
}

/** Thanh đáy trang ghép hộp: "Đã chọn {n} món · giảm {pct}%" (chưa đạt bậc thì bỏ phần giảm). */
export function greenBoxBarText(state: GreenBoxState | null): string {
  const n = state?.items ?? 0;
  return state?.tier ? greenBoxWebCopy('barSelected', { n, pct: state.tier.pct }) : greenBoxWebCopy('barSelectedNone', { n });
}

/** Câu mở đầu trang ghép hộp từ bảng bậc của máy chủ: "Ghép nhiều món khác nhau vào giỏ: từ 3 món giảm 3%, từ 5 món giảm 5%…". */
export function greenBoxPageIntro(tiers: readonly GreenBoxTier[]): string {
  return greenBoxWebCopy('pageIntro', { tiers: tiers.map((t) => greenBoxWebCopy('tierPart', { n: t.minItems, pct: t.pct })).join(', ') });
}

/** Bậc vừa tăng giữa hai lần đọc giỏ (để gửi `green_box_tier_reached` đúng một lần); không tăng thì null. */
export function greenBoxTierRise(prevMinItems: number | null, nextMinItems: number): number | null {
  return prevMinItems !== null && nextMinItems > prevMinItems ? nextMinItems : null;
}

/** Gợi ý giao định kỳ do `GET /me/subscriptions/suggestions` trả. */
export interface SubscriptionSuggestion {
  variationId: string;
  productName: string;
  variationName: string;
  slug: string | null;
  thumbnail: string | null;
  unitPrice: number;
  intervalWeeks: number;
  lastDeliveredAt: string;
}

/** Đọc danh sách gợi ý (phòng thủ): cờ tắt, API cũ hay dữ liệu hỏng đều về mảng rỗng. */
export function readSubscriptionSuggestions(src: unknown): SubscriptionSuggestion[] {
  const o = src && typeof src === 'object' ? (src as { enabled?: unknown; items?: unknown }) : null;
  if (!o || o.enabled !== true || !Array.isArray(o.items)) return [];
  return o.items.filter(
    (i): i is SubscriptionSuggestion =>
      !!i && typeof i === 'object' && typeof (i as SubscriptionSuggestion).variationId === 'string' && typeof (i as SubscriptionSuggestion).productName === 'string' && [4, 6, 8, 10].includes((i as SubscriptionSuggestion).intervalWeeks),
  );
}

/** Gợi ý đầu tiên trùng một phân loại đang xem (sheet Mua lại), hoặc gợi ý đầu tiên khi không giới hạn. */
export function pickSubscriptionSuggestion(list: readonly SubscriptionSuggestion[], variationIds?: readonly string[]): SubscriptionSuggestion | null {
  if (!variationIds) return list[0] ?? null;
  return list.find((s) => variationIds.includes(s.variationId)) ?? null;
}

/** "Bạn thường mua {tên} khoảng {n} tuần một lần. Đặt giao định kỳ, giảm {pct}%"; `discountFraction` là `subscribeDiscountPct` của cấu hình công khai (0..1). */
export function subscriptionSuggestionText(s: SubscriptionSuggestion, discountFraction: number): string {
  const pct = Math.round((Number.isFinite(discountFraction) ? discountFraction : 0) * 100);
  return greenBoxWebCopy('suggestLine', { name: s.productName, n: s.intervalWeeks, pct });
}
