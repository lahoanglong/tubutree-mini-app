import { describe, expect, it } from 'vitest';
import { promoDateRangeInvalid, promoFormDates, promoWindow } from './brand-owner-promo';

describe('khuyến mãi chủ nhãn theo ngày giờ Việt Nam (TZ-02)', () => {
  it('promoWindow: đầu ngày bắt đầu, cuối ngày kết thúc theo +07:00', () => {
    expect(promoWindow({ startAt: '2026-11-20', endAt: '2026-11-20' }, 0)).toEqual({ startAt: '2026-11-19T17:00:00.000Z', endAt: '2026-11-20T16:59:59.000Z' });
  });
  it('promoFormDates đổi ngược ra ngày VN', () => {
    expect(promoFormDates({ startAt: '2026-11-19T17:00:00.000Z', endAt: '2026-11-20T16:59:59.000Z' })).toEqual({ startAt: '2026-11-20', endAt: '2026-11-20' });
    expect(promoFormDates({ startAt: null, endAt: undefined })).toEqual({ startAt: '', endAt: '' });
  });
  it('promoDateRangeInvalid: cùng ngày hợp lệ, kết thúc trước bắt đầu sai, chỉ kết thúc hôm nay hợp lệ', () => {
    expect(promoDateRangeInvalid({ startAt: '2026-11-20', endAt: '2026-11-20' })).toBe(false);
    expect(promoDateRangeInvalid({ startAt: '2026-11-20', endAt: '2026-11-19' })).toBe(true);
    expect(promoDateRangeInvalid({ startAt: '', endAt: '2026-11-20' }, Date.parse('2026-11-20T01:00:00Z'))).toBe(false);
    expect(promoDateRangeInvalid({ startAt: '', endAt: '2026-11-20' }, Date.parse('2026-11-20T17:00:00Z'))).toBe(true);
  });
});
