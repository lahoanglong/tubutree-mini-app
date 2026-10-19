import { describe, expect, it } from 'vitest';
import { pointsForGoods as serverPointsForGoods } from '../../../api/src/modules/pricing/points-earn';
import { pointsEarnPreview, pointsForGoods } from './points-earn';

const RATES = { earnPct: 2, vndPerPointRedeem: 1 };

describe('pointsForGoods — cùng công thức với server (PricingService.calcPointsEarned)', () => {
  it('khớp hàm của server trên lưới giá trị hàng × mốc × hệ số hạng, gồm mốc làm tròn xuống và cấu hình hỏng', () => {
    for (const pct of [2, 1.5, 0.1, 20, 0, -5]) {
      for (const goods of [-1, 0, 1, 49, 50, 199_999, 249_999, 289_000, 1_000_000, 2_000_000_000]) {
        for (const mult of [undefined, 1, 1.1, 1.2, 1.5, 2, 0]) {
          expect(pointsForGoods(goods, pct, mult)).toBe(serverPointsForGoods(goods, pct, mult));
        }
      }
    }
  });
});

describe('pointsEarnPreview', () => {
  it('đủ số liệu: số điểm theo công thức server và giá trị quy đổi theo vnd_per_point_redeem', () => {
    expect(pointsEarnPreview(199_000, RATES, 1)).toEqual({ points: 3_980, valueVnd: 3_980 });
    expect(pointsEarnPreview(199_000, RATES, 1.2)).toEqual({ points: 4_776, valueVnd: 4_776 });
    expect(pointsEarnPreview(199_000, RATES, 1.5)).toEqual({ points: 5_970, valueVnd: 5_970 });
    expect(pointsEarnPreview(199_000, RATES, 2)).toEqual({ points: 7_960, valueVnd: 7_960 });
    expect(pointsEarnPreview(250_000, { earnPct: 2, vndPerPointRedeem: 0.5 }, 1)).toEqual({ points: 5_000, valueVnd: 2_500 });
  });

  it('chưa chắc con số (API cũ không trả mốc, hệ số hạng chưa biết, cấu hình hỏng): chỉ nói chung, không có số', () => {
    expect(pointsEarnPreview(250_000, undefined, 1)).toBe('generic');
    expect(pointsEarnPreview(250_000, RATES, null)).toBe('generic');
    expect(pointsEarnPreview(250_000, { vndPerPointRedeem: 1 }, 1)).toBe('generic');
    expect(pointsEarnPreview(250_000, { earnPct: 0, vndPerPointRedeem: 1 }, 1)).toBe('generic');
    expect(pointsEarnPreview(250_000, { earnPct: 2, vndPerPointRedeem: 0 }, 1)).toBe('generic');
    expect(pointsEarnPreview(250_000, { earnPct: Number.NaN, vndPerPointRedeem: 1 }, 1)).toBe('generic');
    expect(pointsEarnPreview(250_000, RATES, Number.NaN)).toBe('generic');
  });

  it('hàng quá rẻ để ra điểm nào, hoặc giá không hợp lệ: không hiện dòng nào (không hứa điều không có)', () => {
    expect(pointsEarnPreview(49, RATES, 1)).toBeNull();
    expect(pointsEarnPreview(0, RATES, 1)).toBeNull();
    expect(pointsEarnPreview(Number.NaN, RATES, 1)).toBeNull();
  });
});
