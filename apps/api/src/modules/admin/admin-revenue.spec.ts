import { foldRevenueRows, type RevenueRow } from './admin-revenue';

const row = (over: Partial<RevenueRow>): RevenueRow => ({
  day: '2026-10-01',
  channel: 'checkout',
  platform: 'miniapp',
  orders: 0,
  cancelled: 0,
  paidOrders: 0,
  gross: 0,
  partialRefund: 0,
  gmv: 0,
  ...over,
});

describe('foldRevenueRows', () => {
  it('doanh thu = thu được trừ hoàn một phần; gộp theo ngày × kênh, theo kênh, theo nền tảng và tổng', () => {
    const r = foldRevenueRows([
      row({ day: '2026-10-01', channel: 'checkout', platform: 'miniapp', orders: 3, cancelled: 1, paidOrders: 2, gross: 300_000, partialRefund: 50_000, gmv: 320_000 }),
      row({ day: '2026-10-01', channel: 'checkout', platform: 'web', orders: 1, paidOrders: 1, gross: 100_000, gmv: 100_000 }),
      row({ day: '2026-10-01', channel: 'storefront', platform: 'miniapp', orders: 1, paidOrders: 1, gross: 80_000, gmv: 80_000 }),
      row({ day: '2026-10-02', channel: 'storefront', platform: 'miniapp', orders: 2, cancelled: 2 }),
    ]);
    expect(r.byDay).toEqual([
      { day: '2026-10-01', channel: 'checkout', orders: 4, cancelled: 1, paidOrders: 3, gross: 400_000, partialRefund: 50_000, revenue: 350_000, gmv: 420_000 },
      { day: '2026-10-01', channel: 'storefront', orders: 1, cancelled: 0, paidOrders: 1, gross: 80_000, partialRefund: 0, revenue: 80_000, gmv: 80_000 },
      { day: '2026-10-02', channel: 'storefront', orders: 2, cancelled: 2, paidOrders: 0, gross: 0, partialRefund: 0, revenue: 0, gmv: 0 },
    ]);
    expect(r.byChannel.map((c) => [c.key, c.revenue, c.orders])).toEqual([
      ['checkout', 350_000, 4],
      ['storefront', 80_000, 3],
    ]);
    expect(r.byPlatform.map((c) => [c.key, c.revenue])).toEqual([
      ['miniapp', 330_000],
      ['web', 100_000],
    ]);
    expect(r.totals).toEqual({ orders: 7, cancelled: 3, paidOrders: 4, gross: 480_000, partialRefund: 50_000, revenue: 430_000, gmv: 500_000 });
  });

  it('tổng theo ngày × kênh bằng tổng theo kênh bằng tổng theo nền tảng bằng tổng chung', () => {
    const rows = [
      row({ day: '2026-10-03', channel: 'dealer', platform: 'web', orders: 1, paidOrders: 1, gross: 5_000_000, partialRefund: 200_000 }),
      row({ day: '2026-10-04', channel: 'unknown', platform: 'unknown', orders: 2, paidOrders: 1, gross: 70_000 }),
      row({ day: '2026-10-04', channel: 'dealer', platform: 'web', orders: 1, paidOrders: 1, gross: 100_000 }),
    ];
    const r = foldRevenueRows(rows);
    const sum = (xs: { revenue: number }[]) => xs.reduce((s, x) => s + x.revenue, 0);
    expect(sum(r.byDay)).toBe(r.totals.revenue);
    expect(sum(r.byChannel)).toBe(r.totals.revenue);
    expect(sum(r.byPlatform)).toBe(r.totals.revenue);
    expect(r.totals.revenue).toBe(5_000_000 - 200_000 + 70_000 + 100_000);
  });

  it('không có dòng nào: mọi số bằng 0, danh sách rỗng', () => {
    const r = foldRevenueRows([]);
    expect(r.byDay).toEqual([]);
    expect(r.totals).toEqual({ orders: 0, cancelled: 0, paidOrders: 0, gross: 0, partialRefund: 0, revenue: 0, gmv: 0 });
  });
});
