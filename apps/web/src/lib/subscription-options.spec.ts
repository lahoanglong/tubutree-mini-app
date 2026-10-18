import { describe, expect, it } from 'vitest';
import { addressText, formatVnDate, isStartDateAllowed, startDateRange, vnDateOf } from './subscription-options';

describe('ngày bắt đầu gói định kỳ (giờ Việt Nam)', () => {
  it('vnDateOf lấy ngày theo giờ VN, không theo múi giờ máy', () => {
    expect(vnDateOf(new Date('2026-10-10T18:00:00Z'))).toBe('2026-10-11');
    expect(vnDateOf(new Date('2026-10-10T16:59:59Z'))).toBe('2026-10-10');
  });

  it('khoảng hẹn: từ ngày mai tới 60 ngày tới, khớp API', () => {
    const now = new Date('2026-10-10T03:00:00Z');
    expect(startDateRange(now)).toEqual({ min: '2026-10-11', max: '2026-12-09' });
    expect(isStartDateAllowed('2026-10-10', now)).toBe(false);
    expect(isStartDateAllowed('2026-10-11', now)).toBe(true);
    expect(isStartDateAllowed('2026-12-09', now)).toBe(true);
    expect(isStartDateAllowed('2026-12-10', now)).toBe(false);
    expect(isStartDateAllowed('', now)).toBe(false);
  });

  it('formatVnDate + addressText', () => {
    expect(formatVnDate('2026-10-20')).toBe('20/10/2026');
    expect(addressText({ street: '12 Lý Thường Kiệt', ward: 'P.7', district: 'Q.10' })).toBe('12 Lý Thường Kiệt, P.7, Q.10');
  });
});
