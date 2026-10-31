import { describe, expect, it } from 'vitest';
import type { CouponDTO } from '../api/loyalty';
import { vnd, vndShort } from './money';
import { couponLabel, sortVouchers, voucherView } from './voucher';

const NOW = Date.parse('2026-11-01T05:00:00Z');
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const coupon = (over: Partial<CouponDTO> = {}): CouponDTO => ({
  code: 'TUBU30',
  type: 'AMOUNT',
  value: 30_000,
  minOrder: 199_000,
  maxDiscount: null,
  endAt: iso(NOW + 10 * D),
  ...over,
});

describe('vnd / vndShort', () => {
  it('đầy đủ có dấu chấm nghìn', () => {
    expect(vnd(39_000)).toBe('39.000đ');
  });
  it('rút gọn k và tr, số lẻ không tròn thì dạng đầy đủ', () => {
    expect(vndShort(50_000)).toBe('50k');
    expect(vndShort(199_000)).toBe('199k');
    expect(vndShort(1_500_000)).toBe('1,5tr');
    expect(vndShort(12_345)).toBe('12.345đ');
    expect(vndShort(0)).toBe('0đ');
  });
});

describe('couponLabel (chữ giữ như bốn bản cũ)', () => {
  it('freeship, phần trăm, phần trăm có trần, số tiền', () => {
    expect(couponLabel({ type: 'FREESHIP', value: 0, maxDiscount: null })).toBe('Miễn phí giao hàng');
    expect(couponLabel({ type: 'PERCENT', value: 10, maxDiscount: null })).toBe('Giảm 10%');
    expect(couponLabel({ type: 'PERCENT', value: 10, maxDiscount: 30_000 })).toBe('Giảm 10% (tối đa 30.000đ)');
    expect(couponLabel({ type: 'AMOUNT', value: 20_000, maxDiscount: null })).toBe('Giảm 20.000đ');
  });
});

describe('voucherView', () => {
  it('mã số tiền còn hạn trong ví', () => {
    expect(voucherView(coupon(), NOW)).toEqual({
      id: 'TUBU30',
      code: 'TUBU30',
      title: 'Giảm 30.000đ',
      kind: 'discount',
      condition: 'Đơn từ 199k',
      expiry: 'Dùng đến 11/11',
      state: 'saved',
    });
  });
  it('không có đơn tối thiểu thì điều kiện rỗng', () => {
    expect(voucherView(coupon({ minOrder: null }), NOW).condition).toBe('');
  });
  it('loại theo mã: freeship, gắn sản phẩm (shop), còn lại discount', () => {
    expect(voucherView(coupon({ type: 'FREESHIP' }), NOW).kind).toBe('freeship');
    expect(voucherView(coupon({ products: [{ id: 'p1', name: 'A' }] }), NOW).kind).toBe('shop');
    expect(voucherView(coupon({ products: [] }), NOW).kind).toBe('discount');
  });
  it('chữ hạn: dưới 24 giờ, còn 2 ngày, hết hạn', () => {
    expect(voucherView(coupon({ endAt: iso(NOW + 5 * 3_600_000) }), NOW).expiry).toBe('Hết hạn hôm nay');
    expect(voucherView(coupon({ endAt: iso(NOW + 2 * D) }), NOW).expiry).toBe('Còn 2 ngày');
    expect(voucherView(coupon({ endAt: iso(NOW + 3 * D) }), NOW).expiry).toBe('Còn 3 ngày');
    expect(voucherView(coupon({ endAt: iso(NOW + 3 * D + 1) }), NOW).expiry).toBe('Dùng đến 04/11');
    expect(voucherView(coupon({ endAt: iso(NOW - 1) }), NOW).expiry).toBe('Đã hết hạn');
  });
  it('hạn không đọc được thì không đoán: còn dùng được, chữ hạn rỗng', () => {
    const v = voucherView(coupon({ endAt: 'không phải ngày' }), NOW);
    expect(v.state).toBe('saved');
    expect(v.expiry).toBe('');
  });
  it('trạng thái: đã dùng > hết hạn > hết lượt > chưa đủ điều kiện > chưa nhận > đã lưu', () => {
    const expired = coupon({ endAt: iso(NOW - 1) });
    expect(voucherView({ ...expired, used: true }, NOW).state).toBe('used');
    expect(voucherView({ ...expired, soldOut: true }, NOW).state).toBe('expired');
    expect(voucherView({ ...coupon(), soldOut: true, ineligible: true }, NOW).state).toBe('soldout');
    expect(voucherView({ ...coupon(), ineligible: true, claimed: false }, NOW).state).toBe('ineligible');
    expect(voucherView({ ...coupon(), claimed: false }, NOW).state).toBe('collectable');
    expect(voucherView({ ...coupon(), claimed: true }, NOW).state).toBe('saved');
  });
});

describe('sortVouchers', () => {
  const v = (id: string, expiresAt?: string | null) => ({ id, expiresAt });
  it('sắp hết hạn trước, không hạn sau mã còn hạn, hết hạn cuối cùng', () => {
    const list = [v('none'), v('late', iso(NOW + 9 * D)), v('gone', iso(NOW - D)), v('soon', iso(NOW + D)), v('mid', iso(NOW + 4 * D))];
    expect(sortVouchers(list, NOW).map((x) => x.id)).toEqual(['soon', 'mid', 'late', 'none', 'gone']);
  });
  it('ổn định khi hoà và không đổi mảng vào', () => {
    const list = [v('a', iso(NOW + D)), v('b', iso(NOW + D)), v('c', null), v('d', null)];
    const copy = [...list];
    expect(sortVouchers(list, NOW).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(list).toEqual(copy);
  });
  it('hạn không đọc được xếp như không hạn', () => {
    expect(sortVouchers([v('x', 'rác'), v('y', iso(NOW + D))], NOW).map((r) => r.id)).toEqual(['y', 'x']);
  });
});
