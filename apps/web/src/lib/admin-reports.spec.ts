import { describe, it, expect } from 'vitest';
import { addDaysKey, lastDaysRange, pivotRevenue, rangeDays, rangeError, vnTodayKey } from './admin-reports';

describe('khoảng ngày giờ VN', () => {
  it('hôm nay theo giờ VN, không theo UTC: 20:00Z ngày 17 đã là ngày 18 ở VN', () => {
    expect(vnTodayKey(new Date('2026-10-17T20:00:00Z'))).toBe('2026-10-18');
    expect(vnTodayKey(new Date('2026-10-17T16:59:59Z'))).toBe('2026-10-17');
  });

  it('30 ngày gần nhất tính cả hai đầu', () => {
    const r = lastDaysRange(30, new Date('2026-10-17T20:00:00Z'));
    expect(r).toEqual({ from: '2026-09-19', to: '2026-10-18' });
    expect(rangeDays(r.from, r.to)).toBe(30);
  });

  it('cộng ngày qua ranh giới tháng và năm', () => {
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it.each([
    ['2026-10-10', '2026-10-09', 366, 'trước hoặc bằng'],
    ['', '2026-10-09', 366, 'Chọn đủ'],
    ['2026-01-01', '2026-10-18', 180, 'tối đa 180 ngày'],
  ])('rangeError(%s, %s, %i) có lỗi "%s"', (from, to, max, text) => {
    expect(rangeError(from, to, max)).toContain(text);
  });

  it('khoảng hợp lệ không có lỗi, đúng giới hạn vẫn nhận', () => {
    expect(rangeError('2026-10-01', '2026-10-18', 180)).toBeNull();
    expect(rangeError('2026-04-22', '2026-10-18', 180)).toBeNull();
  });
});

describe('pivotRevenue', () => {
  it('ngày mới nhất trước, kênh nhiều tiền nhất trước, tổng hàng = tổng cột = tổng chung', () => {
    const p = pivotRevenue({
      byChannel: [
        { key: 'dealer', label: 'Đại lý' },
        { key: 'checkout', label: 'Giỏ hàng' },
      ],
      byDay: [
        { day: '2026-10-01', channel: 'checkout', revenue: 100, orders: 2 },
        { day: '2026-10-02', channel: 'dealer', revenue: 5000, orders: 1 },
        { day: '2026-10-02', channel: 'checkout', revenue: 50, orders: 1 },
      ],
    });
    expect(p.columns.map((c) => c.key)).toEqual(['dealer', 'checkout']);
    expect(p.rows.map((r) => r.day)).toEqual(['2026-10-02', '2026-10-01']);
    expect(p.rows[0]).toMatchObject({ total: 5050, orders: 2, cells: { dealer: 5000, checkout: 50 } });
    expect(p.columnTotals).toEqual({ dealer: 5000, checkout: 150 });
    expect(p.grandTotal).toBe(5150);
    expect(p.rows.reduce((s, r) => s + r.total, 0)).toBe(p.grandTotal);
  });

  it('không có dữ liệu: bảng rỗng', () => {
    expect(pivotRevenue({ byChannel: [], byDay: [] })).toEqual({ columns: [], rows: [], columnTotals: {}, grandTotal: 0 });
  });
});
