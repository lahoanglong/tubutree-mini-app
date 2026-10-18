import { describe, expect, it } from 'vitest';
import { subscriptionCycleView } from './subscription-price';

describe('subscriptionCycleView (Mini App subscription-price)', () => {
  it('ưu tiên số server tính', () => {
    expect(subscriptionCycleView({ unitPrice: 80000, quantity: 2, effectiveDiscountPct: 0.14, cycleSubtotal: 160000, cycleDiscount: 22400, cycleGoods: 137600 })).toEqual({
      subtotal: 160000, discount: 22400, goods: 137600, savePct: 14,
    });
  });

  it('API cũ chưa trả cycle*: tự tính, phần giảm làm tròn xuống, tiền hàng không âm', () => {
    expect(subscriptionCycleView({ unitPrice: 99_990, quantity: 3, effectiveDiscountPct: 0.14 })).toEqual({
      subtotal: 299_970, discount: 41_995, goods: 257_975, savePct: 14,
    });
    expect(subscriptionCycleView({ unitPrice: 100, quantity: 1, effectiveDiscountPct: 1.5 }).goods).toBe(0);
  });
});
