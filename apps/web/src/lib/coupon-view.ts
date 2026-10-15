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
