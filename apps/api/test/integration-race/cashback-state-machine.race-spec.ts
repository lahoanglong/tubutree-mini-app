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
});
