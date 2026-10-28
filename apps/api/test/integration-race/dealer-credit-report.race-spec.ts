import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * Báo cáo "đã chuyển khoản trả nợ" của đại lý trên Postgres THẬT: chỉ báo thì không trừ nợ, kế toán ghi nhận kèm reportId đóng
 * báo cáo cùng lúc với dòng sổ, và hai lần ghi nhận cùng một báo cáo (bấm đúp, hai kế toán cùng lúc) chỉ trừ nợ một lần.
 */
describe('Báo cáo chuyển khoản trả nợ của đại lý (real Postgres)', () => {
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
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
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
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await moduleRef?.close();
  });

  /** Đại lý đang nợ `debt` đồng (một dòng ORDER trong sổ). */
  const dealerWithDebt = async (debt = 500_000) => {
    const d = await createUser(prisma, { role: 'DEALER', fullName: `Đại lý ${randCode(4)}` });
    userIds.push(d.id);
    await prisma.dealerCreditLedger.create({ data: { userId: d.id, delta: debt, refType: 'ORDER', refId: `it-${randCode(8)}`, note: 'Đơn IT' } });
    return d;
  };
  const payments = (userId: string) => prisma.dealerCreditLedger.findMany({ where: { userId, refType: 'PAYMENT' } });
  const balance = async (userId: string) => (await prisma.dealerCreditLedger.aggregate({ where: { userId }, _sum: { delta: true } }))._sum.delta ?? 0;

  it('đại lý báo: có một dòng REPORTED, sổ công nợ chưa giảm đồng nào', async () => {
    const d = await dealerWithDebt();
    await dealer.reportCreditPayment(d.id, 200_000, 'CK lúc 9h');

    const rows = await prisma.dealerCreditPaymentReport.findMany({ where: { userId: d.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 200_000, note: 'CK lúc 9h', status: 'REPORTED', resolvedAt: null });
    expect(await balance(d.id)).toBe(500_000);
    expect(await payments(d.id)).toHaveLength(0);
    expect(await dealer.listCreditPaymentReports()).toEqual(expect.arrayContaining([expect.objectContaining({ id: rows[0]!.id, dealer: expect.objectContaining({ id: d.id }) })]));
  });

  it('ghi nhận kèm reportId: một dòng PAYMENT âm và báo cáo RECORDED cùng lúc; ghi nhận lại không trừ thêm', async () => {
    const d = await dealerWithDebt();
    await dealer.reportCreditPayment(d.id, 200_000);
    const report = await prisma.dealerCreditPaymentReport.findFirstOrThrow({ where: { userId: d.id } });

    await dealer.adminRecordCreditPayment('kt-1', d.id, 200_000, { reportId: report.id, byStaff: true });

    const after = await prisma.dealerCreditPaymentReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(after).toMatchObject({ status: 'RECORDED', resolvedBy: 'kt-1' });
    expect(after.resolvedAt).not.toBeNull();
    expect(await balance(d.id)).toBe(300_000);

    await dealer.adminRecordCreditPayment('kt-2', d.id, 200_000, { reportId: report.id, idempotencyKey: 'FT-RETRY' });
    await dealer.adminRecordCreditPayment('kt-2', d.id, 200_000, { reportId: report.id });
    expect(await payments(d.id)).toHaveLength(1);
    expect(await balance(d.id)).toBe(300_000);
  });

  it('hai kế toán ghi nhận CÙNG báo cáo cùng lúc (khoá khác nhau hoặc không khoá): chỉ trừ nợ một lần', async () => {
    for (const keys of [[undefined, undefined], ['FT-A', 'FT-B']] as const) {
      const d = await dealerWithDebt();
      await dealer.reportCreditPayment(d.id, 200_000);
      const report = await prisma.dealerCreditPaymentReport.findFirstOrThrow({ where: { userId: d.id } });

      const results = await Promise.allSettled(
        keys.map((k, i) => dealer.adminRecordCreditPayment(`kt-${i}`, d.id, 200_000, { reportId: report.id, byStaff: true, idempotencyKey: k })),
      );

      const s = summarize(results);
      expect(s.fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(await payments(d.id)).toHaveLength(1);
      expect(await balance(d.id)).toBe(300_000);
      expect((await prisma.dealerCreditPaymentReport.findUniqueOrThrow({ where: { id: report.id } })).status).toBe('RECORDED');
    }
  });

  it('"Không thấy tiền": báo cáo DISMISSED kèm lý do, nợ giữ nguyên, ghi nhận kèm báo cáo đó bị từ chối', async () => {
    const d = await dealerWithDebt();
    await dealer.reportCreditPayment(d.id, 100_000);
    const report = await prisma.dealerCreditPaymentReport.findFirstOrThrow({ where: { userId: d.id } });

    await expect(dealer.dismissCreditPaymentReport('kt-1', report.id, 'Chưa thấy trên sao kê')).resolves.toEqual({ ok: true, alreadyProcessed: false });
    await expect(dealer.dismissCreditPaymentReport('kt-2', report.id, 'Bấm lại')).resolves.toEqual({ ok: true, alreadyProcessed: true });

    expect(await prisma.dealerCreditPaymentReport.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({ status: 'DISMISSED', resolvedBy: 'kt-1', resolveNote: 'Chưa thấy trên sao kê' });
    await expect(dealer.adminRecordCreditPayment('kt-1', d.id, 100_000, { reportId: report.id })).rejects.toThrow(/không thấy tiền/);
    expect(await balance(d.id)).toBe(500_000);
    expect(await payments(d.id)).toHaveLength(0);
    expect((await dealer.listCreditPaymentReports()).some((r) => r.id === report.id)).toBe(false);
  });

  it('luồng ghi nhận cũ không kèm reportId chạy như trước và không đụng báo cáo đang mở', async () => {
    const d = await dealerWithDebt();
    await dealer.reportCreditPayment(d.id, 100_000);

    await dealer.adminRecordCreditPayment('admin-1', d.id, 100_000, { bankRef: 'FT-OLD' });

    expect(await balance(d.id)).toBe(400_000);
    const [pay] = await payments(d.id);
    expect(pay).toMatchObject({ delta: -100_000, refId: null });
    expect((await prisma.dealerCreditPaymentReport.findFirstOrThrow({ where: { userId: d.id } })).status).toBe('REPORTED');
  });

  it('mã GD đã ghi từ khoản khác: ghi nhận kèm báo cáo không trừ lần hai, báo reportClosed: false và báo cáo vẫn mở; đổi mã GD thì đóng được', async () => {
    const d = await dealerWithDebt();
    const key = `FT-DUP-${randCode(6)}`;
    await dealer.adminRecordCreditPayment('admin-1', d.id, 150_000, { bankRef: key, idempotencyKey: key });
    await dealer.reportCreditPayment(d.id, 150_000);
    const report = await prisma.dealerCreditPaymentReport.findFirstOrThrow({ where: { userId: d.id } });

    const dup = await dealer.adminRecordCreditPayment('kt-1', d.id, 150_000, { reportId: report.id, bankRef: key, idempotencyKey: key, byStaff: true });

    expect(dup).toMatchObject({ balance: 350_000, reportClosed: false });
    expect(await payments(d.id)).toHaveLength(1);
    expect((await prisma.dealerCreditPaymentReport.findUniqueOrThrow({ where: { id: report.id } })).status).toBe('REPORTED');

    const ok = await dealer.adminRecordCreditPayment('kt-1', d.id, 150_000, { reportId: report.id, idempotencyKey: `FT-NEW-${randCode(6)}`, byStaff: true });
    expect(ok).toMatchObject({ balance: 200_000, reportClosed: true });
    expect((await prisma.dealerCreditPaymentReport.findUniqueOrThrow({ where: { id: report.id } })).status).toBe('RECORDED');
  });

  it('báo cáo của đại lý này không đóng được bằng ghi nhận cho đại lý khác', async () => {
    const a = await dealerWithDebt();
    const b = await dealerWithDebt();
    await dealer.reportCreditPayment(a.id, 100_000);
    const report = await prisma.dealerCreditPaymentReport.findFirstOrThrow({ where: { userId: a.id } });

    await expect(dealer.adminRecordCreditPayment('kt-1', b.id, 100_000, { reportId: report.id })).rejects.toThrow(/Không tìm thấy báo cáo/);

    expect(await balance(b.id)).toBe(500_000);
    expect((await prisma.dealerCreditPaymentReport.findUniqueOrThrow({ where: { id: report.id } })).status).toBe('REPORTED');
  });
});
