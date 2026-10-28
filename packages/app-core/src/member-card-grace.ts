import { memberCardView, moneyShort, type MemberCardView } from './home-layout';
import { tierGraceLine } from './loyalty-tier-copy';

// Chỉ trang Ưu đãi vẽ dòng giữ hạng dưới thẻ thành viên; thẻ ở Trang chủ (gói đầu của Mini App) không vẽ, nên phần này tách khỏi `home-layout`.

export interface OffersMemberCardView extends MemberCardView {
  /** Đang trong hạn giữ hạng: thanh tiến độ lên hạng kế không còn đúng nghĩa (dòng bên dưới nói chuyện giữ hạng), nơi vẽ thanh nên ẩn. */
  inGrace: boolean;
}

/** dd/mm/yyyy theo giờ Việt Nam (UTC+7 quanh năm), không phụ thuộc múi giờ máy. */
function vnDay(iso: string): string {
  const v = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
}

/**
 * Thẻ thành viên của trang Ưu đãi. Khách đang trong hạn giữ hạng thì `toGoLine` là dòng giữ hạng ("Giữ hạng Lộc Biếc: ... trước 07/11/2026"),
 * vì mất hạng gấp hơn lên hạng; còn lại giống `memberCardView`.
 */
export function offersMemberCard(opts: Parameters<typeof memberCardView>[0]): OffersMemberCardView {
  const card = memberCardView(opts);
  const graceLine = card.tierName
    ? tierGraceLine(opts.overview?.tierGrace, card.tierName, { money: moneyShort, points: (n) => n.toLocaleString('vi-VN'), date: vnDay })
    : null;
  return { ...card, toGoLine: graceLine ?? card.toGoLine, inGrace: graceLine != null };
}
