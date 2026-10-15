import { formatDate } from './format-date';
import { formatVnd, type CouponDTO } from './shop-client';

/** Mã này cho khách lợi gì, cùng lời với Mini App (voucher-sheet). FREESHIP: `value` > 0 là mức phí ship tối đa được giảm. */
export function couponValueLabel(c: Pick<CouponDTO, 'type' | 'value' | 'maxDiscount'>): string {
  if (c.type === 'PERCENT') {
    return `Giảm ${c.value}%${c.maxDiscount ? ` (tối đa ${formatVnd(c.maxDiscount)})` : ''}`;
  }
  if (c.type === 'FREESHIP') {
    return `Miễn phí vận chuyển${c.value > 0 ? ` (tối đa ${formatVnd(c.value)})` : ''}`;
  }
  return `Giảm ${formatVnd(c.value)}`;
}

/** FREESHIP khi phí vận chuyển của đơn đã bằng 0: dùng mã không giảm thêm được gì. */
export const isFreeshipRedundant = (c: Pick<CouponDTO, 'type'>, shippingFee?: number | null): boolean =>
  c.type === 'FREESHIP' && shippingFee === 0;

/**
 * Dòng "Giảm X cho đơn này" tính từ số khách đang thấy: % trên tạm tính (kẹp mức tối đa), tiền cố định không quá tạm tính.
 * Mã freeship (chỉ miễn kiện Tubu) và mã chỉ áp cho vài sản phẩm (API tính trên các dòng đó, web không có tiền từng dòng)
 * thì không nói số thay vì đoán.
 */
export function couponSavingLabel(c: Pick<CouponDTO, 'type' | 'value' | 'maxDiscount' | 'products'>, subtotal: number): string | null {
  if (c.products?.length) return null;
  let saving: number;
  let capped = false;
  if (c.type === 'PERCENT') {
    const raw = Math.floor((subtotal * c.value) / 100);
    capped = !!c.maxDiscount && raw > c.maxDiscount;
    saving = capped ? c.maxDiscount! : raw;
  } else if (c.type === 'AMOUNT') {
    saving = Math.min(c.value, subtotal);
  } else {
    return null;
  }
  if (saving <= 0) return null;
  return `Giảm ${formatVnd(saving)} cho đơn này${capped ? ' (mức tối đa)' : ''}`;
}

export function couponExpiryLabel(endAt: string | null | undefined): string {
  const d = formatDate(endAt);
  return d === '—' ? 'Không thời hạn' : `HSD ${d}`;
}

export const isCouponEligible = (c: Pick<CouponDTO, 'minOrder'>, subtotal: number): boolean =>
  c.minOrder == null || subtotal >= c.minOrder;

/** Mã dùng được lên trước, mã chưa đủ điều kiện xuống sau; giữ thứ tự máy chủ trong từng nhóm. */
export function sortCouponsForCart<T extends Pick<CouponDTO, 'minOrder'>>(coupons: T[], subtotal: number): T[] {
  return [...coupons.filter((c) => isCouponEligible(c, subtotal)), ...coupons.filter((c) => !isCouponEligible(c, subtotal))];
}
