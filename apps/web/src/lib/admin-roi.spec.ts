import { describe, expect, it } from 'vitest';
import { campaignRoiText, couponRoiText } from './admin-roi';

describe('campaignRoiText', () => {
  it('đủ bốn số: lượt xem, lượt chạm banner, đơn dùng mã, doanh thu; số lớn có dấu chấm ngăn nghìn', () => {
    expect(campaignRoiText({ views: 1234, clicks: 56, ordersCount: 4, gmv: 1_000_000 })).toBe('1.234 lượt xem · 56 lượt chạm banner · 4 đơn dùng mã · 1.000.000đ');
  });

  it('chiến dịch mới chưa có gì: vẫn hiện bốn số 0 (máy chủ đã tính, không phải thiếu dữ liệu)', () => {
    expect(campaignRoiText({ views: 0, clicks: 0, ordersCount: 0, gmv: 0 })).toBe('0 lượt xem · 0 lượt chạm banner · 0 đơn dùng mã · 0đ');
  });

  it('máy chủ bản cũ chưa trả số liệu: không có dòng, không hiện số 0 giả', () => {
    expect(campaignRoiText({})).toBeNull();
  });

  it('thiếu một vài trường (máy chủ trả dở): trường thiếu tính 0, dòng vẫn hiện', () => {
    expect(campaignRoiText({ views: 9 })).toBe('9 lượt xem · 0 lượt chạm banner · 0 đơn dùng mã · 0đ');
  });
});

describe('couponRoiText', () => {
  it('có đơn: số đơn, doanh thu, tiền giảm, trung bình một đơn', () => {
    expect(couponRoiText({ ordersCount: 4, gmv: 1_000_000, discountCost: 80_000, avgOrderValue: 250_000 })).toBe(
      '4 đơn · doanh thu 1.000.000đ · giảm 80.000đ · trung bình 250.000đ/đơn',
    );
  });

  it('mã miễn phí giao hàng: bỏ phần "giảm" (tiền ship được miễn không lưu trên đơn nên luôn 0đ)', () => {
    expect(couponRoiText({ type: 'FREESHIP', ordersCount: 12, gmv: 2_400_000, discountCost: 0, avgOrderValue: 200_000 })).toBe(
      '12 đơn · doanh thu 2.400.000đ · trung bình 200.000đ/đơn',
    );
  });

  it('chưa có đơn: một câu ngắn thay hàng số 0', () => {
    expect(couponRoiText({ ordersCount: 0, gmv: 0, discountCost: 0, avgOrderValue: 0 })).toBe('Chưa có đơn dùng mã');
  });

  it('máy chủ bản cũ chưa trả số liệu: không có dòng', () => {
    expect(couponRoiText({})).toBeNull();
  });
});
