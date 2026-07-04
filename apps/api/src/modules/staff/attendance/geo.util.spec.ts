import { haversineMeters } from './geo.util';

describe('haversineMeters', () => {
  it('cùng điểm → 0', () => {
    expect(haversineMeters(10.77, 106.7, 10.77, 106.7)).toBe(0);
  });

  it('~1 vĩ độ ≈ 111km (±1%)', () => {
    const d = haversineMeters(10, 106, 11, 106);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });

  it('2 điểm gần (~100m) trong khoảng hợp lý', () => {
    // ~0.0009 độ vĩ ≈ 100m
    const d = haversineMeters(10.7769, 106.7009, 10.7778, 106.7009);
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(110);
  });
});
