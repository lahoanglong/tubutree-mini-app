import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsAggregationService } from '../../src/modules/analytics/analytics-aggregation.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * NS-1 (C-032) trên Postgres THẬT: % khách có đơn thứ 2 trong 30 ngày kể từ đơn đầu, theo cohort MỘT ngày VN
 * (ngày tính − 30). Dùng năm 2031 để không đụng dữ liệu retention-snapshot.race-spec (năm 2030).
 *
 * Cohort ngày VN 2031-03-10 = [2031-03-09T17:00Z, 2031-03-10T17:00Z); ngày tính = 2031-04-09.
 */
describe('NS-1 retention (real Postgres)', () => {
  let prisma: PrismaService;
  let svc: AnalyticsAggregationService;
  const tag = randCode(6);
  const phoneBase = String(Math.floor(100_000_000 + Math.random() * 800_000_000));
  const COHORT_DAY = '2031-03-10';
  const SNAPSHOT_DAY = '2031-04-09';
  const first = new Date('2031-03-10T03:00:00Z');
  const plus = (ms: number, from = first) => new Date(from.getTime() + ms);
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    svc = new AnalyticsAggregationService(prisma);
    await prisma.order.deleteMany({ where: { createdAt: { gte: new Date('2031-01-01T00:00:00Z'), lt: new Date('2032-01-01T00:00:00Z') } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const order = (userId: string, createdAt: Date, extra: Record<string, unknown> = {}) => createOrder(prisma, { userId, createdAt, ...extra });

  it('cohort = khách mới của ngày D−30; lặp = đơn hợp lệ thứ 2 trong 30 ngày; ghi vào snapshot', async () => {
    const phone = (n: number) => `${n}${phoneBase}`;

    // 1) lặp: đơn 2 sau 5 ngày
    const f1 = await createUser(prisma, { phone: phone(11) });
    await order(f1.id, first);
    await order(f1.id, plus(5 * DAY));
    // 2) lặp: đơn 2 đúng mốc đơn đầu + 30 ngày (biên trong)
    const f2 = await createUser(prisma, { phone: phone(12) });
    await order(f2.id, first);
    await order(f2.id, plus(30 * DAY));
    // 3) KHÔNG lặp: đơn 2 trễ hơn mốc 30 ngày 1 giây
    const f3 = await createUser(prisma, { phone: phone(13) });
    await order(f3.id, first);
    await order(f3.id, plus(30 * DAY + 1000));
    // 4) lặp: đơn 2 ngay trong ngày cohort
    const f4 = await createUser(prisma, { phone: phone(14) });
    await order(f4.id, first);
    await order(f4.id, plus(HOUR));
    // 5) KHÔNG lặp: đơn 2 đã HUỶ
    const f5 = await createUser(prisma, { phone: phone(15) });
    await order(f5.id, first);
    await order(f5.id, plus(2 * DAY), { status: 'CANCELLED' });
    // 6) lặp: hai tài khoản cùng SĐT (khác định dạng) là một khách
    const f6a = await createUser(prisma, { phone: `84${phoneBase}16` });
    const f6b = await createUser(prisma, { phone: `+84-${phoneBase}16` });
    await order(f6a.id, first);
    await order(f6b.id, plus(3 * DAY));
    // 7) KHÔNG lặp: đơn 2 là đơn đại lý (không phải bán lẻ)
    const f7 = await createUser(prisma, { phone: phone(17) });
    await order(f7.id, first);
    await order(f7.id, plus(3 * DAY), { type: 'DEALER' });
    // 8) lặp: khách không SĐT, khoá theo userId
    const f8 = await createUser(prisma);
    await order(f8.id, first);
    await order(f8.id, plus(9 * DAY));

    // Khách cũ: có đơn trước ngày cohort → không vào cohort dù đơn trong ngày cohort có đơn lặp.
    const old = await createUser(prisma, { phone: phone(18) });
    await order(old.id, plus(-20 * DAY));
    await order(old.id, first);
    await order(old.id, plus(2 * DAY));
    // Khách có đơn đầu 23:59:59 VN ngày trước cohort (16:59:59Z) → không phải khách mới của ngày cohort.
    const dayBefore = await createUser(prisma, { phone: phone(19) });
    await order(dayBefore.id, new Date('2031-03-09T16:59:59Z'));
    await order(dayBefore.id, first);

    // Đơn lên hộ: khoá = endCustomerKey; hai CTV khác nhau cùng người nhận là một khách.
    const ctv1 = await createUser(prisma, { phone: phone(21) });
    const ctv2 = await createUser(prisma, { phone: phone(22) });
    const keyRepeat = `hash-rep-${tag}`;
    const keySingle = `hash-one-${tag}`;
    await order(ctv1.id, first, { placedForCustomer: true, endCustomerKey: keyRepeat });
    await order(ctv2.id, plus(7 * DAY), { placedForCustomer: true, endCustomerKey: keyRepeat });
    await order(ctv1.id, first, { placedForCustomer: true, endCustomerKey: keySingle });

    // Nhiễu: sát ngoài ranh giới ngày cohort (00:00 VN ngày 11) không vào cohort.
    const nextDay = await createUser(prisma, { phone: phone(23) });
    await order(nextDay.id, new Date('2031-03-10T17:00:00Z'));
    await order(nextDay.id, plus(10 * DAY));

    await svc.computeRetentionSnapshot(SNAPSHOT_DAY);

    const row = await prisma.retentionDailySnapshot.findUniqueOrThrow({ where: { date: new Date(SNAPSHOT_DAY) } });
    // Cohort: f1..f8 (8) + keyRepeat + keySingle (2) = 10; ctv1 chỉ có đơn lên hộ nên không phát sinh khoá riêng.
    expect(row.ns1CohortSize).toBe(10);
    // Lặp: f1, f2, f4, f6, f8, keyRepeat = 6.
    expect(row.ns1RepeatCount).toBe(6);
    expect(COHORT_DAY).toBe('2031-03-10');
  });

  it('backfillNs1: điền NS-1 cho dòng cũ còn NULL, không đụng cột khác, không tạo dòng cho ngày chưa có snapshot', async () => {
    await prisma.retentionDailySnapshot.update({
      where: { date: new Date(SNAPSHOT_DAY) },
      data: { ns1CohortSize: null, ns1RepeatCount: null, newBuyers: 777 },
    });

    await expect(svc.backfillNs1(SNAPSHOT_DAY)).resolves.toBe(true);
    const row = await prisma.retentionDailySnapshot.findUniqueOrThrow({ where: { date: new Date(SNAPSHOT_DAY) } });
    expect([row.ns1CohortSize, row.ns1RepeatCount, row.newBuyers]).toEqual([10, 6, 777]);

    // Đã có NS-1 thì không tính lại; ngày chưa có snapshot thì không tạo dòng.
    await expect(svc.backfillNs1(SNAPSHOT_DAY)).resolves.toBe(false);
    await expect(svc.backfillNs1('2031-10-01')).resolves.toBe(false);
    expect(await prisma.retentionDailySnapshot.findUnique({ where: { date: new Date('2031-10-01') } })).toBeNull();
  });

  it('chạy lại cùng ngày cho cùng kết quả (idempotent), ngày không có cohort → 0/0 (không phải NULL)', async () => {
    await svc.computeRetentionSnapshot(SNAPSHOT_DAY);
    const again = await prisma.retentionDailySnapshot.findUniqueOrThrow({ where: { date: new Date(SNAPSHOT_DAY) } });
    expect([again.ns1CohortSize, again.ns1RepeatCount]).toEqual([10, 6]);

    await svc.computeRetentionSnapshot('2031-09-20');
    const empty = await prisma.retentionDailySnapshot.findUniqueOrThrow({ where: { date: new Date('2031-09-20') } });
    expect([empty.ns1CohortSize, empty.ns1RepeatCount]).toEqual([0, 0]);
  });

  it('một khách vừa tự mua vừa được CTV lên hộ cùng SĐT trong ngày cohort chỉ đếm MỘT lần (cohort và lặp)', async () => {
    const day1 = new Date('2031-05-10T03:00:00Z');
    const phoneX = `${31}${phoneBase}`;
    const x = await createUser(prisma, { phone: phoneX });
    const ctv = await createUser(prisma, { phone: `${32}${phoneBase}` });
    // X: một đơn tự mua + hai đơn CTV lên hộ cho chính SĐT của X (endCustomerKey = SĐT nội địa) → lặp.
    await order(x.id, day1);
    await order(ctv.id, plus(HOUR, day1), { placedForCustomer: true, endCustomerKey: phoneX });
    await order(ctv.id, plus(2 * HOUR, day1), { placedForCustomer: true, endCustomerKey: phoneX });
    // Y: một đơn duy nhất → không lặp.
    const y = await createUser(prisma, { phone: `${33}${phoneBase}` });
    await order(y.id, day1);

    await svc.computeRetentionSnapshot('2031-06-09');
    const row = await prisma.retentionDailySnapshot.findUniqueOrThrow({ where: { date: new Date('2031-06-09') } });
    console.log('[ns1] cohort=%d repeat=%d', row.ns1CohortSize, row.ns1RepeatCount);
    expect([row.ns1CohortSize, row.ns1RepeatCount]).toEqual([2, 1]);
  });
});
