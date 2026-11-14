import {
  PAYMENT_DISCOUNT_MAX_PCT,
  invoiceBreakdownOf,
  settlePayment,
  suggestPaymentDiscount,
  tradeDiscountOf,
} from '@tubutree/shared-types';

/**
 * Chuẩn kế toán của Anh Thư (VAS, TT200/133):
 *  - Chiết khấu thương mại: đơn giá hàng không đổi, hoá đơn ghi đủ tiền hàng + một dòng giảm riêng.
 *  - Chiết khấu thanh toán: hoá đơn đủ 100%, lúc thu tiền phần chênh được xoá nợ và ghi chi phí tài chính (TK 635).
 */

describe('invoiceBreakdownOf — chiết khấu thương mại nằm trên hoá đơn', () => {
  it('hàng 100.000đ, chiết khấu thương mại 20.000đ → hoá đơn ghi 100.000đ, dòng giảm -20.000đ, tổng cộng 80.000đ', () => {
    const b = invoiceBreakdownOf({ subtotal: 100_000, discount: 20_000, tierDiscount: 20_000 });
    expect(b).toEqual({
      goodsSubtotal: 100_000,
      tradeDiscountAmount: 20_000,
      pointsDiscountAmount: 0,
      shippingFee: 0,
      invoiceTotal: 80_000,
      paymentDiscountOnInvoice: 0,
    });
  });

  it('mã giảm giá + combo + hạng đều là chiết khấu thương mại; tiền quy đổi Điểm Xanh tách riêng, không gộp vào chiết khấu thương mại', () => {
    const b = invoiceBreakdownOf({
      subtotal: 200_000,
      discount: 60_000,
      couponDiscount: 20_000,
      comboDiscount: 15_000,
      tierDiscount: 10_000,
      pointsDiscount: 15_000,
      shippingFee: 19_000,
    });
    expect(b.tradeDiscountAmount).toBe(45_000);
    expect(b.pointsDiscountAmount).toBe(15_000);
    expect(b.invoiceTotal).toBe(200_000 - 45_000 - 15_000 + 19_000);
  });

  it('phần chênh không gán được vào khoản nào (discount > tổng các phần) vẫn là chiết khấu thương mại', () => {
    expect(tradeDiscountOf({ discount: 30_000, couponDiscount: 10_000, pointsDiscount: 5_000 })).toBe(25_000);
  });

  it('đơn cũ chỉ có tổng discount (bốn cột phần đều 0) → coi trọn là chiết khấu thương mại, không mất đồng nào', () => {
    const b = invoiceBreakdownOf({ subtotal: 100_000, discount: 20_000, shippingFee: 0 });
    expect(b.tradeDiscountAmount).toBe(20_000);
    expect(b.pointsDiscountAmount).toBe(0);
    expect(b.invoiceTotal).toBe(80_000);
  });

  describe('đơn lẻ CŨ (bốn cột giảm chi tiết đều 0, chỉ có tổng discount)', () => {
    it('có dùng Điểm Xanh: tiền điểm tách thành khoản riêng, phần còn lại mới là chiết khấu thương mại', () => {
      const b = invoiceBreakdownOf({ subtotal: 100_000, discount: 30_000, pointsUsed: 10_000, shippingFee: 0 });
      expect(b).toMatchObject({ goodsSubtotal: 100_000, tradeDiscountAmount: 20_000, pointsDiscountAmount: 10_000, invoiceTotal: 70_000 });
      expect(tradeDiscountOf({ discount: 30_000, pointsUsed: 10_000 })).toBe(20_000);
    });

    it('chỉ dùng Điểm Xanh (không có voucher): chiết khấu thương mại bằng 0, cả tổng giảm là tiền điểm', () => {
      const b = invoiceBreakdownOf({ subtotal: 100_000, discount: 5_000, pointsUsed: 5_000 });
      expect(b).toMatchObject({ tradeDiscountAmount: 0, pointsDiscountAmount: 5_000, invoiceTotal: 95_000 });
    });

    it('có voucher, không dùng điểm: trọn tổng giảm vẫn là chiết khấu thương mại (không đổi so với trước)', () => {
      const b = invoiceBreakdownOf({ subtotal: 100_000, discount: 30_000, pointsUsed: 0 });
      expect(b).toMatchObject({ tradeDiscountAmount: 30_000, pointsDiscountAmount: 0, invoiceTotal: 70_000 });
      expect(invoiceBreakdownOf({ subtotal: 100_000, discount: 30_000 })).toMatchObject({ tradeDiscountAmount: 30_000, pointsDiscountAmount: 0 });
    });

    it('điểm lớn hơn tổng giảm (dữ liệu lệch) bị kẹp bằng tổng giảm, chiết khấu thương mại không âm', () => {
      const b = invoiceBreakdownOf({ subtotal: 100_000, discount: 8_000, pointsUsed: 20_000 });
      expect(b).toMatchObject({ tradeDiscountAmount: 0, pointsDiscountAmount: 8_000, invoiceTotal: 92_000 });
    });

    it('tổng tiền hàng − CK thương mại − điểm + phí giao luôn bằng tổng giảm đã trừ (không mất, không thừa đồng nào)', () => {
      const b = invoiceBreakdownOf({ subtotal: 150_000, discount: 42_000, pointsUsed: 12_000, shippingFee: 19_000 });
      expect(b.tradeDiscountAmount + b.pointsDiscountAmount).toBe(42_000);
      expect(b.invoiceTotal).toBe(150_000 - 42_000 + 19_000);
    });
  });

  it('đơn đại lý MỚI (đã có cột bậc đại lý): điểm lấy theo pointsDiscount, pointsUsed không được tính lần nữa', () => {
    const b = invoiceBreakdownOf({ subtotal: 100_000, discount: 20_000, tierDiscount: 20_000, pointsUsed: 7_000 });
    expect(b).toMatchObject({ tradeDiscountAmount: 20_000, pointsDiscountAmount: 0, invoiceTotal: 80_000 });
  });

  it('không có chiết khấu → dòng giảm 0, hoá đơn = tiền hàng + phí giao', () => {
    const b = invoiceBreakdownOf({ subtotal: 100_000, discount: 0, shippingFee: 19_000 });
    expect(b.tradeDiscountAmount).toBe(0);
    expect(b.invoiceTotal).toBe(119_000);
  });

  it('chiết khấu thanh toán không bao giờ nằm trên hoá đơn bán hàng', () => {
    expect(invoiceBreakdownOf({ subtotal: 100_000, discount: 0 }).paymentDiscountOnInvoice).toBe(0);
  });

  it('điểm lớn hơn tổng giảm (dữ liệu lệch) bị kẹp bằng tổng giảm: chiết khấu thương mại không âm', () => {
    const b = invoiceBreakdownOf({ subtotal: 100_000, discount: 5_000, pointsDiscount: 9_000 });
    expect(b.pointsDiscountAmount).toBe(5_000);
    expect(b.tradeDiscountAmount).toBe(0);
    expect(b.invoiceTotal).toBe(95_000);
  });

  it('giá trị rác (NaN, âm, undefined) không làm hoá đơn ra NaN', () => {
    const b = invoiceBreakdownOf({ subtotal: Number.NaN, discount: -5, shippingFee: undefined });
    expect(b).toMatchObject({ goodsSubtotal: 0, tradeDiscountAmount: 0, shippingFee: 0, invoiceTotal: 0 });
  });
});

describe('settlePayment — chiết khấu thanh toán xoá nợ vào Chi phí tài chính TK 635', () => {
  it('hoá đơn 100.000đ, thu 80.000đ + chiết khấu thanh toán 20.000đ → công nợ còn lại 0đ, 20.000đ vào chi phí tài chính', () => {
    const r = settlePayment({ receivable: 100_000, cashCollected: 80_000, paymentDiscount: 20_000 });
    expect(r).toEqual({
      ok: true,
      settlement: { receivable: 100_000, cashCollected: 80_000, financialExpense: 20_000, remaining: 0, discountPct: 20 },
    });
  });

  it('không có chiết khấu: thu 60.000đ trên 100.000đ → còn nợ 40.000đ, chi phí tài chính 0đ', () => {
    const r = settlePayment({ receivable: 100_000, cashCollected: 60_000, paymentDiscount: 0 });
    expect(r).toMatchObject({ ok: true, settlement: { financialExpense: 0, remaining: 40_000, discountPct: 0 } });
  });

  it('chiết khấu một phần: thu 70.000đ + chiết khấu 10.000đ trên 100.000đ → còn nợ 20.000đ', () => {
    const r = settlePayment({ receivable: 100_000, cashCollected: 70_000, paymentDiscount: 10_000 });
    expect(r).toMatchObject({ ok: true, settlement: { remaining: 20_000, financialExpense: 10_000 } });
  });

  it('thu + chiết khấu vượt phải thu → từ chối, nêu cả hai số', () => {
    const r = settlePayment({ receivable: 100_000, cashCollected: 90_000, paymentDiscount: 20_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/vượt phải thu 100\.000đ/);
  });

  it(`chiết khấu quá ${PAYMENT_DISCOUNT_MAX_PCT}% khoản được xoá nợ → từ chối (không xoá nợ tuỳ ý dưới tên chi phí tài chính)`, () => {
    const r = settlePayment({ receivable: 100_000, cashCollected: 50_000, paymentDiscount: 50_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/tối đa 20%/);
  });

  it('đúng trần 20% thì qua, hơn 1đ thì bị chặn', () => {
    expect(settlePayment({ receivable: 100_000, cashCollected: 80_000, paymentDiscount: 20_000 }).ok).toBe(true);
    expect(settlePayment({ receivable: 100_000, cashCollected: 79_999, paymentDiscount: 20_001 }).ok).toBe(false);
  });

  it('không có tiền thực thu (0đ) → từ chối: chiết khấu thanh toán đi kèm một lần thu tiền thật', () => {
    const r = settlePayment({ receivable: 100_000, cashCollected: 0, paymentDiscount: 10_000 });
    expect(r).toMatchObject({ ok: false });
  });

  it('số thập phân hoặc âm → từ chối', () => {
    expect(settlePayment({ receivable: 100_000, cashCollected: 80_000.5, paymentDiscount: 0 }).ok).toBe(false);
    expect(settlePayment({ receivable: 100_000, cashCollected: 80_000, paymentDiscount: -1 }).ok).toBe(false);
    expect(settlePayment({ receivable: Number.NaN, cashCollected: 1, paymentDiscount: 0 }).ok).toBe(false);
  });

  it('phần trăm chiết khấu làm tròn một chữ số thập phân trên khoản được xoá', () => {
    const r = settlePayment({ receivable: 300_000, cashCollected: 290_000, paymentDiscount: 10_000 });
    expect(r).toMatchObject({ ok: true, settlement: { discountPct: 3.3 } });
  });
});

describe('suggestPaymentDiscount — gợi ý xoá hết phần chưa thu', () => {
  it('phải thu 100.000đ, thực thu 80.000đ → gợi ý 20.000đ', () => {
    expect(suggestPaymentDiscount(100_000, 80_000)).toBe(20_000);
  });

  it('thu đủ, thu thừa, chưa nhập tiền hoặc dữ liệu rác → 0', () => {
    expect(suggestPaymentDiscount(100_000, 100_000)).toBe(0);
    expect(suggestPaymentDiscount(100_000, 120_000)).toBe(0);
    expect(suggestPaymentDiscount(100_000, 0)).toBe(0);
    expect(suggestPaymentDiscount(Number.NaN, 5)).toBe(0);
  });
});

describe('settlePayment: đại lý không còn dư nợ', () => {
  it.each([0, -500_000])('dư nợ %i mà vẫn gửi chiết khấu thanh toán → nói rõ không còn nợ để xoá, không báo lỗi số nguyên', (receivable) => {
    const r = settlePayment({ receivable, cashCollected: 10_000, paymentDiscount: 2_000 });
    expect(r).toEqual({ ok: false, reason: 'Đại lý không còn dư nợ để xoá, nên không có chiết khấu thanh toán.' });
  });
});
