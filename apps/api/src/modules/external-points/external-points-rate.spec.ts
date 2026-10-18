import { maskClaimCode, claimPoints } from './external-points-rate';
import { pointsForGoods } from '../pricing/points-earn';

describe('claimPoints (đơn sàn: phần trăm, hệ số 1, làm tròn xuống)', () => {
  it('1% của 199.000 là 1.990 điểm; không áp hệ số hạng', () => {
    expect(claimPoints(199_000, 1, 1)).toBe(1_990);
    expect(claimPoints(199_000, 1, 1.2)).toBe(2_388);
  });
  it('biên làm tròn xuống: 99 đ ở 1% là 0; 100 đ là 1; 150 đ là 1', () => {
    expect(claimPoints(99, 1)).toBe(0);
    expect(claimPoints(100, 1)).toBe(1);
    expect(claimPoints(150, 1)).toBe(1);
    expect(claimPoints(199, 1)).toBe(1);
  });
  it('goodsValue null hoặc không dương thì không tính được: null', () => {
    expect(claimPoints(null, 1)).toBeNull();
    expect(claimPoints(0, 1)).toBeNull();
    expect(claimPoints(-5, 1)).toBeNull();
  });
  it('tỉ lệ 0 hay hỏng cho 0 điểm', () => {
    expect(claimPoints(1_000_000, 0)).toBe(0);
    expect(claimPoints(1_000_000, Number.NaN)).toBe(0);
  });
  it('khớp pointsForGoods với hệ số 1 trên lưới giá trị', () => {
    for (const g of [1, 99, 100, 101, 12_345, 199_000, 2_000_001, 999_999_999]) {
      for (const pct of [0.5, 1, 1.5, 2]) expect(claimPoints(g, pct)).toBe(pointsForGoods(g, pct, 1));
    }
  });
});

describe('maskClaimCode', () => {
  it('che phần giữa, giữ 3 ký tự đầu và cuối', () => {
    expect(maskClaimCode('SPXVN0123456789')).toBe('SPX*********789');
  });
  it('mã ngắn chỉ giữ ký tự đầu', () => {
    expect(maskClaimCode('ABCDEF')).toBe('A*****');
  });
  it('null cho chuỗi rỗng', () => {
    expect(maskClaimCode(null)).toBe('');
  });
});
