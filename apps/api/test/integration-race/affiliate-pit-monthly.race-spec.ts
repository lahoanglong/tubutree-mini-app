import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createOrder, createUser, randCode, setConfig, sleep, warmPool } from './helpers';

/**
 * Q2: thuế TNCN 10% xét trên TỔNG các lần rút hoa hồng trong tháng VN (ngưỡng 2.000.000đ), truy thu phần các lần nhỏ trước.
 * Lệnh bị từ chối, lệnh rút Ví về ngân hàng (không có grossAmount) và lệnh tháng khác không tính vào tổng.
 */
describe('Thuế TNCN cộng dồn theo tháng VN (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  const MST = '079201001234';
  const bank = { bankName: 'VCB', accountNumber: '0123456789', accountName: 'CTV IT' };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        RewardPointsService,
        AffiliateService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    await setConfig(prisma, 'affiliate.min_withdraw_bank', 50_000);
    await setConfig(prisma, 'affiliate.pit_withhold_pct', 0.1);
    await setConfig(prisma, 'affiliate.pit_withhold_threshold', 2_000_000);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function approvedCommission(affiliateUserId: string, amount: number) {
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: affiliateUserId, total: amount * 10 });
    return prisma.commission.create({
      data: {
        affiliateUserId,
        orderId: order.id,
        orderTotal: order.total,
        commissionableTotal: order.total,
        rate: 10,
        amount,
        status: 'APPROVED',
        lockedAt: new Date(Date.now() - 30 * 864e5),
        approvedAt: new Date(),
      },
    });
  }

  async function ctv() {
    return createUser(prisma, { role: 'AFFILIATE' });
  }

  async function monthTotals(userId: string) {
    const rows = await prisma.payout.findMany({ where: { userId, grossAmount: { not: null } }, orderBy: { requestedAt: 'asc' } });
    return {
      rows,
      gross: rows.reduce((s, r) => s + (r.grossAmount ?? 0), 0),
      tax: rows.reduce((s, r) => s + r.taxWithheld, 0),
    };
  }

  it('hai lần rút liên tiếp 1.500.000đ cùng tháng (Ví rồi ngân hàng) → lần 1 không bị trừ, lần 2 bị trừ 300.000đ trên tổng 3.000.000đ', async () => {
    const u = await ctv();
    await approvedCommission(u.id, 1_500_000);
    await affiliate.requestPayout(u.id, 1_500_000, 'WALLET_BALANCE');
    await approvedCommission(u.id, 1_500_000);
    await affiliate.requestPayout(u.id, 1_500_000, 'BANK', bank, undefined, MST);

    const { rows, gross, tax } = await monthTotals(u.id);
    expect(rows.map((r) => r.taxWithheld)).toEqual([0, 300_000]);
    expect(rows.map((r) => r.amount)).toEqual([1_500_000, 1_200_000]);
    expect(gross).toBe(3_000_000);
    expect(tax).toBe(300_000);
  });

  it('lần 3 trong tháng chỉ bị trừ phần chênh: tổng trừ luôn bằng 10% tổng rút của tháng', async () => {
    const u = await ctv();
    for (const amount of [1_500_000, 1_500_000, 1_000_000]) {
      await approvedCommission(u.id, amount);
      await affiliate.requestPayout(u.id, amount, 'WALLET_BALANCE', undefined, undefined, MST);
    }
    const { rows, gross, tax } = await monthTotals(u.id);
    expect(rows.map((r) => r.taxWithheld)).toEqual([0, 300_000, 100_000]);
    expect(tax).toBe(Math.round(gross * 0.1));
  });

  it('lệnh bị từ chối, lệnh rút Ví về ngân hàng (không grossAmount) và lệnh tháng trước không tính vào tổng tháng', async () => {
    const u = await ctv();
    const base = { userId: u.id, method: 'BANK', amount: 1_900_000, fee: 0 };
    await prisma.payout.create({ data: { ...base, grossAmount: 1_900_000, status: 'REJECTED' } });
    await prisma.payout.create({ data: { ...base, grossAmount: null, status: 'PAID', paidAt: new Date() } });
    await prisma.payout.create({
      data: { ...base, grossAmount: 1_900_000, status: 'PAID', paidAt: new Date(), requestedAt: new Date(Date.now() - 45 * 864e5) },
    });
    await approvedCommission(u.id, 1_500_000);
    await affiliate.requestPayout(u.id, 1_500_000, 'WALLET_BALANCE');

    const last = await prisma.payout.findFirstOrThrow({ where: { userId: u.id, method: 'WALLET_BALANCE' } });
    expect(last).toMatchObject({ grossAmount: 1_500_000, taxWithheld: 0, amount: 1_500_000 });
  });

  it('lệnh đang chờ (REQUESTED) và đã duyệt (APPROVED) tính vào tổng tháng như lệnh đã chi', async () => {
    const u = await ctv();
    const base = { userId: u.id, method: 'BANK', fee: 0 };
    await prisma.payout.create({ data: { ...base, grossAmount: 1_000_000, amount: 1_000_000, status: 'REQUESTED' } });
    await prisma.payout.create({ data: { ...base, grossAmount: 1_000_000, amount: 1_000_000, status: 'APPROVED' } });
    await approvedCommission(u.id, 500_000);
    await affiliate.requestPayout(u.id, 500_000, 'WALLET_BALANCE', undefined, undefined, MST);

    const last = await prisma.payout.findFirstOrThrow({ where: { userId: u.id, method: 'WALLET_BALANCE' } });
    expect(last).toMatchObject({ grossAmount: 500_000, taxWithheld: 250_000 });
  });

  it('bốn lệnh rút của cùng một CTV chạy song song (mỗi lệnh 600.000đ, đều đọc tổng tháng trước khi ghi) → không lệnh nào cùng thoát khấu trừ: tổng trừ = 10% × 2.400.000đ', async () => {
    const u = await ctv();
    await prisma.user.update({ where: { id: u.id }, data: { personalTaxId: MST } });
    const commissionIds = (await Promise.all(Array.from({ length: 4 }, () => approvedCommission(u.id, 600_000)))).map((c) => c.id);

    await Promise.all(
      commissionIds.map((commissionId) =>
        prisma.$transaction(async (tx) => {
          // Đúng cách requestPayout dùng: tính thuế trong tx rồi ghi lệnh; sleep kéo dài khe giữa "đọc tổng tháng" và "ghi lệnh".
          await affiliate.lockPitMonth(tx, u.id, new Date());
          const tax = await affiliate.personalIncomeTax(tx, u.id, 600_000);
          await sleep(150);
          const p = await tx.payout.create({
            data: { userId: u.id, method: 'WALLET_BALANCE', status: 'PAID', paidAt: new Date(), grossAmount: 600_000, taxWithheld: tax, amount: 600_000 - tax, taxId: MST },
          });
          await tx.commission.update({ where: { id: commissionId }, data: { status: 'PAID', paidAt: new Date() } });
          return p;
        }),
      ),
    );

    const { rows, gross, tax } = await monthTotals(u.id);
    expect(rows).toHaveLength(4);
    expect(gross).toBe(2_400_000);
    expect(tax).toBe(240_000);
    expect(rows.every((r) => r.taxWithheld >= 0 && r.taxWithheld <= r.grossAmount!)).toBe(true);
  });

  it('requestPayout phải chờ khoá user-tháng: lệnh rút đang giữ khoá chưa commit thì lệnh sau đứng chờ rồi thấy lệnh đó và trừ truy thu', async () => {
    const u = await ctv();
    await prisma.user.update({ where: { id: u.id }, data: { personalTaxId: MST } });
    await approvedCommission(u.id, 1_500_000);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));

    // Lệnh "đến trước": giữ khoá, ghi lệnh 1.500.000đ chưa trừ thuế, chỉ commit khi ta cho phép.
    const first = prisma.$transaction(
      async (tx) => {
        await affiliate.lockPitMonth(tx, u.id, new Date());
        locked();
        await tx.payout.create({
          data: { userId: u.id, method: 'BANK', status: 'REQUESTED', grossAmount: 1_500_000, taxWithheld: 0, amount: 1_500_000, taxId: MST },
        });
        await held;
      },
      { timeout: 20_000 },
    );
    await lockTaken;

    let settled = false;
    const second = affiliate.requestPayout(u.id, 1_500_000, 'WALLET_BALANCE').finally(() => (settled = true));
    await sleep(400);
    expect(settled).toBe(false);
    release();
    await first;
    await second;

    const last = await prisma.payout.findFirstOrThrow({ where: { userId: u.id, method: 'WALLET_BALANCE' } });
    expect(last).toMatchObject({ grossAmount: 1_500_000, taxWithheld: 300_000, amount: 1_200_000 });
  });

  it('hoa hồng mới đến giữa lúc các lệnh rút của cùng CTV đang chạy (Ví và ngân hàng xen kẽ) → tổng trừ = 10% tổng rút, không lệnh nào âm hay vượt số tiền của nó', async () => {
    const u = await ctv();
    await prisma.user.update({ where: { id: u.id }, data: { personalTaxId: MST } });
    const ids: string[] = [];

    await Promise.allSettled(
      Array.from({ length: 4 }, async (_, i) => {
        await sleep(i * 20);
        const c = await approvedCommission(u.id, 700_000);
        ids.push(c.id);
        for (let attempt = 0; attempt < 6; attempt++) {
          const row = await prisma.commission.findUniqueOrThrow({ where: { id: c.id } });
          if (row.status === 'PAID' || row.payoutBatchId) return;
          const { withdrawableCommission } = await affiliate.dashboard(u.id);
          try {
            await affiliate.requestPayout(u.id, withdrawableCommission, i % 2 ? 'BANK' : 'WALLET_BALANCE', i % 2 ? bank : undefined, `pit-${randCode(10)}`);
          } catch {
            await sleep(30);
          }
        }
      }),
    );
    // Lệnh nào còn sót hoa hồng chưa rút (tranh nhau hết lượt thử) thì rút nốt để tổng gộp đủ 2.800.000đ.
    const rest = await prisma.commission.aggregate({ where: { id: { in: ids }, status: 'APPROVED', payoutBatchId: null }, _sum: { amount: true } });
    if (rest._sum.amount) await affiliate.requestPayout(u.id, rest._sum.amount, 'WALLET_BALANCE');

    const { rows, gross, tax } = await monthTotals(u.id);
    expect(gross).toBe(2_800_000);
    expect(tax).toBe(280_000);
    expect(rows.every((r) => r.taxWithheld >= 0 && r.taxWithheld <= r.grossAmount!)).toBe(true);
  });

  describe('từ chối lệnh rút tự hoàn thuế giữ dư (Q2b)', () => {
    async function walletOf(userId: string) {
      const [user, ledger] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
        prisma.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      ]);
      return { balance: user.walletBalance, ledgerSum: ledger.reduce((sum, t) => sum + t.delta, 0), ledger };
    }

    async function payoutVia(userId: string, amount: number, method: 'BANK' | 'WALLET_BALANCE') {
      await approvedCommission(userId, amount);
      await affiliate.requestPayout(userId, amount, method, method === 'BANK' ? bank : undefined, undefined, MST);
      return prisma.payout.findFirstOrThrow({ where: { userId, method }, orderBy: { requestedAt: 'desc' } });
    }

    it('ví dụ của chủ: A rút 1.500.000đ (thuế 0), B rút Ví 1.000.000đ bị giữ 250.000đ; từ chối A → Ví +250.000đ, B.taxRefunded 250.000đ, hoa hồng của A rút lại được', async () => {
      const u = await ctv();
      const a = await payoutVia(u.id, 1_500_000, 'BANK');
      const b = await payoutVia(u.id, 1_000_000, 'WALLET_BALANCE');
      expect(b).toMatchObject({ taxWithheld: 250_000, amount: 750_000, taxRefunded: 0 });

      await affiliate.rejectPayout('admin-it', a.id, 'Sai STK');

      const b2 = await prisma.payout.findUniqueOrThrow({ where: { id: b.id } });
      expect(b2).toMatchObject({ taxWithheld: 250_000, taxRefunded: 250_000, amount: 750_000 });
      const w = await walletOf(u.id);
      expect(w.balance).toBe(1_000_000);
      expect(w.balance).toBe(w.ledgerSum);
      expect(w.ledger.filter((t) => t.type === 'PIT_REFUND').map((t) => t.delta)).toEqual([250_000]);
      const back = await prisma.commission.aggregate({ where: { affiliateUserId: u.id, status: 'APPROVED', payoutBatchId: null }, _sum: { amount: true } });
      expect(back._sum.amount).toBe(1_500_000);
    });

    it('B là lệnh ngân hàng còn "Yêu cầu": thuế giảm về 0 và số thực nhận tăng ngay trên lệnh, Ví không đổi', async () => {
      const u = await ctv();
      const a = await payoutVia(u.id, 1_500_000, 'BANK');
      await approvedCommission(u.id, 1_000_000);
      await affiliate.requestPayout(u.id, 1_000_000, 'BANK', bank, undefined, MST);
      const b = await prisma.payout.findFirstOrThrow({ where: { userId: u.id, status: 'REQUESTED', id: { not: a.id } } });
      expect(b).toMatchObject({ taxWithheld: 250_000, amount: 750_000 });

      await affiliate.rejectPayout('admin-it', a.id, 'Sai STK');

      expect(await prisma.payout.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ taxWithheld: 0, amount: 1_000_000, taxRefunded: 0 });
      const w = await walletOf(u.id);
      expect(w.balance).toBe(0);
      expect(w.ledger).toHaveLength(0);
    });

    it('hai admin từ chối hai lệnh KHÁC NHAU cùng tháng cùng lúc → thuế giữ dư hoàn đúng một lần, Ví khớp sổ, không âm', async () => {
      const u = await ctv();
      const a1 = await payoutVia(u.id, 1_000_000, 'BANK');
      await approvedCommission(u.id, 1_000_000);
      await affiliate.requestPayout(u.id, 1_000_000, 'BANK', bank, undefined, MST);
      const a2 = await prisma.payout.findFirstOrThrow({ where: { userId: u.id, status: 'REQUESTED', id: { not: a1.id } } });
      expect(a2.taxWithheld).toBe(200_000);
      const p = await payoutVia(u.id, 1_000_000, 'WALLET_BALANCE');
      expect(p).toMatchObject({ taxWithheld: 100_000, amount: 900_000 });

      await Promise.all([affiliate.rejectPayout('admin-1', a1.id, 'Sai STK'), affiliate.rejectPayout('admin-2', a2.id, 'Sai STK')]);

      expect(await prisma.payout.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ taxWithheld: 100_000, taxRefunded: 100_000 });
      const w = await walletOf(u.id);
      expect(w.ledger.filter((t) => t.type === 'PIT_REFUND').reduce((sum, t) => sum + t.delta, 0)).toBe(100_000);
      expect(w.balance).toBe(900_000 + 100_000);
      expect(w.balance).toBe(w.ledgerSum);
      expect(w.ledger.every((t) => t.balanceAfter >= 0)).toBe(true);
    });

    it.each([0, 25, 60, 120])(
      'từ chối A song song với requestPayout C cùng tháng (C chạy sau %dms) → thuế thực giữ của các lệnh không bị từ chối đúng bằng thuế của cả tháng, Ví khớp sổ',
      async (delayMs) => {
        const u = await ctv();
        const a = await payoutVia(u.id, 1_500_000, 'BANK');
        await payoutVia(u.id, 1_000_000, 'WALLET_BALANCE');
        await approvedCommission(u.id, 1_500_000);

        // Hoa hồng của A quay lại "có thể rút" ngay khi bị từ chối nên số khả dụng của C đổi theo thứ tự (1,5 hoặc 3 triệu): đọc lại và thử lại.
        const withdrawAll = async () => {
          for (let attempt = 0; ; attempt++) {
            const { withdrawableCommission } = await affiliate.dashboard(u.id);
            try {
              return await affiliate.requestPayout(u.id, withdrawableCommission, 'WALLET_BALANCE', undefined, undefined, MST);
            } catch (e) {
              if (attempt >= 5) throw e;
              await sleep(20);
            }
          }
        };
        await Promise.all([affiliate.rejectPayout('admin-it', a.id, 'Sai STK'), sleep(delayMs).then(withdrawAll)]);

        const live = await prisma.payout.findMany({ where: { userId: u.id, grossAmount: { not: null }, status: { not: 'REJECTED' } } });
        const gross = live.reduce((sum, r) => sum + (r.grossAmount ?? 0), 0);
        const held = live.reduce((sum, r) => sum + r.taxWithheld - r.taxRefunded, 0);
        expect(gross).toBeGreaterThanOrEqual(2_500_000);
        expect(held).toBe(Math.round(gross * 0.1));
        expect(live.every((r) => r.taxWithheld >= 0 && r.taxRefunded >= 0 && r.taxRefunded <= r.taxWithheld)).toBe(true);
        const w = await walletOf(u.id);
        // Mọi lệnh còn lại là rút về Ví: CTV nhận tổng hoa hồng trừ đúng thuế của tháng, bất kể thứ tự hai thao tác.
        expect(w.balance).toBe(gross - held);
        expect(w.balance).toBe(w.ledgerSum);
      },
    );
  });
});
