import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { DealerAccountsAdminService } from '../../src/modules/dealer/dealer-accounts-admin.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import * as bankRefLib from '../../src/common/bank-ref';
import { createOrder, createUser, deleteItData, randCode, summarize, warmPool } from './helpers';

/**
 * Sổ công nợ và xác nhận chuyển khoản đại lý trên Postgres THẬT: đại lý bị thu hồi vai trò mà còn nợ vẫn hiện ở màn admin và
 * vẫn ghi nhận trả nợ được (DLSF-02); một mã giao dịch không xác nhận được cho nhiều đơn trả trước, kể cả khi hai admin xác
 * nhận song song (DLSF-05).
 */
describe('Công nợ và mã giao dịch đại lý (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  let accounts: DealerAccountsAdminService;
  const userIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        DealerService,
        DealerAccountsAdminService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined), enqueuePayment: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    dealer = moduleRef.get(DealerService);
    accounts = moduleRef.get(DealerAccountsAdminService);
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
  const prepaidOrder = async (userId: string) =>
    createOrder(prisma, { userId, type: 'DEALER', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 5_000_000 });

  describe('DLSF-02: đại lý bị thu hồi vai trò mà còn nợ', () => {
    it('vẫn ghi nhận trả nợ được, trần vẫn theo dư nợ', async () => {
      const d = await newDealer('CUSTOMER');
      await addDebt(d.id, 3_000_000);
      await expect(dealer.adminRecordCreditPayment('kt', d.id, 3_000_001, { bankRef: 'FT-X' })).rejects.toThrow(/vượt dư nợ/);
      await dealer.adminRecordCreditPayment('kt', d.id, 1_000_000, { bankRef: 'FT-A', idempotencyKey: `FT-A-${randCode(4)}` });
      expect(await debtOf(d.id)).toBe(2_000_000);
    });

    it('người chưa từng là đại lý (không có sổ) vẫn bị từ chối', async () => {
      const u = await newDealer('CUSTOMER');
      await expect(dealer.adminRecordCreditPayment('kt', u.id, 1_000, {})).rejects.toThrow(/Không tìm thấy đại lý/);
    });

    it('danh sách đại lý còn hiện người đã hạ vai trò khi còn nợ, tính vào tổng dư nợ; hết nợ thì không hiện', async () => {
      const d = await newDealer('CUSTOMER');
      await addDebt(d.id, 4_000_000);
      const search = d.phone!;
      const res = await accounts.listAccounts({ page: 1, limit: 20, search } as never);
      const row = res.data.find((r) => r.userId === d.id);
      expect(row).toMatchObject({ debt: 4_000_000, roleRevoked: true });
      expect(res.summary.totalDebt).toBeGreaterThanOrEqual(4_000_000);

      await dealer.adminRecordCreditPayment('kt', d.id, 4_000_000, {});
      const after = await accounts.listAccounts({ page: 1, limit: 20, search } as never);
      expect(after.data.find((r) => r.userId === d.id)).toBeUndefined();
    });

    it('đại lý còn vai trò: roleRevoked = false', async () => {
      const d = await newDealer('DEALER');
      const res = await accounts.listAccounts({ page: 1, limit: 20, search: d.phone! } as never);
      expect(res.data.find((r) => r.userId === d.id)).toMatchObject({ roleRevoked: false });
    });
  });

  describe('DLSF-05: một mã giao dịch không xác nhận cho nhiều đơn', () => {
    it('hai admin xác nhận song song hai đơn cùng mã: một đơn lên PAID, một bị 409', async () => {
      const d = await newDealer();
      const [o1, o2] = [await prepaidOrder(d.id), await prepaidOrder(d.id)];
      const ref = `FT${randCode(8)}`;
      const results = summarize(
        await Promise.allSettled([
          dealer.confirmDealerOrderPayment('ad1', o1.id, { bankRef: ref }),
          dealer.confirmDealerOrderPayment('ad2', o2.id, { bankRef: ` ${ref.toLowerCase()} ` }),
        ]),
      );
      expect(results.fulfilled).toHaveLength(1);
      expect(results.rejected).toHaveLength(1);
      expect(results.errors[0]).toMatch(/đã dùng/);
      const paid = await prisma.order.count({ where: { id: { in: [o1.id, o2.id] }, paymentStatus: 'PAID' } });
      expect(paid).toBe(1);
    });

    it('mã đã dùng ở đơn khác (xác nhận trước đó): 409 nêu mã đơn, đơn sau vẫn UNPAID', async () => {
      const d = await newDealer();
      const [o1, o2] = [await prepaidOrder(d.id), await prepaidOrder(d.id)];
      const ref = `FT${randCode(8)}`;
      await dealer.confirmDealerOrderPayment('ad1', o1.id, { bankRef: ref });
      await expect(dealer.confirmDealerOrderPayment('ad1', o2.id, { bankRef: ref })).rejects.toThrow(new RegExp(`${o1.code}`));
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o2.id } })).paymentStatus).toBe('UNPAID');
    });

    it('mã đã ghi giảm nợ ở sổ công nợ: 409', async () => {
      const d = await newDealer();
      await addDebt(d.id, 9_000_000);
      const ref = `FT${randCode(8)}`;
      await dealer.adminRecordCreditPayment('kt', d.id, 1_000_000, { bankRef: ref, idempotencyKey: ref });
      const o = await prepaidOrder(d.id);
      await expect(dealer.confirmDealerOrderPayment('ad1', o.id, { bankRef: ref })).rejects.toThrow(/đã dùng/);
    });

    it('mã đã xác nhận một đơn thì không ghi giảm nợ được nữa, kể cả chạy song song', async () => {
      const d = await newDealer();
      await addDebt(d.id, 9_000_000);
      const o = await prepaidOrder(d.id);
      const ref = `FT${randCode(8)}`;
      await dealer.confirmDealerOrderPayment('ad1', o.id, { bankRef: ref });
      await expect(dealer.adminRecordCreditPayment('kt', d.id, 5_000_000, { bankRef: ` ${ref.toLowerCase()}`.trim() })).rejects.toThrow(/đã dùng để xác nhận đơn/);
      expect(await debtOf(d.id)).toBe(9_000_000);

      const d2 = await newDealer();
      await addDebt(d2.id, 9_000_000);
      const o2 = await prepaidOrder(d2.id);
      const ref2 = `FT${randCode(8)}`;
      const results = summarize(
        await Promise.allSettled([
          dealer.confirmDealerOrderPayment('ad1', o2.id, { bankRef: ref2 }),
          dealer.adminRecordCreditPayment('kt', d2.id, 5_000_000, { bankRef: ref2 }),
        ]),
      );
      expect(results.fulfilled).toHaveLength(1);
      expect(results.rejected).toHaveLength(1);
    });

    it('xác nhận đơn lấy khoá trước và giữ lâu: ghi giảm nợ cùng mã chờ khoá rồi vẫn thấy mã đã dùng', async () => {
      const d = await newDealer();
      await addDebt(d.id, 9_000_000);
      const o = await prepaidOrder(d.id);
      const ref = `FT${randCode(8)}`;
      const orig = bankRefLib.assertBankRefUnusedByOrder;
      const spy = jest.spyOn(bankRefLib, 'assertBankRefUnusedByOrder').mockImplementation(async (tx, r, id) => {
        await orig(tx, r, id);
        await new Promise((res) => setTimeout(res, 400));
      });
      try {
        const p1 = dealer.confirmDealerOrderPayment('ad1', o.id, { bankRef: ref });
        await new Promise((res) => setTimeout(res, 150));
        const p2 = dealer.adminRecordCreditPayment('kt', d.id, 5_000_000, { bankRef: ref });
        const results = summarize(await Promise.allSettled([p1, p2]));
        expect(results.fulfilled).toHaveLength(1);
        expect(results.rejected).toHaveLength(1);
        expect(results.errors[0]).toMatch(/đã dùng/);
      } finally {
        spy.mockRestore();
      }
      expect(await debtOf(d.id)).toBe(9_000_000);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe('PAID');
    });

    it('trả nợ: mã đã ghi cho đại lý khác hoặc khác hoa thường thì 409, không giảm nợ lần hai', async () => {
      const d1 = await newDealer();
      const d2 = await newDealer();
      await addDebt(d1.id, 9_000_000);
      await addDebt(d2.id, 9_000_000);
      const ref = `FT${randCode(8)}`;
      await dealer.adminRecordCreditPayment('kt', d1.id, 5_000_000, { bankRef: ref, idempotencyKey: ref });
      await expect(dealer.adminRecordCreditPayment('kt', d1.id, 2_000_000, { bankRef: ref.toLowerCase(), idempotencyKey: `k-${randCode(6)}` })).rejects.toThrow(/đã dùng để ghi giảm công nợ/);
      await expect(dealer.adminRecordCreditPayment('kt', d2.id, 2_000_000, { bankRef: ref, idempotencyKey: `k-${randCode(6)}` })).rejects.toThrow(/đã dùng để ghi giảm công nợ/);
      expect(await debtOf(d1.id)).toBe(4_000_000);
      expect(await debtOf(d2.id)).toBe(9_000_000);
      // Bấm lại đúng khoản cũ (cùng khoá, cùng số) vẫn là replay hợp lệ.
      await dealer.adminRecordCreditPayment('kt', d1.id, 5_000_000, { bankRef: ref, idempotencyKey: ref });
      expect(await debtOf(d1.id)).toBe(4_000_000);
    });

    it('mã khác tiền tố và đơn không có mã vẫn xác nhận được', async () => {
      const d = await newDealer();
      const [o1, o2, o3] = [await prepaidOrder(d.id), await prepaidOrder(d.id), await prepaidOrder(d.id)];
      const ref = `FT${randCode(8)}`;
      await dealer.confirmDealerOrderPayment('ad1', o1.id, { bankRef: `${ref}9` });
      await dealer.confirmDealerOrderPayment('ad1', o2.id, { bankRef: ref });
      await dealer.confirmDealerOrderPayment('ad1', o3.id, {});
      expect(await prisma.order.count({ where: { id: { in: [o1.id, o2.id, o3.id] }, paymentStatus: 'PAID' } })).toBe(3);
    });
  });
});
