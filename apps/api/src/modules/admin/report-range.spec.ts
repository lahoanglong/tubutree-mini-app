import { BadRequestException } from '@nestjs/common';
import { resolveReportRange } from './report-range';

// 2026-10-18 03:00 giờ VN = 2026-10-17 20:00Z: ranh giới ngày VN khác UTC.
const NOW = new Date('2026-10-17T20:00:00Z');

describe('resolveReportRange', () => {
  it('mặc định 30 ngày kết thúc hôm nay theo giờ VN (cả hai đầu tính)', () => {
    const r = resolveReportRange(undefined, undefined, { maxDays: 366, now: NOW });
    expect(r).toMatchObject({ from: '2026-09-19', to: '2026-10-18', days: 30 });
    expect(r.start.toISOString()).toBe('2026-09-18T17:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-18T17:00:00.000Z');
  });

  it('chỉ có from: kết thúc hôm nay; chỉ có to: lùi 30 ngày', () => {
    expect(resolveReportRange('2026-10-01', undefined, { maxDays: 366, now: NOW })).toMatchObject({ from: '2026-10-01', to: '2026-10-18', days: 18 });
    expect(resolveReportRange(undefined, '2026-10-10', { maxDays: 366, now: NOW })).toMatchObject({ from: '2026-09-11', to: '2026-10-10', days: 30 });
  });

  it('một ngày: from = to', () => {
    const r = resolveReportRange('2026-10-05', '2026-10-05', { maxDays: 180, now: NOW });
    expect(r.days).toBe(1);
    expect(r.end.getTime() - r.start.getTime()).toBe(864e5);
  });

  it('đúng giới hạn thì nhận, quá một ngày thì từ chối', () => {
    expect(resolveReportRange('2026-04-22', '2026-10-18', { maxDays: 180, now: NOW }).days).toBe(180);
    expect(() => resolveReportRange('2026-04-21', '2026-10-18', { maxDays: 180, now: NOW })).toThrow(BadRequestException);
    expect(() => resolveReportRange('2025-10-17', '2026-10-17', { maxDays: 366, now: NOW })).not.toThrow();
    expect(() => resolveReportRange('2025-10-16', '2026-10-17', { maxDays: 366, now: NOW })).toThrow(/tối đa 366 ngày/);
  });

  it('from sau to bị từ chối', () => {
    expect(() => resolveReportRange('2026-10-10', '2026-10-09', { maxDays: 180, now: NOW })).toThrow(BadRequestException);
  });
});
