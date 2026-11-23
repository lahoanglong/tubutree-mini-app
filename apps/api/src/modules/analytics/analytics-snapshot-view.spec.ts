import { Prisma } from '@prisma/client';
import { cohortRowView, funnelDailySince, funnelDailyView } from './analytics-snapshot-view';

describe('cohortRowView', () => {
  it('tháng YYYY-MM, ba cửa sổ kèm cờ đủ ngày, trung vị Decimal thành số', () => {
    const view = cohortRowView({
      id: 'c1',
      cohortMonth: new Date('2026-10-01'),
      newBuyersInCohort: 40,
      repeat30dCount: 6,
      repeat30dComplete: true,
      repeat60dCount: 9,
      repeat60dComplete: false,
      repeat90dCount: 9,
      repeat90dComplete: false,
      medianDaysToSecondOrder: new Prisma.Decimal('12.5'),
      computedAt: new Date('2026-11-24T20:00:00Z'),
    });
    expect(view).toEqual({
      cohortMonth: '2026-10',
      newBuyers: 40,
      d30: { count: 6, complete: true },
      d60: { count: 9, complete: false },
      d90: { count: 9, complete: false },
      medianDaysToSecondOrder: 12.5,
      computedAt: '2026-11-24T20:00:00.000Z',
    });
    expect(typeof view.medianDaysToSecondOrder).toBe('number');
  });

  it('chưa ai có đơn 2: trung vị null', () => {
    const view = cohortRowView({
      id: 'c2', cohortMonth: new Date('2026-11-01'), newBuyersInCohort: 3,
      repeat30dCount: 0, repeat30dComplete: false, repeat60dCount: 0, repeat60dComplete: false, repeat90dCount: 0, repeat90dComplete: false,
      medianDaysToSecondOrder: null, computedAt: new Date('2026-11-24T20:00:00Z'),
    });
    expect(view.medianDaysToSecondOrder).toBeNull();
  });
});

describe('funnelDailyView', () => {
  const d1 = new Date('2026-11-22');
  const d2 = new Date('2026-11-23');
  it('gom từng dòng bước × nền tảng thành một phễu mỗi ngày, ngày tăng dần, bước thiếu là 0, nguồn lạ bị bỏ', () => {
    const out = funnelDailyView([
      { date: d2, step: 'sessions', entrySource: 'web', count: 10 },
      { date: d2, step: 'sessions', entrySource: 'miniapp', count: 5 },
      { date: d2, step: 'order_placed', entrySource: 'web', count: 2 },
      { date: d1, step: 'sessions', entrySource: 'miniapp', count: 7 },
      { date: d1, step: 'product_viewed', entrySource: 'miniapp', count: 4 },
      { date: d1, step: 'product_viewed', entrySource: null, count: 99 },
      { date: d1, step: 'product_viewed', entrySource: 'zalo_oa', count: 99 },
    ]);
    expect(out.map((d) => d.date)).toEqual(['2026-11-22', '2026-11-23']);
    expect(out[0]!.sessions).toEqual({ web: 0, miniapp: 7, total: 7 });
    expect(out[0]!.rows.find((r) => r.step === 'product_viewed')).toEqual({ step: 'product_viewed', web: 0, miniapp: 4, total: 4 });
    expect(out[1]!.sessions).toEqual({ web: 10, miniapp: 5, total: 15 });
    expect(out[1]!.rows.map((r) => r.step)).toEqual(['product_viewed', 'add_or_buy', 'checkout_started', 'place_order_click', 'order_placed']);
    expect(out[1]!.rows.find((r) => r.step === 'order_placed')!.total).toBe(2);
    expect(out[1]!.rows.find((r) => r.step === 'add_or_buy')!.total).toBe(0);
  });

  it('không có dòng nào: mảng rỗng', () => {
    expect(funnelDailyView([])).toEqual([]);
  });
});

describe('funnelDailySince', () => {
  it('days=30 lúc 10:00 giờ VN ngày 24/11: mốc 25/10 (đủ 30 ngày 25/10..23/11, ngày mới nhất là hôm qua)', () => {
    expect(funnelDailySince(30, new Date('2026-11-24T03:00:00Z'))).toEqual(new Date('2026-10-25'));
  });

  it('00:30 giờ VN (17:30Z hôm trước) đã sang ngày VN mới', () => {
    expect(funnelDailySince(1, new Date('2026-11-23T17:30:00Z'))).toEqual(new Date('2026-11-23'));
    expect(funnelDailySince(1, new Date('2026-11-23T16:30:00Z'))).toEqual(new Date('2026-11-22'));
  });
});
