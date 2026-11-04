import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import type { NormalizedCashbackEvent } from '../../src/modules/cashback/providers/cashback-provider.interface';
import { createUser, randCode, warmPool } from './helpers';

/**
 * L2-01/02/07/08/09 trên Postgres thật: trạng thái cashback chỉ đi tiến, quyết định của Kế toán không bị postback lật,
 * hai người duyệt cùng một dòng thì một người thua (409), và cashbackPending luôn khớp tổng userReward của các dòng CONFIRMED.
 */
describe('Cashback: máy trạng thái dưới đồng thời (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: CashbackService;
  const notify = jest.fn().mockResolvedValue(undefined);
  let merchantId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = new CashbackService(
      prisma,
      { get: async <T>(_k: string, fb?: T) => fb as T } as never,
      { notify } as never,
      { all: () => [], get: () => undefined } as never,
    );
    const m = await prisma.cashbackMerchant.create({
      data: { slug: `it-${randCode(6).toLowerCase()}`, name: 'IT sàn', provider: 'accesstrade', deeplinkTemplate: 'https://x/{{clickId}}', baseRate: 0.05, fullRate: 0.08, category: 'it', logoUrl: 'https://x/l.png' },
    });
    merchantId = m.id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => notify.mockClear());

  async function seedClick() {
    const user = await createUser(prisma);
    const utm = randCode(16);
    const click = await prisma.cashbackClick.create({ data: { userId: user.id, merchantId, utmTraceId: utm, destinationUrl: 'https://x' } });
    return { user, utm, click };
  }

  const ev = (clickRef: string, orderId: string, status: NormalizedCashbackEvent['status'], commission = 50000): NormalizedCashbackEvent => ({
    clickRef,
    merchantOrderId: orderId,
    orderAmount: 500000,
    commission,
    status,
    raw: { status },
  });

  const pendingOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).cashbackPending;
  const rowOf = (orderId: string) => prisma.cashbackTransaction.findFirstOrThrow({ where: { provider: 'accesstrade', merchantOrderId: orderId } });

  it('L2-01: postback PENDING muộn chạy cùng lúc reconcile CONFIRMED → cuối cùng CONFIRMED, settle về Ví một lần', async () => {
    const { user, utm } = await seedClick();
    const orders = Array.from({ length: 8 }, (_, i) => `L201-${randCode(6)}-${i}`);
    for (const o of orders) await svc.ingest(ev(utm, o, 'PENDING'), 'accesstrade');
    await Promise.all(orders.flatMap((o) => [svc.ingest(ev(utm, o, 'PENDING'), 'accesstrade'), svc.ingest(ev(utm, o, 'CONFIRMED'), 'accesstrade')]));
    for (const o of orders) expect((await rowOf(o)).status).toBe('CONFIRMED');
    expect(await pendingOf(user.id)).toBe(8 * 35000);

    await prisma.cashbackTransaction.updateMany({ where: { userId: user.id }, data: { confirmedAt: new Date(Date.now() - 90 * 86400_000) } });
    await svc.settleConfirmed();
    await svc.settleConfirmed();
    for (const o of orders) expect((await rowOf(o)).status).toBe('PAID');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.cashbackPending).toBe(0);
    expect(after.walletBalance).toBe(8 * 35000);
  });

  it('L2-01: PENDING đến sau khi đã CONFIRMED (tuần tự) không kéo lùi', async () => {
    const { user, utm } = await seedClick();
    const o = `L201s-${randCode(6)}`;
    await svc.ingest(ev(utm, o, 'CONFIRMED'), 'accesstrade');
    await svc.ingest(ev(utm, o, 'PENDING'), 'accesstrade');
    expect((await rowOf(o)).status).toBe('CONFIRMED');
    expect(await pendingOf(user.id)).toBe(35000);
  });

  it('L2-09: nhiều sự kiện đổi trạng thái/số tiền chạy song song trên cùng dòng → cashbackPending khớp tổng userReward các dòng CONFIRMED', async () => {
    const { user, utm } = await seedClick();
    const orders = Array.from({ length: 6 }, (_, i) => `L209-${randCode(6)}-${i}`);
    for (const o of orders) await svc.ingest(ev(utm, o, 'PENDING', 50000), 'accesstrade');
    for (let round = 0; round < 3; round++) {
      await Promise.all(
        orders.flatMap((o) => [
          svc.ingest(ev(utm, o, 'CONFIRMED', 40000), 'accesstrade'),
          svc.ingest(ev(utm, o, 'REJECTED', 40000), 'accesstrade'),
          svc.ingest(ev(utm, o, 'CONFIRMED', 60000), 'accesstrade'),
          svc.ingest(ev(utm, o, 'PENDING', 70000), 'accesstrade'),
        ]),
      );
    }
    const rows = await prisma.cashbackTransaction.findMany({ where: { userId: user.id } });
    const confirmed = rows.filter((r) => r.status === 'CONFIRMED').reduce((sum, r) => sum + r.userReward, 0);
    expect(await pendingOf(user.id)).toBe(confirmed);
  });

  it('L2-07: hai Kế toán duyệt song song cùng một dòng → một 200, một 409; pending chỉ cộng một lần', async () => {
    const { user, utm } = await seedClick();
    const admin = await createUser(prisma, { role: 'ADMIN' });
    for (let i = 0; i < 5; i++) {
      const o = `L207-${randCode(6)}-${i}`;
      await svc.ingest(ev(utm, o, 'PENDING'), 'accesstrade');
      const row = await rowOf(o);
      const results = await Promise.allSettled([
        svc.adminReview(admin.id, row.id, 'CONFIRMED'),
        svc.adminReview(admin.id, row.id, 'CONFIRMED'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect([409, 400]).toContain((lost.reason as { getStatus(): number }).getStatus());
    }
    expect(await pendingOf(user.id)).toBe(5 * 35000);
  });

  it('L2-02: Kế toán REJECTED, sau đó postback/đối soát CONFIRMED song song → vẫn REJECTED, Ví và pending không đổi, đúng 1 cảnh báo', async () => {
    const { user, utm } = await seedClick();
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const o = `L202-${randCode(6)}`;
    await svc.ingest(ev(utm, o, 'PENDING'), 'accesstrade');
    await svc.adminReview(admin.id, (await rowOf(o)).id, 'REJECTED', 'sàn báo gian lận');
    await Promise.all([svc.ingest(ev(utm, o, 'CONFIRMED'), 'accesstrade'), svc.ingest(ev(utm, o, 'CONFIRMED'), 'accesstrade'), svc.ingest(ev(utm, o, 'CONFIRMED'), 'accesstrade')]);
    const row = await rowOf(o);
    expect(row.status).toBe('REJECTED');
    expect(row.adminReviewedAt).not.toBeNull();
    expect(row.adminReviewedBy).toBe(admin.id);
    expect(row.conflictNotifiedAt).not.toBeNull();
    expect(row.conflictPayload).toEqual({ status: 'CONFIRMED' });
    expect(await pendingOf(user.id)).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).walletBalance).toBe(0);
    const notified = (notify.mock.calls as unknown[][]).filter((c) => c[1] === 'OPS_HEALTH_ALERT' && String((c[2] as { summary: string }).summary).includes(o));
    expect(notified.length).toBeGreaterThan(0);
    expect(new Set(notified.map((c) => c[0])).size).toBe(notified.length);
    expect(notified.length).toBeLessThanOrEqual(await prisma.user.count({ where: { role: 'ADMIN', isBlocked: false } }));
    const second = notify.mock.calls.length;
    await svc.ingest(ev(utm, o, 'CONFIRMED'), 'accesstrade');
    expect(notify.mock.calls.length).toBe(second);
  });

  it('L2-08: sàn báo rejected sau khi đã PAID → tiền Ví không đổi, payload được lưu, báo một lần', async () => {
    const { user, utm } = await seedClick();
    const o = `L208-${randCode(6)}`;
    await svc.ingest(ev(utm, o, 'CONFIRMED'), 'accesstrade');
    await prisma.cashbackTransaction.updateMany({ where: { userId: user.id }, data: { confirmedAt: new Date(Date.now() - 90 * 86400_000) } });
    await svc.settleConfirmed();
    expect((await rowOf(o)).status).toBe('PAID');
    await Promise.all([svc.ingest(ev(utm, o, 'REJECTED'), 'accesstrade'), svc.ingest(ev(utm, o, 'REJECTED'), 'accesstrade')]);
    const row = await rowOf(o);
    expect(row.status).toBe('PAID');
    expect(row.conflictNotifiedAt).not.toBeNull();
    expect(row.conflictPayload).toEqual({ status: 'REJECTED' });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.walletBalance).toBe(35000);
    expect(after.cashbackPending).toBe(0);
  });

  it('M2: dòng đã báo lệch (L2-02) rồi Kế toán duyệt lại và PAID → sàn báo rejected vẫn có cảnh báo lần 2, payload mới', async () => {
    const { user, utm } = await seedClick();
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const o = `M2-${randCode(6)}`;
    await svc.ingest(ev(utm, o, 'PENDING'), 'accesstrade');
    const id = (await rowOf(o)).id;
    await svc.adminReview(admin.id, id, 'REJECTED');
    await svc.ingest({ ...ev(utm, o, 'CONFIRMED'), raw: { status: 'approved-1' } }, 'accesstrade');
    expect((await rowOf(o)).conflictNotifiedAt).not.toBeNull();
    const firstCalls = notify.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);

    await svc.adminReview(admin.id, id, 'CONFIRMED');
    const reset = await rowOf(o);
    expect(reset.conflictNotifiedAt).toBeNull();
    expect(reset.conflictPayload).toBeNull();

    await prisma.cashbackTransaction.update({ where: { id }, data: { confirmedAt: new Date(Date.now() - 90 * 86400_000) } });
    await svc.settleConfirmed();
    expect((await rowOf(o)).status).toBe('PAID');
    await svc.ingest({ ...ev(utm, o, 'REJECTED'), raw: { status: 'rejected-2' } }, 'accesstrade');
    const after = await rowOf(o);
    expect(after.conflictNotifiedAt).not.toBeNull();
    expect(after.conflictPayload).toEqual({ status: 'rejected-2' });
    expect(notify.mock.calls.length).toBeGreaterThan(firstCalls);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).walletBalance).toBe(35000);
  });

  it('M2\': approved → rejected → approved (REVIVED báo) → settle PAID → rejected → đúng 1 cảnh báo PAID_REJECTED, payload là payload rejected cuối', async () => {
    const { user, utm } = await seedClick();
    const o = `M2P-${randCode(6)}`;
    const alertsFor = () => (notify.mock.calls as unknown[][]).filter((c) => c[1] === 'OPS_HEALTH_ALERT' && String((c[2] as { summary: string }).summary).includes(o));
    await svc.ingest({ ...ev(utm, o, 'CONFIRMED'), raw: { status: 'approved-1' } }, 'accesstrade');
    await svc.ingest({ ...ev(utm, o, 'REJECTED'), raw: { status: 'rejected-1' } }, 'accesstrade');
    await svc.ingest({ ...ev(utm, o, 'CONFIRMED'), raw: { status: 'approved-2' } }, 'accesstrade');
    expect((await rowOf(o)).conflictNotifiedAt).not.toBeNull();
    const revived = alertsFor().length;
    expect(revived).toBeGreaterThan(0);

    await prisma.cashbackTransaction.updateMany({ where: { userId: user.id }, data: { confirmedAt: new Date(Date.now() - 90 * 86400_000) } });
    await svc.settleConfirmed();
    expect((await rowOf(o)).status).toBe('PAID');
    await svc.ingest({ ...ev(utm, o, 'REJECTED'), raw: { status: 'rejected-final' } }, 'accesstrade');
    const row = await rowOf(o);
    expect(row.conflictPayload).toEqual({ status: 'rejected-final' });
    const all = alertsFor();
    expect(all.length).toBeGreaterThan(revived);
    expect(all.filter((c) => String((c[2] as { summary: string }).summary).includes('đã trả về Ví'))).not.toHaveLength(0);
    const before = notify.mock.calls.length;
    await svc.ingest({ ...ev(utm, o, 'REJECTED'), raw: { status: 'rejected-again' } }, 'accesstrade');
    expect(notify.mock.calls.length).toBe(before);
  });

  it('REVIVED lần hai: approved → rejected → approved (báo) → rejected → approved → có 2 tin REVIVED', async () => {
    const { user, utm } = await seedClick();
    const o = `REV2-${randCode(6)}`;
    const revivedAlerts = () => (notify.mock.calls as unknown[][]).filter((c) => c[1] === 'OPS_HEALTH_ALERT' && String((c[2] as { summary: string }).summary).includes(o) && String((c[2] as { summary: string }).summary).includes('duyệt lại'));
    await svc.ingest(ev(utm, o, 'CONFIRMED'), 'accesstrade');
    await svc.ingest(ev(utm, o, 'REJECTED'), 'accesstrade');
    await svc.ingest(ev(utm, o, 'CONFIRMED'), 'accesstrade');
    const first = revivedAlerts().length;
    expect(first).toBeGreaterThan(0);
    await svc.ingest(ev(utm, o, 'REJECTED'), 'accesstrade');
    await svc.ingest(ev(utm, o, 'CONFIRMED'), 'accesstrade');
    expect(revivedAlerts().length).toBe(first * 2);
    expect(await pendingOf(user.id)).toBe(35000);
  });
});
