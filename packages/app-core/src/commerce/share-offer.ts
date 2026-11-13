import { fillCopy } from '../shop-copy';
import { vnd, vndShort } from './money';

/**
 * Lời mời kèm thẻ chia sẻ Zalo (Mini App) và hộp chia sẻ của trình duyệt (web): nhắc ưu đãi khách mới để người nhận có lý do mở link.
 * Số tiền là của mã chào mừng THẬT (`newCustomer.welcomeVoucher` ở cấu hình công khai, do Admin đặt); chưa có số (API cũ, chưa tải, lỗi mạng)
 * thì dùng câu không số, không bao giờ hứa một con số suy đoán.
 */

/** Giới hạn của `openShareSheet` (zmp_deep_link) của zmp-sdk: vượt thì cả lần chia sẻ bị từ chối. `shareLink` của Mini App cắt lần cuối bằng cùng hai số. */
export const SHARE_TITLE_MAX = 100;
export const SHARE_DESCRIPTION_MAX = 400;

export interface WelcomeOffer {
  /** Mệnh giá mã chào mừng (đồng), số nguyên dương. */
  amount: number;
  /** Đơn tối thiểu (đồng); 0 = không yêu cầu. */
  minOrder: number;
}

/** Phần của cấu hình công khai mà lời mời đọc (cả `PublicConfig` của Mini App lẫn của app-core thoả). */
export interface WelcomeOfferSource {
  newCustomer?: { welcomeVoucher?: { amount?: unknown; minOrder?: unknown } | null } | null;
}

const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Mã chào mừng từ cấu hình công khai; null khi thiếu hoặc số không hợp lệ (mệnh giá phải > 0). */
export function welcomeOfferOf(cfg: WelcomeOfferSource | null | undefined): WelcomeOffer | null {
  const v = cfg?.newCustomer?.welcomeVoucher;
  if (!v || !isMoney(v.amount) || v.amount <= 0) return null;
  return { amount: v.amount, minOrder: isMoney(v.minOrder) ? v.minOrder : 0 };
}

/** "Tặng mã 30.000đ cho đơn đầu từ 199k khi mở trên Tubu Tree"; không có số thì "Tặng mã giảm giá cho đơn đầu khi mở trên Tubu Tree". */
export function shareOfferLine(offer: WelcomeOffer | null | undefined): string {
  if (!offer) return fillCopy('share.offerPlain');
  const amount = vnd(offer.amount);
  return offer.minOrder > 0 ? fillCopy('share.offer', { amount, min: vndShort(offer.minOrder) }) : fillCopy('share.offerNoMin', { amount });
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Cắt theo số ký tự UTF-16 như zmp-sdk đếm, không để lại nửa cặp surrogate (emoji), thêm "…" khi cắt. */
export function clipShareText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.max(0, max - 1));
  const last = head.charCodeAt(head.length - 1);
  const lonelyHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return `${lonelyHighSurrogate ? head.slice(0, -1) : head}…`;
}

/**
 * Mô tả thẻ chia sẻ: dòng ưu đãi đứng ĐẦU (giao diện của Zalo cắt đuôi dài), rồi mô tả sản phẩm. Mô tả được cắt cho vừa phần còn lại của `max`,
 * nên dòng ưu đãi không bao giờ bị cắt dù mô tả dài. Mô tả rỗng thì chỉ có dòng ưu đãi.
 */
export function shareDescription(base: string | null | undefined, offer: WelcomeOffer | null | undefined, max: number = SHARE_DESCRIPTION_MAX): string {
  const line = shareOfferLine(offer);
  const rest = collapse(base ?? '');
  const room = max - line.length - 2;
  if (!rest || room < 2) return clipShareText(line, max);
  return `${line}. ${clipShareText(rest, room)}`;
}
