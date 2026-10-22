import { describe, expect, it } from 'vitest';
import { addressText, formatVnDate, isStartDateAllowed, nextRunAfterIntervalChange, startDateRange, SUBSCRIPTION_INTERVAL_WEEKS, vnDateOf } from './subscription-options';

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

describe('nextRunAfterIntervalChange: cùng luật với API (Q22)', () => {
  const now = new Date('2026-10-20T05:00:00.000Z');
  const sub = { intervalWeeks: 4, nextRunAt: '2026-11-07T03:00:00.000Z', lastOrderAt: '2026-10-10T03:00:00.000Z' };

  it('chu kỳ hợp lệ là 4/6/8/10 tuần', () => {
    expect([...SUBSCRIPTION_INTERVAL_WEEKS]).toEqual([4, 6, 8, 10]);
  });

  it('ACTIVE có đơn gần nhất: 0h VN của ngày đơn + chu kỳ mới', () => {
    expect(nextRunAfterIntervalChange(sub, 6, now)?.toISOString()).toBe('2026-11-20T17:00:00.000Z');
  });

  it('đơn cron ghi 03:00:00.200 giờ VN: vẫn neo 0h VN của ngày đơn', () => {
    expect(nextRunAfterIntervalChange({ ...sub, lastOrderAt: '2026-10-09T20:00:00.200Z' }, 6, now)?.toISOString()).toBe('2026-11-20T17:00:00.000Z');
  });

  it('mốc mới đã qua hoặc trong hôm nay: 0h ngày mai giờ VN', () => {
    expect(nextRunAfterIntervalChange({ ...sub, intervalWeeks: 10, lastOrderAt: '2026-08-01T03:00:00.000Z' }, 4, now)?.toISOString()).toBe('2026-10-20T17:00:00.000Z');
  });

  it('chưa có đơn nào: giữ ngày bắt đầu hiện có', () => {
    expect(nextRunAfterIntervalChange({ ...sub, lastOrderAt: null }, 8, now)?.toISOString()).toBe('2026-11-07T03:00:00.000Z');
  });

  it('chưa có đơn nào nhưng ngày bắt đầu đã qua: không hứa ngày', () => {
    expect(nextRunAfterIntervalChange({ ...sub, lastOrderAt: null, nextRunAt: '2026-10-01T03:00:00.000Z' }, 8, now)).toBeNull();
  });

  it('không tính được: cùng chu kỳ, hoặc API cũ chưa trả lastOrderAt', () => {
    expect(nextRunAfterIntervalChange(sub, 4, now)).toBeNull();
    expect(nextRunAfterIntervalChange({ ...sub, lastOrderAt: undefined }, 6, now)).toBeNull();
  });
});
