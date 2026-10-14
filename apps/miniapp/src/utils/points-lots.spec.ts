import { describe, it, expect } from 'vitest';
import { convertedPointsNote, expiringPointsNote, pointExpiryPolicyNote, pointsSummary } from './points-lots';

describe('pointsSummary / convertedPointsNote (PD-3: hai lô Điểm Xanh, khách chỉ thấy một số)', () => {
  it('tổng = lô thường + lô quy đổi; tách riêng phần không hết hạn', () => {
    expect(pointsSummary({ pointsBalance: 120, pointsConvertedBalance: 40 })).toEqual({ standard: 120, converted: 40, total: 160 });
  });

  it('API chưa trả lô quy đổi → coi như 0 (không NaN)', () => {
    expect(pointsSummary({ pointsBalance: 120 })).toEqual({ standard: 120, converted: 0, total: 120 });
  });

  it('số âm/rác bị kẹp 0', () => {
    expect(pointsSummary({ pointsBalance: -5, pointsConvertedBalance: -1 })).toEqual({ standard: 0, converted: 0, total: 0 });
  });

  it('ghi chú phần không hết hạn có dấu nghìn; không có điểm quy đổi thì không hiện gì', () => {
    expect(convertedPointsNote(1_250)).toBe('trong đó 1.250 điểm không hết hạn');
    expect(convertedPointsNote(0)).toBeNull();
    expect(convertedPointsNote(undefined)).toBeNull();
  });
});

describe('expiringPointsNote / pointExpiryPolicyNote (R2-ENGAGE-8)', () => {
  const NOW = new Date('2026-10-14T03:00:00.000Z');

  it('nói rõ số điểm và ngày hết hạn gần nhất; xa hơn 30 ngày thì không báo gấp', () => {
    expect(expiringPointsNote({ amount: 1_250, expiresAt: '2027-02-01T03:00:00.000Z' }, NOW)).toEqual({
      text: '1.250 điểm Xanh sẽ hết hạn ngày 01/02/2027',
      urgent: false,
    });
  });

  it('trong 30 ngày tới: báo gấp kèm số ngày còn lại', () => {
    expect(expiringPointsNote({ amount: 70, expiresAt: '2026-10-20T03:00:00.000Z' }, NOW)).toEqual({
      text: '70 điểm Xanh sẽ hết hạn ngày 20/10/2026 (còn 6 ngày)',
      urgent: true,
    });
  });

  it('không có điểm sắp hết hạn, số lượng 0 hoặc ngày hỏng → null', () => {
    expect(expiringPointsNote(null, NOW)).toBeNull();
    expect(expiringPointsNote(undefined, NOW)).toBeNull();
    expect(expiringPointsNote({ amount: 0, expiresAt: '2026-10-20T03:00:00.000Z' }, NOW)).toBeNull();
    expect(expiringPointsNote({ amount: 5, expiresAt: 'oops' }, NOW)).toBeNull();
  });

  it('chính sách hạn điểm theo số tháng cấu hình; API cũ chưa trả thì không hiện', () => {
    expect(pointExpiryPolicyNote(12)).toBe('Điểm Xanh thường có hạn 12 tháng kể từ ngày nhận, điểm cũ được dùng trước.');
    expect(pointExpiryPolicyNote(undefined)).toBeNull();
    expect(pointExpiryPolicyNote(0)).toBeNull();
  });
});
