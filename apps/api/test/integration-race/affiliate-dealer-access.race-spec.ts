import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { vnDateParts } from '../../src/common/vn-time';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * D3-03: CTV được duyệt lên đại lý (role DEALER) giữ gian hàng CTV và hoa hồng đã ghi. Màn hoa hồng, picker và rút tiền phải dùng
 * lại đúng sổ hiện có (commissions, payouts, wallet_transactions) như CTV: rút song song không vượt số dư, thuế TNCN giữ đúng một lần.
 */
describe('Đại lý có gian hàng CTV hoặc hoa hồng xem và rút hoa hồng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  let storefront: StorefrontService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        RewardPointsService,
        AffiliateService,
        StorefrontService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    storefront = moduleRef.get(StorefrontService);
    await setConfig(prisma, 'affiliate.min_withdraw_bank', 50_000);
    await setConfig(prisma, 'affiliate.pit_withhold_pct', 0.1);
    await setConfig(prisma, 'affiliate.pit_withhold_threshold', 2_000_000);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function dealer(extra: { store?: boolean } = {}) {
    const user = await createUser(prisma, { role: 'DEALER' });
    if (extra.store) {
      await prisma.storefront.create({
        data: { type: 'CTV', slug: user.referralCode!.toLowerCase(), ownerUserId: user.id, title: 'Shop đại lý', isPartner: true },
      });
    }
    return user;
  }

  async function approvedCommission(affiliateUserId: string, amount: number, status: 'APPROVED' | 'PAID' | 'REJECTED' = 'APPROVED') {
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
        status,
        lockedAt: new Date(Date.now() - 30 * 864e5),
        approvedAt: new Date(),
      },
    });
  }

  async function ledgerOf(userId: string) {
    const [u, rows] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
      prisma.walletTransaction.findMany({ where: { userId } }),
    ]);
    return { balance: u.walletBalance, sum: rows.reduce((s, r) => s + r.delta, 0), rows };
  }

  it('getMe, picker và gian hàng: đại lý có gian hàng CTV hoặc hoa hồng vào được; đại lý thuần và khách thường không', async () => {
    const withStore = await dealer({ store: true });
    const withCommission = await dealer();
    await approvedCommission(withCommission.id, 40_000, 'PAID');
    const plain = await dealer();
    const customer = await createUser(prisma, { role: 'CUSTOMER' });

    expect(await affiliate.getMe(withStore.id)).toMatchObject({ isAffiliate: true, canRegister: false, canOrderForCustomer: false });
    expect((await affiliate.getMe(withCommission.id)).isAffiliate).toBe(true);
    expect(await affiliate.getMe(plain.id)).toMatchObject({ isAffiliate: false, canRegister: false });
    expect(await affiliate.getMe(customer.id)).toMatchObject({ isAffiliate: false, canRegister: true });

    await expect(storefront.pickerProducts(withStore.id, {})).resolves.toBeInstanceOf(Array);
    await expect(storefront.pickerProducts(withCommission.id, {})).resolves.toBeInstanceOf(Array);
    await expect(storefront.pickerProducts(plain.id, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(storefront.pickerProducts(customer.id, {})).rejects.toBeInstanceOf(BadRequestException);

    const mine = await storefront.getOrCreateMine(withStore.id);
    expect(mine).toMatchObject({ type: 'CTV', ownerUserId: withStore.id });
    await expect(storefront.getOrCreateMine(plain.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.storefront.count({ where: { ownerUserId: plain.id } })).toBe(0);
    await expect(affiliate.quoteOrderForCustomer(withStore.id, { items: [{ variationId: 'x', quantity: 1 }] } as never)).rejects.toThrow(
      'Chỉ CTV mới có thể lên đơn hộ khách.',
    );
  });

  it('đại lý rút 3 triệu về Ví 4 lần song song (khoá khác nhau) → đúng 1 lần thắng, khấu trừ TNCN một lần, số dư ví == tổng sổ', async () => {
    const d = await dealer({ store: true });
    await approvedCommission(d.id, 1_500_000);
    await approvedCommission(d.id, 1_500_000);
    expect((await affiliate.dashboard(d.id)).withdrawableCommission).toBe(3_000_000);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        affiliate.requestPayout(d.id, 3_000_000, 'WALLET_BALANCE', undefined, `dl-${randCode(10)}`, '079201001234'),
      ),
    );
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(1);
    for (const r of s.rejected) expect([BadRequestException, ConflictException].some((c) => r.reason instanceof c)).toBe(true);

    const l = await ledgerOf(d.id);
    expect(l.balance).toBe(2_700_000);
    expect(l.sum).toBe(l.balance);
    expect(l.rows.filter((r) => r.type === 'COMMISSION_PAYOUT')).toHaveLength(1);

    const payouts = await prisma.payout.findMany({ where: { userId: d.id } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ grossAmount: 3_000_000, taxWithheld: 300_000, amount: 2_700_000, taxId: '079201001234', method: 'WALLET_BALANCE' });
    expect(await prisma.commission.count({ where: { affiliateUserId: d.id, status: 'PAID' } })).toBe(2);

    const after = await affiliate.dashboard(d.id);
    expect(after.withdrawableCommission).toBe(0);
    const statement = await affiliate.taxStatement(d.id, vnDateParts().year);
    expect(statement.totals).toMatchObject({ grossAmount: 3_000_000, taxWithheld: 300_000, netAmount: 2_700_000 });
  });

  it('đại lý chỉ còn hoa hồng (không gian hàng) rút về ngân hàng 4 lần song song → đúng 1 lệnh REQUESTED, hoa hồng gắn lô một lần', async () => {
    const d = await dealer();
    await approvedCommission(d.id, 600_000);
    await approvedCommission(d.id, 400_000);
    const bank = { bankName: 'VCB', accountNumber: '0123456789', accountName: 'DAI LY IT' };

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => affiliate.requestPayout(d.id, 1_000_000, 'BANK', bank, `dl-${randCode(10)}`)),
    );
    expect(summarize(results).fulfilled).toHaveLength(1);

    const payouts = await prisma.payout.findMany({ where: { userId: d.id } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ status: 'REQUESTED', method: 'BANK', grossAmount: 1_000_000, taxWithheld: 0, amount: 1_000_000 });
    const batched = await prisma.commission.count({ where: { affiliateUserId: d.id, payoutBatchId: payouts[0]!.id } });
    expect(batched).toBe(2);
    const dash = await affiliate.dashboard(d.id);
    expect(dash.withdrawableCommission).toBe(0);
    expect(dash.withdrawingCommission).toBe(1_000_000);
    expect((await ledgerOf(d.id)).balance).toBe(0);
  });

  it('Ví và ngân hàng chạy chồng nhau: tổng gross các lệnh rút đúng bằng hoa hồng đã duyệt, không ai rút trùng', async () => {
    const d = await dealer({ store: true });
    await approvedCommission(d.id, 800_000);
    await approvedCommission(d.id, 700_000);
    const bank = { bankName: 'ACB', accountNumber: '9876543210', accountName: 'DAI LY IT' };

    const calls = [
      ...Array.from({ length: 3 }, () => affiliate.requestPayout(d.id, 1_500_000, 'WALLET_BALANCE', undefined, `dl-${randCode(10)}`)),
      ...Array.from({ length: 3 }, () => affiliate.requestPayout(d.id, 1_500_000, 'BANK', bank, `dl-${randCode(10)}`)),
    ];
    expect(summarize(await Promise.allSettled(calls)).fulfilled).toHaveLength(1);

    const payouts = await prisma.payout.findMany({ where: { userId: d.id } });
    expect(payouts).toHaveLength(1);
    expect(payouts.reduce((sum, p) => sum + (p.grossAmount ?? 0), 0)).toBe(1_500_000);
    const l = await ledgerOf(d.id);
    expect(l.sum).toBe(l.balance);
    expect(l.balance).toBe(payouts[0]!.method === 'WALLET_BALANCE' ? 1_500_000 : 0);
  });
});
