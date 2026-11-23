import type { GroupBuy } from './api/groupbuy';
import { shareDescription, type WelcomeOffer } from './commerce/share-offer';
import { cardPricing, type FlashPriceItem } from './flash-price';
import { fillCopy } from './shop-copy';

type PriceFields = Pick<GroupBuy, 'unitPrice' | 'basePrice'> & { product?: { slug: string }; variationId?: string };

/**
 * Mua chung không giảm thẳng giá: nhóm đủ người thì mỗi thành viên nhận một mã giảm, dùng ở giỏ hàng. Thẻ nhóm vì vậy ghi hai giá
 * cạnh nhau (giá nhóm và giá mua một mình), không gạch giá, để khách không đọc giá nhóm như giá đang bán.
 */
export function groupPriceLabels(
  g: PriceFields,
  formatVnd: (n: number) => string,
  flash?: readonly FlashPriceItem[],
  now?: number,
): { group: string; solo: string; soloIsCheaper: boolean } {
  const solo = soloPricing(g, flash, now);
  const soloIsCheaper = solo.price < g.unitPrice;
  const soloText = soloIsCheaper
    ? `${solo.isFlash ? 'Giờ vàng đang rẻ hơn' : 'Giá hiện nay rẻ hơn'}: ${formatVnd(solo.price)}`
    : `Mua một mình ${formatVnd(solo.price)}`;
  return { group: `Giá nhóm ${formatVnd(g.unitPrice)}`, solo: soloText, soloIsCheaper };
}

/**
 * Giá mua một mình hiện nay. `basePrice` của nhóm là giá lúc tạo nhóm (có thể đã cũ tới 48 giờ, trước một đợt Giờ vàng), nên khi trang
 * có danh sách Giờ vàng đang chạy thì tính lại bằng quy tắc giá thẻ (`cardPricing`), chỉ xét Giờ vàng của chính phân loại mà giá nhóm
 * dựa trên (`variationId`; API cũ không trả thì xét mọi phân loại của sản phẩm); chưa có danh sách hoặc không có suất nào thắng
 * thì giữ giá đã lưu. Khi kết quả thấp hơn giá nhóm, nhãn không còn là "Mua một mình" (xem `groupPriceLabels`).
 */
export function soloPricing(g: PriceFields, flash?: readonly FlashPriceItem[], now?: number): { price: number; isFlash: boolean } {
  if (!flash || !g.product) return { price: g.basePrice, isFlash: false };
  const c = cardPricing({ slug: g.product.slug, basePrice: g.basePrice, ...(g.variationId ? { pinnedVariationId: g.variationId } : {}) }, flash, now);
  return { price: c.price, isFlash: c.isFlash };
}

/** Điều khách nhận được khi nhóm đủ người: mã giảm cho đơn sau, không phải giảm ngay. Số người còn thiếu là ý riêng (`groupMissingLine`). */
export function groupRewardLine(g: Pick<GroupBuy, 'discountPct' | 'unitPrice' | 'minOrder'>, formatVnd: (n: number) => string): string {
  return `Đủ nhóm: mỗi người nhận mã giảm giá ${g.discountPct}% cho đơn từ ${formatVnd(g.minOrder ?? g.unitPrice)}`;
}

/** Số người còn thiếu để đủ nhóm, không âm. */
export function groupMissing(g: Pick<GroupBuy, 'targetSize' | 'currentSize'>): number {
  return Math.max(0, g.targetSize - g.currentSize);
}

/** Dòng "Còn thiếu N người"; null khi đã đủ người (không có gì để nói). */
export function groupMissingLine(g: Pick<GroupBuy, 'targetSize' | 'currentSize'>): string | null {
  const need = groupMissing(g);
  return need > 0 ? `Còn thiếu ${need} người` : null;
}

/** Chữ trạng thái của người đã ở trong nhóm đang mở; nút chính lúc đó là "Mời bạn bè" nên không còn nút "Nhóm của bạn" bị mờ. */
export function groupMemberStatus(g: Pick<GroupBuy, 'targetSize' | 'currentSize'>): string {
  const need = groupMissing(g);
  return need > 0 ? `Bạn đã ở trong nhóm · cần thêm ${need} người` : 'Bạn đã ở trong nhóm';
}

/** Dưới mốc này thẻ nhóm đổi chữ "còn N ngày" sang đồng hồ đếm ngược sống (`Countdown`). */
export const GROUP_LIVE_COUNTDOWN_MS = 24 * 60 * 60 * 1000;

export type GroupDeadline =
  /** Chữ tĩnh: "đã đủ nhóm", "đã hết hạn", "còn N ngày". */
  | { kind: 'text'; text: string; expired: boolean }
  /** Còn dưới 24 giờ: vẽ `Countdown` tới `endAt`; tới giờ thì `onEnd` vẽ lại thẻ và hàm này trả `expired`. */
  | { kind: 'live'; endAt: string };

/**
 * Hạn của thẻ nhóm tại `now` (giờ máy chủ). Nhóm quá hạn mà cron 15 phút chưa đóng vẫn là OPEN: coi như đã hết hạn để thẻ không cho bấm Tham
 * gia (máy chủ từ chối). Mốc hỏng (không đọc được) coi như đã hết hạn, không bao giờ hiện "NaN". Đúng mốc 24 giờ còn là chữ ngày ("còn 1 ngày").
 */
export function groupDeadline(g: Pick<GroupBuy, 'status' | 'expiresAt'>, now: number): GroupDeadline {
  if (g.status === 'SUCCESS') return { kind: 'text', text: fillCopy('groupBuy.done'), expired: false };
  const left = Date.parse(g.expiresAt) - now;
  if (g.status !== 'OPEN' || !(left > 0)) return { kind: 'text', text: fillCopy('groupBuy.expired'), expired: true };
  if (left < GROUP_LIVE_COUNTDOWN_MS) return { kind: 'live', endAt: g.expiresAt };
  return { kind: 'text', text: fillCopy('groupBuy.daysLeft', { d: Math.floor(left / GROUP_LIVE_COUNTDOWN_MS) }), expired: false };
}

/**
 * Tiền một người tiết kiệm khi mua theo giá nhóm so với giá mua một mình, 0 khi không tiết kiệm được (giá nhóm hỏng, hay giá hiện nay đã rẻ hơn
 * giá nhóm nhờ Giờ vàng: `soloPricing`). Không hứa số tiền mà giỏ hàng không trả.
 */
export function groupSaving(g: PriceFields, flash?: readonly FlashPriceItem[], now?: number): number {
  const solo = soloPricing(g, flash, now).price;
  const save = Math.min(g.basePrice, solo) - g.unitPrice;
  return Number.isFinite(save) && save > 0 ? Math.round(save) : 0;
}

/**
 * Dòng suất còn lại ở trang mời /mua-chung/:id: "Còn 2 suất · Tiết kiệm 15.000đ" (bỏ vế tiết kiệm khi không tiết kiệm được). Chỉ khi nhóm còn mở,
 * chưa quá hạn và còn thiếu người; nhóm đủ, đóng hay quá hạn thì null. Thay dòng "Còn thiếu N người" ở thẻ đó (cùng một ý, không nói hai lần).
 */
export function groupSlotsLine(
  g: Pick<GroupBuy, 'status' | 'expiresAt' | 'targetSize' | 'currentSize'> & PriceFields,
  formatVnd: (n: number) => string,
  now: number,
  flash?: readonly FlashPriceItem[],
): string | null {
  const n = groupMissing(g);
  const deadline = groupDeadline(g, now);
  if (n <= 0 || g.status !== 'OPEN' || (deadline.kind === 'text' && deadline.expired)) return null;
  const save = groupSaving(g, flash, now);
  return save > 0 ? fillCopy('groupBuy.slotsLeftSave', { n, save: formatVnd(save) }) : fillCopy('groupBuy.slotsLeft', { n });
}

/**
 * Tin chia sẻ nhóm của hai app: tiêu đề và mô tả (dòng ưu đãi chào mừng đứng đầu). Khung "Tin mời sẽ gửi" ở trang mời vẽ đúng hai chuỗi này, nên
 * khách thấy trước đúng tin sẽ gửi đi.
 */
export function groupShareContent(
  g: Pick<GroupBuy, 'product' | 'discountPct' | 'targetSize' | 'currentSize'>,
  offer: WelcomeOffer | null | undefined,
): { title: string; text: string } {
  return {
    title: fillCopy('groupBuy.shareTitle', { name: g.product.name, pct: g.discountPct }),
    text: shareDescription(fillCopy('groupBuy.shareBody', { n: groupMissing(g) }), offer),
  };
}
