import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsAggregationService } from '../../src/modules/analytics/analytics-aggregation.service';
import { cohortRowView, funnelDailyView } from '../../src/modules/analytics/analytics-snapshot-view';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * Cohort tháng (cohort_repeat_snapshot) và phễu chốt theo ngày (funnel_daily_snapshot) trên Postgres THẬT: ranh giới tháng/ngày giờ VN,
 * khoá khách theo SĐT, đơn huỷ không tính, và chạy lại không tạo dòng mới. Dùng năm 2033 (spec khác không dùng).
 */
describe('Cohort tháng + phễu theo ngày (real Postgres)', () => {
  let prisma: PrismaService;
  let svc: AnalyticsAggregationService;
  const userIds: string[] = [];
  const phoneBase = String(Math.floor(10_000_000 + Math.random() * 80_000_000));
  const DAY = 86_400_000;
  const Y_FROM = new Date('2033-01-01T00:00:00Z');
  const Y_TO = new Date('2034-01-01T00:00:00Z');
  const FUNNEL_DAY = '2033-05-10';
  const BACKFILL_DAY = '2033-05-11';

  async function wipe() {
    await prisma.order.deleteMany({ where: { createdAt: { gte: Y_FROM, lt: Y_TO } } });
    await prisma.analyticsEvent.deleteMany({ where: { receivedAt: { gte: new Date('2032-12-31T00:00:00Z'), lt: Y_TO } } });
    await prisma.funnelDailySnapshot.deleteMany({ where: { date: { gte: Y_FROM, lt: Y_TO } } });
    await prisma.cohortRepeatSnapshot.deleteMany({ where: { cohortMonth: { gte: Y_FROM, lt: Y_TO } } });
    await prisma.retentionDailySnapshot.deleteMany({ where: { date: { gte: Y_FROM, lt: Y_TO } } });
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    svc = new AnalyticsAggregationService(prisma);
    await wipe();
  });

  afterAll(async () => {
    if (prisma) {
      await wipe();
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma?.$disconnect();
  });

  let seq = 0;
  async function buyer(...orders: Array<[Date, ('CANCELLED' | 'CONFIRMED')?]>) {
    seq += 1;
    const u = await createUser(prisma, { phone: `09${String(seq).padStart(2, '0')}${phoneBase}`.slice(0, 10) });
    userIds.push(u.id);
    for (const [createdAt, status] of orders) await createOrder(prisma, { userId: u.id, createdAt, status: status ?? 'CONFIRMED' });
    return u;
  }

  it('cohort 02/2033: khách mới theo tháng giờ VN, đơn 2 trong 30/60/90 ngày, trung vị; chạy lại vẫn một dòng cùng số', async () => {
    const at = (iso: string, plusDays = 0) => new Date(Date.parse(iso) + plusDays * DAY);
    await buyer([at('2033-02-05T03:00:00Z')], [at('2033-02-05T03:00:00Z', 10)]); // lặp 10 ngày
    await buyer([at('2033-02-10T03:00:00Z')], [at('2033-02-10T03:00:00Z', 45)]); // lặp 45 ngày
    await buyer([at('2033-02-15T03:00:00Z')], [at('2033-02-15T03:00:00Z', 100)]); // quá 90 ngày
    await buyer([at('2033-02-18T03:00:00Z')]); // một đơn
    await buyer([at('2033-01-20T03:00:00Z')], [at('2033-02-03T03:00:00Z')]); // khách cũ (đơn tháng 1)
    await buyer([at('2033-02-20T03:00:00Z')], [at('2033-02-25T03:00:00Z'), 'CANCELLED']); // đơn 2 huỷ
    await buyer([at('2033-02-28T18:00:00Z')], [at('2033-03-02T03:00:00Z')]); // 01:00 01/03 giờ VN: cohort tháng 3
    await buyer([at('2033-01-31T17:30:00Z')], [at('2033-01-31T17:30:00Z', 20)]); // 00:30 01/02 giờ VN: cohort tháng 2, lặp 20 ngày

    const expected = {
      cohortMonth: '2033-02',
      newBuyersInCohort: 6,
      repeat30dCount: 2,
      repeat30dComplete: true,
      repeat60dCount: 3,
      repeat60dComplete: true,
      repeat90dCount: 3,
      repeat90dComplete: true,
      medianDaysToSecondOrder: 20,
    };
    expect(await svc.computeCohortSnapshot('2033-02', '2033-06-30')).toEqual(expected);
    expect(await svc.computeCohortSnapshot('2033-02', '2033-06-30')).toEqual(expected);
    const rows = await prisma.cohortRepeatSnapshot.findMany({ where: { cohortMonth: new Date('2033-02-01') } });
    expect(rows).toHaveLength(1);
    expect(cohortRowView(rows[0]!)).toMatchObject({ cohortMonth: '2033-02', newBuyers: 6, d30: { count: 2, complete: true }, d90: { count: 3, complete: true }, medianDaysToSecondOrder: 20 });

    // Mốc dữ liệu giữa chừng: 01/03 + 30 = 31/03 đã qua, 01/03 + 60 = 30/04 chưa.
    expect(await svc.computeCohortSnapshot('2033-02', '2033-04-15')).toMatchObject({ repeat30dComplete: true, repeat60dComplete: false, repeat90dComplete: false });
    expect(await prisma.cohortRepeatSnapshot.count({ where: { cohortMonth: new Date('2033-02-01') } })).toBe(1);

    // Tháng 3 chỉ có khách đầu tháng 3 theo giờ VN.
    expect(await svc.computeCohortSnapshot('2033-03', '2033-06-30')).toMatchObject({ newBuyersInCohort: 1 });
    // Tháng không có khách mới và chưa có dòng: không tạo dòng 0.
    expect(await svc.computeCohortSnapshot('2033-08', '2033-12-31')).toBeNull();
    expect(await prisma.cohortRepeatSnapshot.count({ where: { cohortMonth: new Date('2033-08-01') } })).toBe(0);
  });

  async function event(name: string, receivedAt: Date, extra: { sessionId?: string | null; platform?: string; userId?: string; props?: object } = {}) {
    await prisma.analyticsEvent.create({
      data: {
        eventId: randomUUID(),
        eventName: name,
        occurredAt: receivedAt,
        receivedAt,
        sessionId: extra.sessionId === undefined ? null : extra.sessionId,
        platform: extra.platform ?? 'web',
        userId: extra.userId,
        props: extra.props ?? {},
      },
    });
  }

  it('phễu ngày VN 10/05/2033: đủ 12 dòng bước × nền tảng, chạy lại không thêm dòng; sự kiện mới thì cập nhật số; ngày thiếu được bù', async () => {
    const t = (iso: string) => new Date(iso);
    const uid = `it-funnel-${randCode(6)}`;
    const s1 = `s1-${randCode(6)}`;
    await event('product_viewed', t('2033-05-09T17:05:00Z'), { sessionId: s1, userId: uid });
    await event('pdp_action', t('2033-05-09T17:06:00Z'), { sessionId: s1, userId: uid, props: { action: 'add_to_cart' } });
    await event('checkout_started', t('2033-05-09T17:07:00Z'), { sessionId: s1, userId: uid });
    await event('checkout_step', t('2033-05-09T17:08:00Z'), { sessionId: s1, userId: uid, props: { step: 'place_order_click' } });
    await event('order_placed', t('2033-05-09T17:09:00Z'), { userId: uid });
    await event('product_viewed', t('2033-05-10T09:00:00Z'), { sessionId: `s2-${randCode(6)}` });
    await event('product_viewed', t('2033-05-10T10:00:00Z'), { sessionId: `s3-${randCode(6)}`, platform: 'miniapp' });
    // 23:59 ngày 09/05 giờ VN và 00:00 ngày 11/05 giờ VN: ngoài ngày.
    await event('product_viewed', t('2033-05-09T16:59:00Z'), { sessionId: `s4-${randCode(6)}` });
    await event('product_viewed', t('2033-05-10T17:00:00Z'), { sessionId: `s5-${randCode(6)}` });

    await svc.computeFunnelSnapshot(FUNNEL_DAY);
    await svc.computeFunnelSnapshot(FUNNEL_DAY);
    const date = new Date(FUNNEL_DAY);
    const rows = await prisma.funnelDailySnapshot.findMany({ where: { date } });
    expect(rows).toHaveLength(12);
    const [day] = funnelDailyView(rows);
    expect(day!.date).toBe(FUNNEL_DAY);
    expect(day!.sessions).toEqual({ web: 2, miniapp: 1, total: 3 });
    const step = (s: string) => day!.rows.find((r) => r.step === s)!;
    expect(step('product_viewed')).toMatchObject({ web: 2, miniapp: 1 });
    expect(step('add_or_buy')).toMatchObject({ web: 1, miniapp: 0 });
    expect(step('place_order_click').web).toBe(1);
    expect(step('order_placed')).toMatchObject({ web: 1, miniapp: 0, total: 1 });

    await event('product_viewed', t('2033-05-10T11:00:00Z'), { sessionId: `s6-${randCode(6)}` });
    await svc.computeFunnelSnapshot(FUNNEL_DAY);
    const again = await prisma.funnelDailySnapshot.findMany({ where: { date } });
    expect(again).toHaveLength(12);
    expect(funnelDailyView(again)[0]!.sessions.web).toBe(3);

    // Ngày đã có retention snapshot nhưng chưa có phễu: được bù; ngày đã chốt thì không tính lại.
    await prisma.retentionDailySnapshot.create({
      data: { date: new Date(BACKFILL_DAY), newBuyers: 0, activeBuyers: 0, ordersCount: 0, ordersPerBuyerMtd: 0, dauProxyRefreshToken: 0 },
    });
    await prisma.retentionDailySnapshot.create({
      data: { date, newBuyers: 0, activeBuyers: 0, ordersCount: 0, ordersPerBuyerMtd: 0, dauProxyRefreshToken: 0 },
    });
    const filled = await svc.backfillFunnelSnapshots(1000);
    expect(filled).toContain(BACKFILL_DAY);
    expect(filled).not.toContain(FUNNEL_DAY);
    expect(await prisma.funnelDailySnapshot.count({ where: { date: new Date(BACKFILL_DAY) } })).toBe(12);
    expect(await svc.backfillFunnelSnapshots(1000)).not.toContain(BACKFILL_DAY);
  });

  it('phiên qua nửa đêm (23:59 → 00:01 giờ VN) chỉ tính cho ngày bắt đầu, kèm cả các bước làm sau 00:00', async () => {
    const t = (iso: string) => new Date(iso);
    const uid = `it-midnight-${randCode(6)}`;
    const x = `x-${randCode(6)}`;
    // 23:59 ngày 20/05 giờ VN, rồi thêm giỏ, thanh toán, đặt đơn sau 00:00 ngày 21/05.
    await event('product_viewed', t('2033-05-20T16:59:00Z'), { sessionId: x, userId: uid });
    await event('pdp_action', t('2033-05-20T17:00:30Z'), { sessionId: x, userId: uid, props: { action: 'add_to_cart' } });
    await event('checkout_started', t('2033-05-20T17:01:00Z'), { sessionId: x, userId: uid });
    await event('checkout_step', t('2033-05-20T17:01:30Z'), { sessionId: x, userId: uid, props: { step: 'place_order_click' } });
    await event('order_placed', t('2033-05-20T17:03:00Z'), { userId: uid });
    // Phiên thường của 21/05 và phiên Mini 23:30 ngày 21/05 kéo sang 00:30 ngày 22/05.
    await event('product_viewed', t('2033-05-21T02:00:00Z'), { sessionId: `y-${randCode(6)}` });
    const z = `z-${randCode(6)}`;
    await event('screen_viewed', t('2033-05-21T16:30:00Z'), { sessionId: z, platform: 'miniapp' });
    await event('product_viewed', t('2033-05-21T17:30:00Z'), { sessionId: z, platform: 'miniapp' });

    const day20 = await svc.computeFunnelSnapshot('2033-05-20');
    const day21 = await svc.computeFunnelSnapshot('2033-05-21');
    const day22 = await svc.computeFunnelSnapshot('2033-05-22');
    const step = (d: typeof day20, s: string) => d.rows.find((r) => r.step === s)!;

    expect(day20.sessions).toEqual({ web: 1, miniapp: 0, total: 1 });
    for (const s of ['product_viewed', 'add_or_buy', 'checkout_started', 'place_order_click', 'order_placed']) {
      expect(step(day20, s)).toMatchObject({ web: 1, miniapp: 0 });
    }
    expect(day21.sessions).toEqual({ web: 1, miniapp: 1, total: 2 });
    expect(step(day21, 'product_viewed')).toMatchObject({ web: 1, miniapp: 1 });
    for (const s of ['add_or_buy', 'checkout_started', 'place_order_click', 'order_placed']) expect(step(day21, s).total).toBe(0);
    expect(day22.sessions.total).toBe(0);

    const snap = funnelDailyView(await prisma.funnelDailySnapshot.findMany({ where: { date: { in: [new Date('2033-05-20'), new Date('2033-05-21')] } } }));
    expect(snap.map((d) => [d.date, d.sessions.total])).toEqual(
      expect.arrayContaining([
        ['2033-05-20', 1],
        ['2033-05-21', 2],
      ]),
    );
  });
});
