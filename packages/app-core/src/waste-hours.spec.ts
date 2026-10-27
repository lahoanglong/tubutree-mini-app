import { describe, expect, it } from 'vitest';
import { hasOpeningHours, openingStatus, todayHoursText } from './waste-hours';

// 2026-10-26 là thứ hai. Giờ VN = UTC+7.
const vn = (iso: string) => new Date(`${iso}+07:00`);
const HOURS = { MON: [{ open: '08:00', close: '12:00' }, { open: '13:30', close: '20:00' }], TUE: [{ open: '08:00', close: '20:00' }], FRI: [{ open: '09:00', close: '17:00' }] };

describe('openingStatus', () => {
  it('chưa có giờ nào thì không khẳng định mở hay đóng', () => {
    expect(openingStatus({}, vn('2026-10-26T10:00:00'))).toEqual({ open: null, text: 'Chưa cập nhật giờ mở cửa' });
    expect(openingStatus({ MON: [] }, vn('2026-10-26T10:00:00')).open).toBeNull();
  });
  it('đang mở thì ghi giờ đóng', () => {
    expect(openingStatus(HOURS, vn('2026-10-26T10:00:00'))).toEqual({ open: true, text: 'Đang mở, đến 12:00' });
  });
  it('nghỉ trưa: hôm nay mở lại lúc 13:30', () => {
    expect(openingStatus(HOURS, vn('2026-10-26T12:30:00'))).toEqual({ open: false, text: 'Đang đóng, mở lúc 13:30 hôm nay' });
  });
  it('hết giờ: mở lại ngày mai', () => {
    expect(openingStatus(HOURS, vn('2026-10-26T21:00:00'))).toEqual({ open: false, text: 'Đang đóng, mở lại 8:00 ngày mai' });
  });
  it('bỏ qua ngày nghỉ, ghi tên thứ', () => {
    expect(openingStatus(HOURS, vn('2026-10-28T10:00:00'))).toEqual({ open: false, text: 'Đang đóng, mở lại 9:00 Thứ sáu' });
  });
  it('giờ đóng là điểm cuối, không còn mở', () => {
    expect(openingStatus(HOURS, vn('2026-10-27T20:00:00')).open).toBe(false);
  });
  it('tính theo giờ VN dù máy ở múi giờ khác (UTC 18:00 = 01:00 VN hôm sau)', () => {
    expect(openingStatus(HOURS, new Date('2026-10-26T18:00:00Z')).text).toBe('Đang đóng, mở lúc 8:00 hôm nay');
  });
});

describe('todayHoursText', () => {
  it('nối các khung giờ, ngày không có khung là nghỉ, chưa có giờ thì null', () => {
    expect(todayHoursText(HOURS, vn('2026-10-26T10:00:00'))).toBe('Hôm nay 8:00–12:00, 13:30–20:00');
    expect(todayHoursText(HOURS, vn('2026-10-28T10:00:00'))).toBe('Hôm nay nghỉ');
    expect(todayHoursText({}, vn('2026-10-26T10:00:00'))).toBeNull();
    expect(hasOpeningHours(HOURS)).toBe(true);
  });
});
