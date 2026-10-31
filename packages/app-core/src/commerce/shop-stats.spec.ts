import { describe, expect, it } from 'vitest';
import { shopStats } from './shop-stats';

describe('shopStats', () => {
  it('ba số: sản phẩm, đánh giá, đã bán', () => {
    expect(shopStats({ productCount: 124, ratingAvg: 4.8, sold: 1234 })).toEqual([
      { label: 'Sản phẩm', value: '124', spoken: '124 sản phẩm' },
      { label: 'Đánh giá', value: '4,8', spoken: '4,8 sao' },
      { label: 'Đã bán', value: '1,2k+', spoken: 'Đã bán hơn 1.200' },
    ]);
  });

  it('bản đọc số bán: dưới 1000 nguyên số, từ 1 triệu theo trăm nghìn', () => {
    expect(shopStats({ productCount: 1, sold: 12 }).find((s) => s.label === 'Đã bán')).toEqual({ label: 'Đã bán', value: '12', spoken: 'Đã bán 12' });
    expect(shopStats({ productCount: 1, sold: 2_500_000 }).find((s) => s.label === 'Đã bán')?.spoken).toBe('Đã bán hơn 2.500.000');
  });

  it('thiếu hoặc không dương thì bỏ mục đó, không in "★ NaN" hay "Đã bán 0"', () => {
    expect(shopStats({ productCount: 5 }).map((s) => s.label)).toEqual(['Sản phẩm']);
    expect(shopStats({ productCount: 5, ratingAvg: 0, sold: 0 }).map((s) => s.label)).toEqual(['Sản phẩm']);
    expect(shopStats({ productCount: 5, ratingAvg: Number.NaN, sold: null }).map((s) => s.label)).toEqual(['Sản phẩm']);
  });

  it('gian hàng chưa có sản phẩm vẫn hiện mục Sản phẩm là 0', () => {
    expect(shopStats({ productCount: 0 })).toEqual([{ label: 'Sản phẩm', value: '0', spoken: '0 sản phẩm' }]);
  });
});
