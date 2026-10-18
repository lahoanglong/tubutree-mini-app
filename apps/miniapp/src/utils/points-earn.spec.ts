import { describe, expect, it } from 'vitest';
import { pointsForGoods as serverPointsForGoods } from '../../../api/src/modules/pricing/points-earn';
import { pointsEarnPreview, pointsForGoods } from './points-earn';

const RATES = { vndPerPoint: 10_000, vndPerPointRedeem: 1_000 };

describe('pointsForGoods — cùng công thức với server (PricingService.calcPointsEarned)', () => {
  it('khớp hàm của server trên lưới giá trị hàng × mốc × hệ số hạng, gồm mốc làm tròn xuống và cấu hình hỏng', () => {
    for (const vnd of [10_000, 7_500, 1, 0, -5]) {
      for (const goods of [0, 1, 9_999, 10_000, 19_999, 20_000, 75_000, 249_999, 289_000, 1_000_000]) {
        for (const mult of [undefined, 1, 1.2, 1.5, 2]) {
          expect(pointsForGoods(goods, vnd, mult)).toBe(serverPointsForGoods(goods, vnd, mult));
        }
      }
    }
  });
});

describe('pointsEarnPreview', () => {
  it('đủ số liệu: số điểm theo công thức server và giá trị quy đổi theo vnd_per_point_redeem', () => {
    expect(pointsEarnPreview(250_000, RATES, 1)).toEqual({ points: 25, valueVnd: 25_000 });
    expect(pointsEarnPreview(250_000, RATES, 1.5)).toEqual({ points: 37, valueVnd: 37_000 });
    expect(pointsEarnPreview(250_000, { vndPerPoint: 10_000, vndPerPointRedeem: 500 }, 1)).toEqual({ points: 25, valueVnd: 12_500 });
  });

  it('chưa chắc con số (API cũ không trả mốc, hệ số hạng chưa biết, cấu hình hỏng): chỉ nói chung, không có số', () => {
    expect(pointsEarnPreview(250_000, undefined, 1)).toBe('generic');
    expect(pointsEarnPreview(250_000, RATES, null)).toBe('generic');
    expect(pointsEarnPreview(250_000, { vndPerPoint: 0, vndPerPointRedeem: 1_000 }, 1)).toBe('generic');
    expect(pointsEarnPreview(250_000, { vndPerPoint: 10_000, vndPerPointRedeem: 0 }, 1)).toBe('generic');
    expect(pointsEarnPreview(250_000, { vndPerPoint: Number.NaN, vndPerPointRedeem: 1_000 }, 1)).toBe('generic');
    expect(pointsEarnPreview(250_000, RATES, Number.NaN)).toBe('generic');
  });

  it('hàng quá rẻ để ra điểm nào, hoặc giá không hợp lệ: không hiện dòng nào (không hứa điều không có)', () => {
    expect(pointsEarnPreview(9_999, RATES, 1)).toBeNull();
    expect(pointsEarnPreview(0, RATES, 1)).toBeNull();
    expect(pointsEarnPreview(Number.NaN, RATES, 1)).toBeNull();
  });
});
