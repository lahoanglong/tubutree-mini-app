import { describe, expect, it } from 'vitest';
import {
  addDaysKey,
  currentVnYearMonth,
  dayOfMonth,
  dowLabel,
  hhmmToMin,
  isoToVnHHMM,
  keyToUtcMidnightISO,
  minToHHMM,
  mondayKeyOf,
  shiftYearMonth,
  shortDayLabel,
  vnDateKey,
  vnDateTimeISO,
  weekDayKeys,
} from './week';

describe('mốc tuần giờ VN (cùng số với utils/week.ts của Mini App)', () => {
  it('ngày VN lệch 7 tiếng so với UTC: 18:00Z ngày 10 đã là ngày 11 ở VN', () => {
    expect(vnDateKey(new Date('2026-03-10T18:00:00Z'))).toBe('2026-03-11');
    expect(vnDateKey(new Date('2026-03-10T16:59:00Z'))).toBe('2026-03-10');
  });

  it('thứ 2 của tuần chứa ngày: Chủ nhật thuộc tuần trước, 7 ngày liền nhau', () => {
    expect(mondayKeyOf(new Date('2026-03-11T05:00:00Z'))).toBe('2026-03-09');
    expect(mondayKeyOf(new Date('2026-03-15T05:00:00Z'))).toBe('2026-03-09');
    expect(mondayKeyOf(new Date('2026-03-16T05:00:00Z'))).toBe('2026-03-16');
    expect(weekDayKeys('2026-03-09')).toEqual(['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15']);
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('mốc gửi API và đổi giờ', () => {
    expect(keyToUtcMidnightISO('2026-03-09')).toBe('2026-03-09T00:00:00.000Z');
    expect(vnDateTimeISO('2026-03-11', '08:00')).toBe('2026-03-11T01:00:00.000Z');
    expect(isoToVnHHMM('2026-03-11T01:30:00.000Z')).toBe('08:30');
    expect(minToHHMM(480)).toBe('08:00');
    expect(hhmmToMin('13:30')).toBe(810);
  });

  it('nhãn ngày và tháng', () => {
    expect(shortDayLabel('2026-03-09')).toBe('09/03');
    expect(dayOfMonth('2026-03-09')).toBe('09');
    expect(dowLabel('2026-03-09')).toBe('T2');
    expect(dowLabel('2026-03-15')).toBe('CN');
    expect(shiftYearMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftYearMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(currentVnYearMonth().month).toBeGreaterThanOrEqual(1);
  });
});
