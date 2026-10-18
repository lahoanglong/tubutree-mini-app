import { describe, expect, it } from 'vitest';
import { couponLabel, freeshipLine, groupBuyPitch, isRetailOnly, pdpCoupons, resolveFreeshipFrom } from './pdp-logic';

describe('isRetailOnly: hàng chỉ bán giá lẻ, không định kỳ, không mua chung', () => {
  it('gian hàng tự giao, tạm nghỉ/ngừng bán và hàng đối tác đều là retail only', () => {
    expect(isRetailOnly({ fulfiller: { kind: 'MERCHANT', name: 'A', shippingFee: 0, freeShipFrom: null } })).toBe(true);
    expect(isRetailOnly({ fulfiller: { kind: 'UNAVAILABLE', name: 'A', shippingFee: null, freeShipFrom: null } })).toBe(true);
    expect(isRetailOnly({ fulfiller: { kind: 'TUBU', name: 'Tubu', shippingFee: null, freeShipFrom: null }, partnerOwned: true })).toBe(true);
  });
  it('hàng Tubu và API cũ chưa trả fulfiller thì không', () => {
    expect(isRetailOnly({ fulfiller: { kind: 'TUBU', name: 'Tubu', shippingFee: null, freeShipFrom: null } })).toBe(false);
    expect(isRetailOnly({})).toBe(false);
  });
});

describe('groupBuyPitch', () => {
  it('có cấu hình thì ghi đúng số người và mức giảm', () => {
    expect(groupBuyPitch({ discountPct: 15, targetSize: 3 })).toBe('Rủ đủ 3 người, mỗi người nhận mã giảm 15% khi nhóm đủ');
  });
  it('thiếu hoặc cấu hình hỏng thì không hứa con số', () => {
    expect(groupBuyPitch(undefined)).toBe('Rủ bạn bè cho đủ nhóm, mỗi người nhận mã giảm giá');
    expect(groupBuyPitch({ discountPct: 0, targetSize: 3 })).toBe('Rủ bạn bè cho đủ nhóm, mỗi người nhận mã giảm giá');
  });
});

describe('mã giảm giá ở trang sản phẩm', () => {
  const c = (code: string, over: Record<string, unknown> = {}) => ({ code, type: 'AMOUNT' as const, value: 20000, minOrder: null, maxDiscount: null, endAt: '2026-12-01', ...over });
  it('nhãn theo loại mã', () => {
    expect(couponLabel(c('A', { type: 'FREESHIP' }))).toBe('Miễn phí vận chuyển');
    expect(couponLabel(c('B', { type: 'PERCENT', value: 10 }))).toBe('Giảm 10%');
    expect(couponLabel(c('B', { type: 'PERCENT', value: 10, maxDiscount: 30000 }))).toBe('Giảm 10% (tối đa 30.000đ)');
    expect(couponLabel(c('C'))).toBe('Giảm 20.000đ');
  });
  it('mã không gắn sản phẩm hiện ở mọi trang; mã gắn sản phẩm chỉ hiện ở đúng sản phẩm đó', () => {
    const list = [c('ALL'), c('ONLY1', { products: [{ id: 'p1', name: 'x' }] }), c('ONLY2', { products: [{ id: 'p2', name: 'y' }] })];
    expect(pdpCoupons(list, 'p1').map((x) => x.code)).toEqual(['ALL', 'ONLY1']);
    expect(pdpCoupons(undefined, 'p1')).toEqual([]);
  });
});

describe('dòng freeship', () => {
  it('có ngưỡng thì nói số, ngưỡng 0 là mọi đơn', () => {
    expect(freeshipLine(200000)).toBe('Miễn phí vận chuyển cho đơn từ 200.000đ');
    expect(freeshipLine(0)).toBe('Miễn phí vận chuyển cho mọi đơn hàng');
  });
  it('khách đăng nhập dùng ngưỡng theo hạng trong giỏ; giỏ chưa về thì chưa hứa số nào', () => {
    expect(resolveFreeshipFrom({ phase: 'authenticated', cartThreshold: 150000, configThreshold: 200000, configLoaded: true })).toBe(150000);
    expect(resolveFreeshipFrom({ phase: 'authenticated', cartThreshold: undefined, configThreshold: 200000, configLoaded: true })).toBeUndefined();
  });
  it('khách vãng lai dùng ngưỡng chung khi config đã về; đang tải phiên hoặc config thì chưa hứa', () => {
    expect(resolveFreeshipFrom({ phase: 'guest', cartThreshold: undefined, configThreshold: 200000, configLoaded: true })).toBe(200000);
    expect(resolveFreeshipFrom({ phase: 'guest', cartThreshold: undefined, configThreshold: 200000, configLoaded: false })).toBeUndefined();
    expect(resolveFreeshipFrom({ phase: 'loading', cartThreshold: undefined, configThreshold: 200000, configLoaded: true })).toBeUndefined();
  });
});
