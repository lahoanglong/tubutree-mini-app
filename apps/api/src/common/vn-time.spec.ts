import { formatVnDate, formatVnDateTime, startOfVnDay, startOfNextVnMonth, startOfVnMonth, startOfVnWeek, startOfNextVnWeek, vnDateParts, vnMonthKey } from './vn-time';

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

  it('startOfNextVnMonth: đầu tháng VN kế tiếp, qua ranh giới tháng và năm', () => {
    expect(startOfNextVnMonth(new Date('2026-10-15T00:00:00Z')).toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(startOfNextVnMonth(new Date('2026-09-30T20:00:00Z')).toISOString()).toBe('2026-10-31T17:00:00.000Z'); // 03:00 1/10 VN
    expect(startOfNextVnMonth(new Date('2026-09-30T16:59:00Z')).toISOString()).toBe('2026-09-30T17:00:00.000Z'); // 23:59 30/9 VN
    expect(startOfNextVnMonth(new Date('2026-12-31T16:59:00Z')).toISOString()).toBe('2026-12-31T17:00:00.000Z');
    expect(startOfNextVnMonth(new Date('2026-12-31T17:00:00Z')).toISOString()).toBe('2027-01-31T17:00:00.000Z'); // 00:00 1/1/2027 VN
    expect(startOfNextVnMonth(new Date('2026-12-10T00:00:00Z')).toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('startOfVnWeek / startOfNextVnWeek: thứ Hai 00:00 VN, Chủ nhật 23:59 vẫn thuộc tuần cũ', () => {
    expect(startOfVnWeek(new Date('2026-10-25T16:59:59Z')).toISOString()).toBe('2026-10-18T17:00:00.000Z'); // CN 23:59:59 VN
    expect(startOfVnWeek(new Date('2026-10-25T17:00:00Z')).toISOString()).toBe('2026-10-25T17:00:00.000Z'); // T2 00:00 VN
    expect(startOfVnWeek(new Date('2026-10-28T05:00:00Z')).toISOString()).toBe('2026-10-25T17:00:00.000Z'); // T4
    expect(startOfNextVnWeek(new Date('2026-10-25T16:59:59Z')).toISOString()).toBe('2026-10-25T17:00:00.000Z');
    expect(startOfVnWeek(new Date('2026-12-31T20:00:00Z')).toISOString()).toBe('2026-12-27T17:00:00.000Z'); // qua năm
  });

  it('formatVnDate: hạn 00:00 ngày 10/10 VN hiển thị 10/10/2026, không lùi về 9/10', () => {
    expect(formatVnDate(new Date('2026-10-09T17:00:00Z'))).toBe('10/10/2026');
  });

  it('formatVnDateTime: hạn thanh toán "HH:mm dd/MM/yyyy" theo giờ VN', () => {
    expect(formatVnDateTime(new Date('2026-10-13T17:05:00Z'))).toBe('00:05 14/10/2026');
    expect(formatVnDateTime(new Date('2026-01-02T03:04:00Z'))).toBe('10:04 02/01/2026');
  });
});
