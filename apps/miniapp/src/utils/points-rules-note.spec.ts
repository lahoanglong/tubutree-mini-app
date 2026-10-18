import { describe, expect, it } from 'vitest';
import { pointsRulesNote } from './points-rules-note';

describe('pointsRulesNote', () => {
  it('nói đúng trần % trên giá trị hàng, phí ship và hạn điểm theo cấu hình', () => {
    expect(pointsRulesNote({ maxRedeemPct: 0.2, pointExpireMonths: 12 })).toBe(
      'Điểm Xanh thường dùng tối đa 20% giá trị hàng Tubu trong đơn, không trừ vào phí ship. Điểm Xanh thường có hạn 12 tháng kể từ ngày nhận, điểm cũ được dùng trước.',
    );
  });
  it('bỏ vế thiếu cấu hình, không bịa số', () => {
    expect(pointsRulesNote({ maxRedeemPct: 0.2 })).toBe('Điểm Xanh thường dùng tối đa 20% giá trị hàng Tubu trong đơn, không trừ vào phí ship.');
    expect(pointsRulesNote({ pointExpireMonths: 6 })).toBe('Điểm Xanh thường có hạn 6 tháng kể từ ngày nhận, điểm cũ được dùng trước.');
    expect(pointsRulesNote(undefined)).toBeNull();
    expect(pointsRulesNote({ maxRedeemPct: 0, pointExpireMonths: 0 })).toBeNull();
  });
});
