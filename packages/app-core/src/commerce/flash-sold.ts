import { fillCopy } from '../shop-copy';

/** Ngưỡng "Sắp hết": từ đây chữ đổi thành lời báo, không còn in phần trăm. */
const ALMOST_GONE_PCT = 90;

/**
 * Chữ của thanh % đã bán (thanh chỉ để trang trí, chữ mang thông tin): hết suất > từ 90% "Sắp hết" > có bán "Đã bán n%" >
 * chưa bán "Vừa mở bán". Phần trăm làm tròn trước khi chia khoảng; số rác coi như chưa bán.
 */
export function flashSoldText(pct: number, soldOut: boolean): string {
  if (soldOut) return fillCopy('flash.soldOut');
  const n = Number.isFinite(pct) ? Math.round(pct) : 0;
  if (n >= ALMOST_GONE_PCT) return fillCopy('flash.almostGone');
  if (n >= 1) return fillCopy('flash.soldPct', { n });
  return fillCopy('flash.justOpened');
}
