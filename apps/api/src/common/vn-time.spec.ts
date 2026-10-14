import { formatVnDate, formatVnDateTime, startOfVnDay, startOfVnMonth, vnDateParts, vnMonthKey } from './vn-time';

// Jest chạy với TZ=UTC (test/jest-global-utc.js) nên các phép tính dưới đây chỉ đúng nếu helper
// thật sự tính theo lịch VN chứ không theo giờ local.
describe('vn-time (lịch giờ VN, độc lập TZ host)', () => {
  it('host đang chạy UTC (điều kiện của test)', () => {
    expect(new Date('2026-03-09T18:30:00Z').getDate()).toBe(9);
  });

  it('startOfVnDay: 01:30 ngày 10/3 giờ VN → 00:00 ngày 10/3 VN', () => {
    expect(startOfVnDay(new Date('2026-03-09T18:30:00Z')).toISOString()).toBe('2026-03-09T17:00:00.000Z');
    expect(startOfVnDay(new Date('2026-03-09T16:59:00Z')).toISOString()).toBe('2026-03-08T17:00:00.000Z');
  });

  it('startOfVnMonth, vnMonthKey, vnDateParts qua ranh giới tháng theo giờ VN', () => {
    const d = new Date('2026-09-30T20:00:00Z'); // 03:00 ngày 1/10 giờ VN
    expect(startOfVnMonth(d).toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(vnMonthKey(d)).toBe('2026-10');
    expect(vnDateParts(d)).toEqual({ year: 2026, month: 10, day: 1 });
  });

  it('formatVnDate: hạn 00:00 ngày 10/10 VN hiển thị 10/10/2026, không lùi về 9/10', () => {
    expect(formatVnDate(new Date('2026-10-09T17:00:00Z'))).toBe('10/10/2026');
  });

  it('formatVnDateTime: hạn thanh toán "HH:mm dd/MM/yyyy" theo giờ VN', () => {
    expect(formatVnDateTime(new Date('2026-10-13T17:05:00Z'))).toBe('00:05 14/10/2026');
    expect(formatVnDateTime(new Date('2026-01-02T03:04:00Z'))).toBe('10:04 02/01/2026');
  });
});
