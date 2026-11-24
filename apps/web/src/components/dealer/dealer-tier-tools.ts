import type { DealerInvoiceRequestResult, DealerTierProgress, PricelistRow } from '@tubutree/app-core/api/dealer';
import type { OrderDTO } from '@tubutree/shared-types';

type Money = (n: number) => string;

/** Phần trăm thanh tiến độ doanh số tháng tới mốc bậc kế (0..100). Không có bậc kế thì đầy. */
export function tierProgressPct(p: DealerTierProgress): number {
  if (!p.nextTier || p.nextTier.minOrderVolume <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((p.volume / p.nextTier.minOrderVolume) * 100)));
}

/**
 * Chữ dưới thanh tiến độ bậc. Lên bậc do Tubu Tree xét và gán (không tự động), nên đủ mốc thì mời liên hệ chứ không hứa tự lên.
 * Trả null khi chưa được gán bậc (bậc đầu gán lúc duyệt hồ sơ, không theo doanh số).
 */
export function tierProgressLines(p: DealerTierProgress, money: Money): { headline: string; pending: string | null } | null {
  if (!p.currentTier) return null;
  const pending = p.pendingVolume > 0 ? `+ ${money(p.pendingVolume)} đơn chờ thanh toán/đóng gói, chưa tính.` : null;
  const next = p.nextTier;
  if (!next) return { headline: `Bạn đang ở bậc chiết khấu cao nhất (${p.currentTier.discountPct}%).`, pending };
  if (next.toGo > 0) {
    return { headline: `Còn ${money(next.toGo)} trong tháng ${p.month} để được xét lên ${next.name} (chiết khấu ${next.discountPct}%).`, pending };
  }
  return { headline: `Tháng ${p.month} đã đủ mốc ${next.name} (chiết khấu ${next.discountPct}%). Bạn liên hệ Tubu Tree để được xét nâng bậc.`, pending };
}

/**
 * Đơn đang chọn đưa doanh số tháng tới đâu so với mốc bậc kế. Tính cả đơn chờ chốt (sẽ được tính khi đóng gói và trả tiền).
 * Không có bậc kế, giỏ trống, hoặc tháng đã đủ mốc (dòng tổng quan đã nói) thì không có dòng này.
 */
export function basketTierLine(p: DealerTierProgress | undefined, basketGoods: number, money: Money): string | null {
  const next = p?.nextTier;
  if (!p || !next || basketGoods <= 0 || next.toGo <= 0) return null;
  const missing = next.minOrderVolume - (p.volume + p.pendingVolume + basketGoods);
  return missing > 0 ? `Cộng đơn này còn thiếu ${money(missing)} tới mốc ${next.name}.` : `Cộng đơn này, tháng ${p.month} đủ mốc ${next.name}.`;
}

/** Lãi gộp nếu bán đúng giá lẻ niêm yết: tổng giá lẻ của giỏ trừ tổng giá sỉ. */
export function basketMargin(cart: Array<[string, number]>, rows: PricelistRow[]): { retail: number; cost: number; margin: number; pct: number } {
  const byId = new Map(rows.map((r) => [r.variationId, r]));
  let retail = 0;
  let cost = 0;
  for (const [id, qty] of cart) {
    const r = byId.get(id);
    if (!r || qty <= 0) continue;
    retail += r.retailPrice * qty;
    cost += r.dealerPrice * qty;
  }
  const margin = retail - cost;
  return { retail, cost, margin, pct: retail > 0 ? Math.round((margin / retail) * 100) : 0 };
}

export function marginLine(m: { margin: number; pct: number }, money: Money): string | null {
  return m.margin > 0 ? `Bán đúng giá lẻ lãi ${money(m.margin)} (${m.pct}%)` : null;
}

/** Cùng số ngày với máy chủ (dealer-invoice.service DEALER_INVOICE_REQUEST_DAYS): đơn cũ hơn phải liên hệ Tubu Tree. */
export const INVOICE_REQUEST_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Trần số mã đơn một lần gửi, cùng số với máy chủ (dealer.dto DEALER_INVOICE_BATCH_MAX): quá trần thì máy chủ từ chối cả lô. */
export const INVOICE_BATCH_MAX = 50;

/**
 * Đơn đại lý còn tự gửi yêu cầu hoá đơn VAT được: chưa huỷ/trả, chưa có yêu cầu, đặt trong 30 ngày. Lấy tối đa `INVOICE_BATCH_MAX`
 * đơn đầu danh sách (mới nhất trước); gửi xong danh sách tải lại và các đơn còn lại hiện ở lần sau.
 */
export function invoiceEligibleOrders(orders: OrderDTO[], now: Date): OrderDTO[] {
  const cutoff = now.getTime() - INVOICE_REQUEST_DAYS * DAY_MS;
  return orders
    .filter(
      (o) =>
        o.status !== 'CANCELLED' &&
        o.status !== 'RETURNED' &&
        (!o.invoiceStatus || o.invoiceStatus === 'NOT_REQUESTED') &&
        new Date(o.createdAt).getTime() >= cutoff,
    )
    .slice(0, INVOICE_BATCH_MAX);
}

/** Ghi chú hoá đơn trên dòng đơn (cùng dòng số mặt hàng · ngày), không thêm dòng mới. */
export function invoiceTag(o: Pick<OrderDTO, 'invoiceStatus'>): string | null {
  if (o.invoiceStatus === 'ISSUED') return 'Đã có HĐ VAT';
  if (o.invoiceStatus === 'REQUESTED' || o.invoiceStatus === 'FAILED') return 'Đã yêu cầu HĐ VAT';
  return null;
}

/** Lời báo sau khi gửi yêu cầu hoá đơn nhiều đơn: số đơn đã gửi, rồi từng đơn chưa gửi kèm lý do máy chủ trả. */
export function invoiceResultNotice(r: DealerInvoiceRequestResult): { text: string; error: boolean } {
  const skipped = r.skipped.map((s) => `#${s.code}: ${s.reason}`).join(' ');
  if (r.requested.length === 0) return { text: `Chưa gửi được yêu cầu hoá đơn. ${skipped}`.trim(), error: true };
  const sent = `Đã gửi yêu cầu hoá đơn VAT cho ${r.requested.length} đơn.`;
  return r.skipped.length > 0 ? { text: `${sent} Chưa gửi ${r.skipped.length} đơn: ${skipped}`, error: true } : { text: sent, error: false };
}
