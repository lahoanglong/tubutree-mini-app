import { describe, expect, it } from 'vitest';
import { CHECKOUT_LINES_COLLAPSED, checkoutPlaceHint, checkoutTotalText, collapseCheckoutLines } from './checkout-display';
import { fillCopy } from '../shop-copy';

const fmt = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

describe('checkoutPlaceHint', () => {
  it('thiếu địa chỉ: nói chọn địa chỉ, kể cả khi báo giá cũng lỗi (địa chỉ thắng)', () => {
    expect(checkoutPlaceHint({ hasAddress: false, quoteFailed: true })).toBe('Chọn địa chỉ giao hàng để đặt hàng.');
    expect(checkoutPlaceHint({ hasAddress: false, quoteFailed: false })).toBe('Chọn địa chỉ giao hàng để đặt hàng.');
  });

  it('có địa chỉ mà báo giá lỗi: nói chưa tính được tổng tiền', () => {
    expect(checkoutPlaceHint({ hasAddress: true, quoteFailed: true })).toBe(fillCopy('checkout.quoteFailed'));
    expect(fillCopy('checkout.quoteFailed')).toContain('Thử lại');
  });

  it('đủ địa chỉ và báo giá tốt: không có lý do', () => {
    expect(checkoutPlaceHint({ hasAddress: true, quoteFailed: false })).toBeNull();
  });
});

describe('checkoutTotalText', () => {
  it('có số báo giá thì ghi số', () => {
    expect(checkoutTotalText({ total: 330_000, hasAddress: true }, fmt)).toBe(fmt(330_000));
  });

  it('đơn 0đ vẫn là số, không bị coi là chưa có', () => {
    expect(checkoutTotalText({ total: 0, hasAddress: true }, fmt)).toBe(fmt(0));
  });

  it('có địa chỉ mà chưa có số: "…", không phải 0đ', () => {
    expect(checkoutTotalText({ total: null, hasAddress: true }, fmt)).toBe('…');
  });

  it('chưa có địa chỉ: "Chưa tính", không có số nào đứng ở chỗ tổng', () => {
    expect(checkoutTotalText({ total: null, hasAddress: false }, fmt)).toBe('Chưa tính');
  });
});

describe('collapseCheckoutLines', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, total: (i + 1) * 10_000 }));

  it('trần mặc định là 5 dòng', () => {
    expect(CHECKOUT_LINES_COLLAPSED).toBe(5);
  });

  it('đúng 5 dòng thì không gập', () => {
    const r = collapseCheckoutLines(lines(5), false);
    expect(r.shown).toHaveLength(5);
    expect(r.hiddenCount).toBe(0);
    expect(r.hiddenTotal).toBe(0);
  });

  it('6 dòng đang gập: 5 dòng thấy, 1 dòng ẩn kèm tiền để cộng đủ Tạm tính', () => {
    const all = lines(6);
    const r = collapseCheckoutLines(all, false);
    expect(r.shown.map((l) => l.id)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(r.hiddenCount).toBe(1);
    expect(r.hiddenTotal).toBe(60_000);
    expect(r.shown.reduce((s, l) => s + l.total, 0) + r.hiddenTotal).toBe(all.reduce((s, l) => s + l.total, 0));
  });

  it('đã mở thì hiện đủ, không còn dòng ẩn', () => {
    const r = collapseCheckoutLines(lines(8), true);
    expect(r.shown).toHaveLength(8);
    expect(r.hiddenCount).toBe(0);
    expect(r.hiddenTotal).toBe(0);
  });

  it('giỏ rỗng và trần tuỳ chọn', () => {
    expect(collapseCheckoutLines([], false)).toEqual({ shown: [], hiddenCount: 0, hiddenTotal: 0 });
    const r = collapseCheckoutLines(lines(4), false, 3);
    expect(r.shown).toHaveLength(3);
    expect(r.hiddenCount).toBe(1);
  });
});

describe('chữ thanh toán dùng chung', () => {
  it('khoá chốt cho cả hai app', () => {
    expect(fillCopy('checkout.totalPending')).toBe('Chưa tính');
    expect(fillCopy('checkout.shipNeedsAddress')).toBe('Nhập địa chỉ để tính phí');
    expect(fillCopy('checkout.calculating')).toBe('Đang tính…');
    expect(fillCopy('checkout.moreLines', { n: 2 })).toBe('Xem thêm 2 sản phẩm');
    expect(fillCopy('checkout.fewerLines')).toBe('Thu gọn');
    expect(fillCopy('checkout.placeWith', { price: '330.000đ' })).toBe('Đặt hàng · 330.000đ');
    expect(fillCopy('coupon.autoApplied')).toBe('Tubu đã tự áp mã tốt nhất');
    expect(fillCopy('checkout.invoiceIncomplete')).toBe('Bạn điền đủ MST, tên công ty, địa chỉ và email hợp lệ nhé.');
    expect(fillCopy('flash.priceChangedBody')).toBe('Vài sản phẩm Giờ vàng vừa hết suất hoặc hết giờ. Bạn xem lại giỏ trước khi đặt nhé.');
  });
});
