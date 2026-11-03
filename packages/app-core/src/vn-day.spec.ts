import { describe, expect, it } from 'vitest';
import { vnDateRangeError, vnDateRangeInvalid, vnDayEndIso, vnDayKeyOfIso, vnDayStartIso, vnPromoWindowIso } from './vn-day';

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
  it('kết thúc trống = cuối ngày VN thứ 30 tính cả ngày bắt đầu; bắt đầu trống = bây giờ', () => {
    expect(vnPromoWindowIso('2027-03-01', '', NOW)).toEqual({ startAt: '2027-02-28T17:00:00.000Z', endAt: '2027-03-30T16:59:59.000Z' });
    // 07:00 VN 19/10 + 30 ngày rơi vào 18/11 VN → hết ngày 18/11.
    expect(vnPromoWindowIso('', '', NOW)).toEqual({ startAt: '2026-10-19T00:00:00.000Z', endAt: '2026-11-18T16:59:59.000Z' });
    expect(vnPromoWindowIso('', '2026-12-01', NOW).startAt).toBe(new Date(NOW).toISOString());
  });
  it.each([['2026-11-20', ''], ['', ''], ['2026-12-31', '']])('mở sửa rồi lưu lại không đổi khung (bắt đầu %j, kết thúc %j)', (startKey, endKey) => {
    const saved = vnPromoWindowIso(startKey, endKey, NOW);
    const again = vnPromoWindowIso(startKey || vnDayKeyOfIso(saved.startAt), vnDayKeyOfIso(saved.endAt), NOW);
    expect(again.endAt).toBe(saved.endAt);
  });
});

describe('vnDateRangeError', () => {
  const NOW = Date.parse('2026-10-19T00:00:00Z');
  it('nói đúng lý do', () => {
    expect(vnDateRangeError('2026-11-20', '2026-11-19', NOW)).toBe('Ngày kết thúc không được trước ngày bắt đầu.');
    expect(vnDateRangeError('', '2026-10-18', NOW)).toBe('Ngày kết thúc đã qua.');
    expect(vnDateRangeError('2026-11-20', '2026-11-20', NOW)).toBeNull();
  });
  it('kết thúc sai định dạng thì không chặn (ô ngày chỉ cho yyyy-mm-dd hoặc rỗng)', () => {
    expect(vnDateRangeError('2026-11-20', '2026-11', NOW)).toBeNull();
    expect(vnDateRangeError('', 'abc', NOW)).toBeNull();
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
