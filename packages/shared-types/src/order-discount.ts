/**
 * Chiết khấu thương mại và chiết khấu thanh toán theo chuẩn kế toán VAS (Thông tư 200 / 133).
 *
 * - Chiết khấu thương mại (mua nhiều, tích luỹ doanh số, mã giảm giá, hạng): đơn giá từng dòng hàng KHÔNG đổi. Hoá đơn ghi đủ
 *   tiền hàng, kèm một dòng giảm riêng; phải thu = tiền hàng − chiết khấu thương mại (+ phí giao).
 * - Chiết khấu thanh toán (trả sớm, đúng hạn): hoá đơn vẫn đủ 100%. Khi thu tiền, khách trả tiền thực thu, phần còn lại của khoản
 *   phải thu được xoá nợ và ghi vào Chi phí tài chính (TK 635).
 */

/** Dòng sổ công nợ đại lý ghi phần xoá nợ do chiết khấu thanh toán (DealerCreditLedger.refType). */
export const PAYMENT_DISCOUNT_LEDGER_REF = 'PAYMENT_DISCOUNT';
export const PAYMENT_DISCOUNT_ACCOUNT = '635';
export const PAYMENT_DISCOUNT_ACCOUNT_LABEL = 'Chi phí tài chính (TK 635)';
export const TRADE_DISCOUNT_LABEL = 'Chiết khấu thương mại';
export const PAYMENT_DISCOUNT_LABEL = 'Chiết khấu thanh toán';

/**
 * Trần chiết khấu thanh toán trên khoản phải thu được xoá (phần trăm). Không có trần thì người ghi sổ xoá được nợ tuỳ ý
 * dưới tên chi phí tài chính; 20 đủ cho mức trả sớm thông thường.
 */
export const PAYMENT_DISCOUNT_MAX_PCT = 20;

export interface OrderDiscountParts {
  subtotal: number;
  discount: number;
  shippingFee?: number;
  total?: number;
  couponDiscount?: number;
  comboDiscount?: number;
  tierDiscount?: number;
  pointsDiscount?: number;
  /** Điểm Xanh khách đã dùng. Chỉ để tách tiền điểm khỏi đơn cũ chưa lưu từng khoản giảm (xem `splitDiscount`). */
  pointsUsed?: number;
}

type DiscountSplitInput = Pick<OrderDiscountParts, 'discount' | 'couponDiscount' | 'comboDiscount' | 'tierDiscount' | 'pointsDiscount' | 'pointsUsed'>;

export interface InvoiceBreakdown {
  /** Tiền hàng theo đơn giá gốc, chưa trừ gì. */
  goodsSubtotal: number;
  /** Chiết khấu thương mại ghi thành dòng giảm trên hoá đơn: mã, combo, hạng, bậc đại lý và mọi khoản giảm không phải điểm. */
  tradeDiscountAmount: number;
  /** Tiền quy đổi từ Điểm Xanh khách dùng; không phải chiết khấu thương mại, tách riêng để kế toán không gộp nhầm. */
  pointsDiscountAmount: number;
  shippingFee: number;
  /** Tổng cộng hoá đơn = tiền hàng − chiết khấu thương mại − điểm + phí giao. */
  invoiceTotal: number;
  /** Chiết khấu thanh toán không bao giờ nằm trên hoá đơn bán hàng. */
  paymentDiscountOnInvoice: 0;
}

const int = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : 0);

/** 1 Điểm Xanh = 1đ (migration points_1d; cấu hình `loyalty.vnd_per_point_redeem` mặc định 1). */
export const VND_PER_GREEN_POINT = 1;

/**
 * Tách tổng giảm của đơn thành chiết khấu thương mại và tiền điểm. Có từng khoản giảm thì trừ riêng tiền điểm, phần chênh không
 * gán được vào khoản nào vẫn là chiết khấu thương mại. Đơn tạo trước khi API lưu từng khoản giảm (cả bốn cột bằng 0) chỉ có tổng
 * `discount`: nếu đơn có dùng Điểm Xanh thì tiền điểm = `pointsUsed` × 1đ (kẹp bằng tổng giảm) và phần còn lại là chiết khấu thương mại;
 * không dùng điểm thì coi trọn tổng đó là chiết khấu thương mại.
 */
function splitDiscount(o: DiscountSplitInput): {
  trade: number;
  points: number;
} {
  const discount = Math.max(0, int(o.discount));
  const known = int(o.couponDiscount) + int(o.comboDiscount) + int(o.tierDiscount) + int(o.pointsDiscount);
  if (known === 0) {
    const points = Math.min(Math.max(0, int(o.pointsUsed)) * VND_PER_GREEN_POINT, discount);
    return { trade: discount - points, points };
  }
  const points = Math.min(Math.max(0, int(o.pointsDiscount)), discount);
  return { trade: discount - points, points };
}

export function tradeDiscountOf(o: DiscountSplitInput): number {
  return splitDiscount(o).trade;
}

export function invoiceBreakdownOf(o: OrderDiscountParts): InvoiceBreakdown {
  const goodsSubtotal = Math.max(0, int(o.subtotal));
  const { trade, points } = splitDiscount(o);
  const shippingFee = Math.max(0, int(o.shippingFee));
  return {
    goodsSubtotal,
    tradeDiscountAmount: trade,
    pointsDiscountAmount: points,
    shippingFee,
    invoiceTotal: goodsSubtotal - trade - points + shippingFee,
    paymentDiscountOnInvoice: 0,
  };
}

export interface PaymentSettlementInput {
  /** Khoản phải thu hoá đơn đang được thanh toán. */
  receivable: number;
  /** Tiền thực thu (tiền mặt / chuyển khoản). */
  cashCollected: number;
  /** Chiết khấu thanh toán: phần xoá nợ ghi vào chi phí tài chính. */
  paymentDiscount: number;
}

export interface PaymentSettlement {
  receivable: number;
  cashCollected: number;
  /** Ghi vào Chi phí tài chính (TK 635). */
  financialExpense: number;
  /** Công nợ còn lại sau khi thu tiền và xoá nợ. */
  remaining: number;
  /** Phần trăm chiết khấu thanh toán trên khoản được xoá (thu + chiết khấu), làm tròn 1 chữ số thập phân. */
  discountPct: number;
}

export type PaymentSettlementResult = { ok: true; settlement: PaymentSettlement } | { ok: false; reason: string };

const vnd = (n: number): string => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;

/**
 * Kiểm và tính một lần thu tiền kèm chiết khấu thanh toán. Cùng một luật cho máy chủ (chốt chặn) và màn Admin (báo trước):
 * số nguyên không âm, có thu tiền thật, thu + chiết khấu không vượt phải thu, chiết khấu không vượt trần.
 */
export function settlePayment(input: PaymentSettlementInput): PaymentSettlementResult {
  const { receivable, cashCollected, paymentDiscount } = input;
  if (Number.isFinite(receivable) && receivable <= 0 && paymentDiscount > 0) {
    return { ok: false, reason: 'Đại lý không còn dư nợ để xoá, nên không có chiết khấu thanh toán.' };
  }
  for (const n of [receivable, cashCollected, paymentDiscount]) {
    if (!Number.isInteger(n) || n < 0) return { ok: false, reason: 'Số tiền phải là số nguyên không âm.' };
  }
  if (cashCollected <= 0) return { ok: false, reason: 'Số tiền thực thu phải lớn hơn 0.' };
  const cleared = cashCollected + paymentDiscount;
  if (cleared > receivable) {
    return { ok: false, reason: `Thực thu ${vnd(cashCollected)} + chiết khấu thanh toán ${vnd(paymentDiscount)} vượt phải thu ${vnd(receivable)}.` };
  }
  if (paymentDiscount > 0 && paymentDiscount * 100 > cleared * PAYMENT_DISCOUNT_MAX_PCT) {
    return {
      ok: false,
      reason: `Chiết khấu thanh toán tối đa ${PAYMENT_DISCOUNT_MAX_PCT}% khoản được xoá nợ (${vnd(Math.floor((cleared * PAYMENT_DISCOUNT_MAX_PCT) / 100))}).`,
    };
  }
  return {
    ok: true,
    settlement: {
      receivable,
      cashCollected,
      financialExpense: paymentDiscount,
      remaining: receivable - cleared,
      discountPct: Math.round((paymentDiscount * 1000) / cleared) / 10,
    },
  };
}

/** Gợi ý chiết khấu thanh toán khi kế toán chọn xoá hết phần chưa thu: phải thu − thực thu (không âm). */
export function suggestPaymentDiscount(receivable: number, cashCollected: number): number {
  const r = int(receivable);
  const c = int(cashCollected);
  return r > c && c > 0 ? r - c : 0;
}
