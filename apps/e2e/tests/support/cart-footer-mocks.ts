import type { CartLine, CartSummary } from '../../../miniapp/src/services/shop-api';
import { mockPilotCart, PILOT_CART } from './pilot-mocks';
import type { MockApi } from './mock-api';

/**
 * Giỏ giả cho các spec đo chân dính (cart-footer.*) và chụp ảnh: số dòng, đạt/chưa đạt miễn phí giao, giảm combo, dòng hết hàng,
 * và gợi ý mã (ví có mã + xem trước nhiều mã dùng được). Cùng một bộ số cho Mini App và web để so hai bên.
 */
export interface FooterCartOptions {
  lines?: number;
  /** Đạt miễn phí giao hàng (tạm tính ≥ ngưỡng). */
  reached?: boolean;
  /** Giảm combo của gian hàng đang ghi công (0 = không có dòng này). */
  combo?: number;
  /** Có một dòng Giờ vàng giá gạch theo giá đang bán + một dòng giảm giá thường. */
  deals?: boolean;
  /** Dòng đầu hết hàng (tồn 0): chân dính hiện lời báo và khoá nút. */
  outOfStock?: boolean;
  /** Đơn giá mỗi dòng (thay 120.000 / 30.000 theo `reached`): dựng số lớn như tổng 12.345.000đ. */
  unit?: number;
  /** Dòng đầu có giá gạch cao hơn giá bán chừng này (tiết kiệm = saving × số lượng), như món sale. */
  saving?: number;
}

export const FREESHIP_THRESHOLD = 200_000;

const line = (n: number, over: Partial<CartLine> = {}): CartLine => ({
  ...PILOT_CART.items[0]!,
  id: `ft-${n}`,
  variationId: `ft-v-${n}`,
  slug: `ft-sp-${n}`,
  productName: `Sản phẩm thử ${n}`,
  ...over,
});

export function footerCart(o: FooterCartOptions = {}): CartSummary {
  const count = o.lines ?? 3;
  const reached = o.reached ?? true;
  const flashEnd = new Date(Date.now() + 4 * 3_600_000).toISOString();
  const items: CartLine[] = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    // Reached: mỗi dòng 120.000 (>= ngưỡng ngay từ dòng đầu hai dòng); chưa đạt: 30.000 mỗi dòng nên 3 dòng vẫn dưới 200.000.
    const unitPrice = o.unit ?? (reached ? 120_000 : 30_000);
    const base = line(n, { unitPrice, total: unitPrice, listUnitPrice: unitPrice });
    if (o.deals && n === 1) return { ...base, unitPrice: 33_000, total: 33_000, listUnitPrice: 50_000, isFlash: true, flashEndAt: flashEnd, flashSaleItemId: 'ft-f1' };
    if (o.deals && n === 2) return { ...base, listUnitPrice: unitPrice + 31_000 };
    if (o.outOfStock && n === 1) return { ...base, stock: 0 };
    if (o.saving && n === 1) return { ...base, listUnitPrice: unitPrice + o.saving };
    return base;
  });
  const subtotal = items.reduce((s, l) => s + l.total, 0);
  return {
    items,
    couponCode: null,
    subtotal,
    discount: 0,
    comboDiscount: o.combo ?? 0,
    freeship: reached,
    freeshipThreshold: FREESHIP_THRESHOLD,
    itemCount: items.reduce((s, l) => s + l.quantity, 0),
  };
}

/** Giỏ Mini App + (tuỳ chọn) ví có mã và xem trước `usable` mã dùng được, mã tốt nhất giảm `maxSaving`. */
export function mockFooterCart(api: MockApi, o: FooterCartOptions & { hint?: { usable: number; maxSaving: number } } = {}): CartSummary {
  mockPilotCart(api);
  const cart = footerCart(o);
  api.get('/cart', cart);
  if (o.hint) mockCouponHint(api, o.hint);
  return cart;
}

export function mockCouponHint(api: MockApi, hint: { usable: number; maxSaving: number }): void {
  const wallet = Array.from({ length: hint.usable }, (_, i) => ({
    code: `FT${i + 1}`, type: 'AMOUNT' as const, value: hint.maxSaving, minOrder: null, maxDiscount: null, endAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  }));
  api.get('/me/coupons', wallet);
  api.post('/checkout/coupon-previews', { coupons: wallet.map((c) => ({ code: c.code, eligible: true, discount: hint.maxSaving })) });
}
