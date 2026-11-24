import { fillBootCopy } from '../shop-copy-boot';

/** Ngưỡng "Sắp hết": từ đây chữ đổi thành lời báo, không còn in phần trăm. */
const ALMOST_GONE_PCT = 90;

/**
 * Chữ của thanh % đã bán (thanh chỉ để trang trí, chữ mang thông tin): hết suất > từ 90% "Sắp hết" > có bán "Đã bán n%" >
 * chưa bán "Vừa mở bán". Phần trăm làm tròn trước khi chia khoảng; số rác coi như chưa bán.
 */
export function flashSoldText(pct: number, soldOut: boolean): string {
  if (soldOut) return fillBootCopy('flash.soldOut');
  const n = Number.isFinite(pct) ? Math.round(pct) : 0;
  if (n >= ALMOST_GONE_PCT) return fillBootCopy('flash.almostGone');
  if (n >= 1) return fillBootCopy('flash.soldPct', { n });
  return fillBootCopy('flash.justOpened');
}
