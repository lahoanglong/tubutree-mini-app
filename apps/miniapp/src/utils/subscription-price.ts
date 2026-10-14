import type { SubscriptionDTO } from '../services/subscriptions-api';

/**
 * Số tiền khách thấy trên thẻ lịch định kỳ. Ưu tiên số server tính (cùng hàm với đơn kỳ); API cũ chưa trả thì tính
 * lại bằng đúng công thức đó: phần giảm = floor(tiền hàng × %), tiền hàng không âm.
 */
export function subscriptionCycleView(s: Pick<SubscriptionDTO, 'unitPrice' | 'quantity' | 'effectiveDiscountPct' | 'cycleSubtotal' | 'cycleDiscount' | 'cycleGoods'>) {
  const subtotal = s.cycleSubtotal ?? s.unitPrice * s.quantity;
  const discount = s.cycleDiscount ?? Math.floor(subtotal * s.effectiveDiscountPct);
  const goods = s.cycleGoods ?? Math.max(0, subtotal - discount);
  return { subtotal, discount, goods, savePct: Math.round(s.effectiveDiscountPct * 100) };
}
