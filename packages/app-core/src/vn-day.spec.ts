import { describe, expect, it } from 'vitest';
import { vnDateRangeInvalid, vnDayEndIso, vnDayKeyOfIso, vnDayStartIso, vnPromoWindowIso } from './vn-day';

describe('vnDayStartIso / vnDayEndIso', () => {
  it('đầu ngày VN là 17:00 UTC hôm trước', () => expect(vnDayStartIso('2026-11-20')).toBe('2026-11-19T17:00:00.000Z'));
  it('cuối ngày VN là 16:59:59 UTC cùng ngày', () => expect(vnDayEndIso('2026-11-20')).toBe('2026-11-20T16:59:59.000Z'));
});

describe('vnDayKeyOfIso', () => {
  it('đổi ISO về ngày giờ VN, không phải ngày UTC', () => {
    expect(vnDayKeyOfIso('2026-11-19T17:00:00.000Z')).toBe('2026-11-20');
    expect(vnDayKeyOfIso('2026-11-20T16:59:59.000Z')).toBe('2026-11-20');
    expect(vnDayKeyOfIso('2026-11-20T17:00:00.000Z')).toBe('2026-11-21');
  });
  it('rỗng hoặc sai về chuỗi rỗng', () => {
    expect(vnDayKeyOfIso(null)).toBe('');
    expect(vnDayKeyOfIso('abc')).toBe('');
  });
  it('khứ hồi với hai hàm trên', () => {
    expect(vnDayKeyOfIso(vnDayStartIso('2026-03-01'))).toBe('2026-03-01');
    expect(vnDayKeyOfIso(vnDayEndIso('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('vnPromoWindowIso', () => {
  const NOW = Date.parse('2026-10-19T00:00:00Z');
  it('bắt đầu bằng kết thúc vẫn là một khung dương', () => {
    expect(vnPromoWindowIso('2026-11-20', '2026-11-20', NOW)).toEqual({ startAt: '2026-11-19T17:00:00.000Z', endAt: '2026-11-20T16:59:59.000Z' });
  });
  it('kết thúc trống = bắt đầu + 30 ngày; bắt đầu trống = bây giờ', () => {
    const w = vnPromoWindowIso('2027-03-01', '', NOW);
    expect(Date.parse(w.endAt) - Date.parse(w.startAt)).toBe(30 * 864e5);
    expect(vnPromoWindowIso('', '2026-12-01', NOW).startAt).toBe(new Date(NOW).toISOString());
  });
});

describe('vnDateRangeInvalid', () => {
  const NOW = Date.parse('2026-10-19T00:00:00Z');
  it('cho phép bắt đầu bằng kết thúc, chặn kết thúc trước bắt đầu', () => {
    expect(vnDateRangeInvalid('2026-11-20', '2026-11-20', NOW)).toBe(false);
    expect(vnDateRangeInvalid('2026-11-20', '2026-11-19', NOW)).toBe(true);
  });
  it('không có ngày kết thúc thì hợp lệ', () => expect(vnDateRangeInvalid('2026-11-20', '', NOW)).toBe(false));
  it('chỉ có kết thúc: so cuối ngày VN với bây giờ', () => {
    const endOfDay = Date.parse('2026-11-20T16:59:59Z');
    expect(vnDateRangeInvalid('', '2026-11-20', endOfDay - 1000)).toBe(false);
    expect(vnDateRangeInvalid('', '2026-11-20', endOfDay + 1000)).toBe(true);
    // 08:00 sáng VN ngày kết thúc: ngày hôm nay vẫn hợp lệ (cũ so 00:00 UTC nên sai từ 07:00).
    expect(vnDateRangeInvalid('', '2026-11-20', Date.parse('2026-11-20T01:00:00Z'))).toBe(false);
  });
});
