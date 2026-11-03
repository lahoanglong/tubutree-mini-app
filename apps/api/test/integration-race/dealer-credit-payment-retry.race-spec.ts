import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createUser, deleteItData, randCode, summarize, warmPool } from './helpers';

/**
 * ERR-01: ghi giảm công nợ đại lý KHÔNG kèm mã giao dịch vẫn phải chống trừ hai lần khi kế toán thử lại sau lỗi mạng. Web gửi
 * Idempotency-Key riêng cho mỗi khoản nhập; cùng khoá gọi lại (tuần tự hay song song) chỉ ra đúng một dòng PAYMENT.
 */
describe('Chốt phía API: ghi giảm công nợ thử lại cùng khoá (real Postgres; không chứng minh panel gửi đúng khoá, việc đó do dealer-credit-panel.spec.tsx)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  const userIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        DealerService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined), enqueuePayment: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    dealer = moduleRef.get(DealerService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.dealerCreditPaymentReport.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.dealerCreditLedger.deleteMany({ where: { userId: { in: userIds } } });
      await deleteItData(prisma, { userIds });
    }
    await moduleRef?.close();
  });

  const newDealer = async (role: 'DEALER' | 'CUSTOMER' = 'DEALER') => {
    const u = await createUser(prisma, { role, fullName: `Đại lý ${randCode(4)}`, phone: `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` });
    userIds.push(u.id);
    return u;
  };
  const debtOf = async (userId: string) => (await prisma.dealerCreditLedger.aggregate({ where: { userId }, _sum: { delta: true } }))._sum.delta ?? 0;
  const addDebt = (userId: string, delta: number) =>
    prisma.dealerCreditLedger.create({ data: { userId, delta, refType: 'ORDER', refId: `it-${randCode(8)}`, note: 'Đơn IT' } });
  const payments = (userId: string) => prisma.dealerCreditLedger.findMany({ where: { userId, refType: 'PAYMENT' } });

  it('cùng khoá, không bankRef, gọi hai lần liên tiếp → đúng một dòng PAYMENT, dư nợ chỉ giảm một lần', async () => {
    const d = await newDealer();
    await addDebt(d.id, 20_000_000);
    const key = `k-${randCode(10)}`;
    await dealer.adminRecordCreditPayment('kt', d.id, 5_000_000, { idempotencyKey: key, byStaff: true });
    await dealer.adminRecordCreditPayment('kt', d.id, 5_000_000, { idempotencyKey: key, byStaff: true });
    expect(await payments(d.id)).toHaveLength(1);
    expect(await debtOf(d.id)).toBe(15_000_000);
  });

  it('cùng khoá, gọi song song → đúng một dòng PAYMENT', async () => {
    const d = await newDealer();
    await addDebt(d.id, 20_000_000);
    const key = `k-${randCode(10)}`;
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => dealer.adminRecordCreditPayment('kt', d.id, 5_000_000, { idempotencyKey: key, byStaff: true })),
    );
    // Serializable: bên thua có thể nhận câu "đang bận, thử lại" (an toàn), không được có lỗi nào khác.
    expect(summarize(results).errors.filter((e) => !/đang bận xử lý công nợ/.test(e))).toEqual([]);
    expect(summarize(results).fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(await payments(d.id)).toHaveLength(1);
    expect(await debtOf(d.id)).toBe(15_000_000);
  });

  it('khoá khác nhau cùng số tiền (hai khoản thật) → hai dòng PAYMENT', async () => {
    const d = await newDealer();
    await addDebt(d.id, 20_000_000);
    await dealer.adminRecordCreditPayment('kt', d.id, 5_000_000, { idempotencyKey: `k-${randCode(10)}` });
    await dealer.adminRecordCreditPayment('kt', d.id, 5_000_000, { idempotencyKey: `k-${randCode(10)}` });
    expect(await payments(d.id)).toHaveLength(2);
    expect(await debtOf(d.id)).toBe(10_000_000);
  });

  it('có bankRef kèm khoá riêng: gọi lại cùng khoá là replay; khoá khác cùng mã vẫn 409', async () => {
    const d = await newDealer();
    await addDebt(d.id, 20_000_000);
    const key = `k-${randCode(10)}`;
    const ref = `FT${randCode(8)}`;
    await dealer.adminRecordCreditPayment('kt', d.id, 5_000_000, { idempotencyKey: key, bankRef: ref });
    await dealer.adminRecordCreditPayment('kt', d.id, 5_000_000, { idempotencyKey: key, bankRef: ref });
    await expect(dealer.adminRecordCreditPayment('kt', d.id, 5_000_000, { idempotencyKey: `k-${randCode(10)}`, bankRef: ref })).rejects.toThrow(/đã dùng để ghi giảm công nợ/);
    expect(await payments(d.id)).toHaveLength(1);
  });
});
