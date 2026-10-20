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

  it('CTV nhận hoa hồng mới giữa chừng và rút nhiều lệnh song song qua requestPayout → tổng trừ = 10% tổng rút, không lệnh nào âm', async () => {
    const u = await ctv();
    await prisma.user.update({ where: { id: u.id }, data: { personalTaxId: MST } });
    const ids = (await Promise.all(Array.from({ length: 4 }, () => approvedCommission(u.id, 700_000)))).map((c) => c.id);

    await Promise.allSettled(
      ids.map(async (id, i) => {
        await sleep(i * 20);
        for (let attempt = 0; attempt < 6; attempt++) {
          const c = await prisma.commission.findUniqueOrThrow({ where: { id } });
          if (c.status === 'PAID' || c.payoutBatchId) return;
          const { withdrawableCommission } = await affiliate.dashboard(u.id);
          try {
            await affiliate.requestPayout(u.id, withdrawableCommission, i % 2 ? 'BANK' : 'WALLET_BALANCE', i % 2 ? bank : undefined, `pit-${randCode(10)}`);
          } catch {
            await sleep(30);
          }
        }
      }),
    );

    const { rows, gross, tax } = await monthTotals(u.id);
    expect(gross).toBe(2_800_000);
    expect(tax).toBe(280_000);
    expect(rows.every((r) => r.taxWithheld >= 0 && r.taxWithheld <= r.grossAmount!)).toBe(true);
  });
});
