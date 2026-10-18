import { describe, expect, it } from 'vitest';
import { pointsRulesNote } from './points-rules-note';

describe('pointsRulesNote', () => {
  it('nói đúng trần % trên giá trị hàng, phí ship và hạn điểm theo cấu hình', () => {
    expect(pointsRulesNote({ maxRedeemPct: 0.2, pointExpireMonths: 12 })).toBe(
      'Dùng tối đa 20% giá trị hàng trong đơn, không trừ vào phí ship. Điểm thường hết hạn sau 12 tháng.',
    );
  });
  it('bỏ vế thiếu cấu hình, không bịa số', () => {
    expect(pointsRulesNote({ maxRedeemPct: 0.2 })).toBe('Dùng tối đa 20% giá trị hàng trong đơn, không trừ vào phí ship.');
    expect(pointsRulesNote({ pointExpireMonths: 6 })).toBe('Điểm thường hết hạn sau 6 tháng.');
    expect(pointsRulesNote(undefined)).toBeNull();
    expect(pointsRulesNote({ maxRedeemPct: 0, pointExpireMonths: 0 })).toBeNull();
  });
});
