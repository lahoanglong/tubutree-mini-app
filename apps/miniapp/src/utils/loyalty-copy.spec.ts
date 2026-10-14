import { describe, it, expect } from 'vitest';
import { earnRuleLine, moneyShort, pointsToSpend, redeemRuleLine, tierThresholdLabel } from './loyalty-copy';

const RATES = { vndPerPoint: 10_000, vndPerPointRedeem: 1_000, maxRedeemPct: 0.2 };

// ENGAGE-21: trang Điểm Xanh không nói 10.000đ = 1 điểm hay mốc hạng tương ứng bao nhiêu tiền.
describe('moneyShort', () => {
  it.each([
    [5_000_000, '5 triệu'],
    [20_000_000, '20 triệu'],
    [1_500_000, '1,5 triệu'],
    [750_000, '750.000đ'],
    [0, '0đ'],
  ])('%d → %s', (n, text) => expect(moneyShort(n)).toBe(text));
});

describe('earnRuleLine / redeemRuleLine', () => {
  it('cách tích: cứ 10.000đ = 1 điểm, kèm hệ số hạng khi > 1', () => {
    expect(earnRuleLine(RATES, 1)).toBe('Cứ 10.000đ mua hàng = 1 điểm');
    expect(earnRuleLine(RATES, 1.2)).toBe('Cứ 10.000đ mua hàng = 1 điểm, nhân hệ số hạng ×1,2');
  });

  it('cách dùng: 1 điểm = 1.000đ, tối đa 20% giá trị đơn', () => {
    expect(redeemRuleLine(RATES)).toBe('1 điểm = 1.000đ khi dùng ở bước thanh toán (tối đa 20% giá trị đơn)');
  });

  it('trần 0% → không hứa dùng được ở thanh toán', () => {
    expect(redeemRuleLine({ ...RATES, maxRedeemPct: 0 })).toBe('1 điểm = 1.000đ khi đổi mã giảm giá');
  });
});

describe('pointsToSpend / tierThresholdLabel', () => {
  it('điểm → tiền mua hàng theo tỷ lệ cấu hình', () => {
    expect(pointsToSpend(500, RATES)).toBe(5_000_000);
    expect(pointsToSpend(500, { ...RATES, vndPerPoint: 12_000 })).toBe(6_000_000);
  });

  it('mốc hạng ưu tiên minSpending của hạng; thiếu thì quy từ điểm', () => {
    expect(tierThresholdLabel({ minPoints: 500, minSpending: 5_000_000 }, RATES)).toBe('từ 5 triệu mua hàng trong 12 tháng');
    expect(tierThresholdLabel({ minPoints: 2_000, minSpending: null }, RATES)).toBe('từ 20 triệu mua hàng trong 12 tháng');
  });

  it('hạng khởi đầu (0 điểm) → "hạng khởi đầu"', () => {
    expect(tierThresholdLabel({ minPoints: 0, minSpending: null }, RATES)).toBe('hạng khởi đầu');
  });

  it('API cũ chưa trả rates → chỉ nói theo điểm như trước', () => {
    expect(tierThresholdLabel({ minPoints: 500 }, undefined)).toBe('từ 500 điểm tích luỹ');
  });
});
