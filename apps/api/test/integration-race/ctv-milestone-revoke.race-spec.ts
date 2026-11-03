import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { AFFILIATE_AUTO_WALLET_TRANSFER_KEY } from '../../src/modules/affiliate/affiliate-auto-transfer-config';
import { applyPointsDelta } from '../../src/modules/loyalty/points-ledger';
import { vnMonthBounds } from '../../src/modules/affiliate/ctv-milestones';
import { createOrder, createUser, pinConfig, randCode, setConfig, warmPool } from './helpers';

/**
 * CTV-01: đảo hoa hồng đã chốt làm doanh số đã chốt của tháng rơi dưới ngưỡng mốc ĐÃ NHẬN thì thu hồi điểm của mốc đó
 * trong cùng transaction (thiếu số dư thì ghi nợ REFERRAL_DEBT), chạy lại không trừ hai lần, doanh số lên lại thì nhận lại được.
 */
describe('Thu hồi thưởng mốc doanh số CTV khi đảo hoa hồng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  let returns: OrderReturnsService;
  const notify = jest.fn().mockResolvedValue(undefined);
  let restoreAutoWallet: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify, notifySafe: notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    returns = moduleRef.get(OrderReturnsService);
    await setConfig(prisma, 'returns.window_days', 7);
    restoreAutoWallet = await pinConfig(prisma, AFFILIATE_AUTO_WALLET_TRANSFER_KEY, false);
    (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
  });

  afterAll(async () => {
    await restoreAutoWallet?.();
    await moduleRef?.close();
  });

  beforeEach(() => notify.mockClear());

  /** Hoa hồng đã chốt (APPROVED, duyệt tháng này) của một đơn đã giao; nền doanh số = tiền đơn. */
  async function approved(ctvId: string, base: number, approvedAt: Date = new Date()) {
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', deliveredAt: new Date(), referrerUserId: ctvId, subtotal: base, total: base });
    const commission = await prisma.commission.create({
      data: {
        affiliateUserId: ctvId,
        orderId: order.id,
        orderTotal: base,
        commissionableTotal: base,
        rate: 10,
        amount: Math.round(base / 10),
        status: 'APPROVED',
        lockedAt: new Date(Date.now() - 30 * 864e5),
        approvedAt,
      },
    });
    return { buyer, order, commission };
  }

  const returned = (orderId: string) => prisma.order.update({ where: { id: orderId }, data: { status: 'RETURNED' } });
  const balance = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { pointsBalance: true } })).pointsBalance;
  const revokeRows = (id: string) =>
    prisma.pointsTransaction.findMany({ where: { userId: id, reason: { startsWith: 'CTV_MILESTONE_REVOKE:' } }, orderBy: { createdAt: 'asc' } });
  const debtRows = (id: string) => prisma.pointsTransaction.findMany({ where: { userId: id, refType: 'REFERRAL_DEBT' } });
  async function ledgerMatchesBalance(id: string) {
    const agg = await prisma.pointsTransaction.aggregate({ where: { userId: id, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(agg._sum.delta ?? 0).toBe(await balance(id));
  }

  /** CTV có doanh số chốt 10,2tr (đơn A 2,2tr + đơn B 8tr) đã nhận mốc 3tr và 10tr. */
  async function claimedCtv(a = 2_200_000, b = 8_000_000) {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const first = await approved(ctv.id, a);
    const second = await approved(ctv.id, b);
    await affiliate.claimMilestone(ctv.id, 'milestone-3m');
    await affiliate.claimMilestone(ctv.id, 'milestone-10m');
    expect(await balance(ctv.id)).toBe(250_000);
    return { ctv, first, second };
  }

  it('(a) mốc 10tr đã nhận, trả đơn làm doanh số còn 8tr: trừ đúng 200.000 điểm của mốc 10tr một lần, mốc 3tr giữ, báo CTV một tin', async () => {
    const { ctv, first } = await claimedCtv();
    await returned(first.order.id);
    await affiliate.reverseCommissionsForOrder(first.order.id);

    expect(await balance(ctv.id)).toBe(50_000);
    const rows = await revokeRows(ctv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: -200_000, lot: 'STANDARD' });
    expect(await debtRows(ctv.id)).toHaveLength(0);
    await ledgerMatchesBalance(ctv.id);
    expect(notify.mock.calls.filter((c) => c[0] === ctv.id && c[1] === 'COMMISSION_MILESTONE_REVOKED')).toHaveLength(1);
    const m = await affiliate.getMilestones(ctv.id);
    expect(m.milestones.find((x) => x.id === 'milestone-3m')).toMatchObject({ claimed: true });
    expect(m.milestones.find((x) => x.id === 'milestone-10m')).toMatchObject({ claimed: false, canClaim: false });
  });

  const revokeNotices = (ctvId: string) => notify.mock.calls.filter((c) => c[0] === ctvId && c[1] === 'COMMISSION_MILESTONE_REVOKED');

  it('tin thu hồi nêu số điểm thực thu: lô thưởng đã hết hạn 50.000 thì thu 150.000, không báo 200.000', async () => {
    const { ctv, first } = await claimedCtv();
    const claim = await prisma.ctvMilestoneClaim.findFirstOrThrow({ where: { userId: ctv.id, milestoneId: 'milestone-10m' } });
    await prisma.pointsTransaction.updateMany({
      where: { userId: ctv.id, refType: 'AFFILIATE_MILESTONE', refId: claim.id },
      data: { expiresAt: new Date(Date.now() - 864e5) },
    });
    await prisma.$transaction((tx) => applyPointsDelta(tx, { userId: ctv.id, delta: -50_000, lot: 'STANDARD', reason: 'POINTS_EXPIRED', refType: 'EXPIRE' }));
    await returned(first.order.id);
    await affiliate.reverseCommissionsForOrder(first.order.id);

    const rows = await revokeRows(ctv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.delta).toBe(-150_000);
    const notices = revokeNotices(ctv.id);
    expect(notices).toHaveLength(1);
    expect(notices[0]![2].points).toBe((150_000).toLocaleString('vi-VN'));
  });

  it('câu "nhận lại được" chỉ có khi tháng bị thu là tháng VN hiện tại; tháng đã qua thì để trống', async () => {
    const cur = await claimedCtv();
    await returned(cur.first.order.id);
    await affiliate.reverseCommissionsForOrder(cur.first.order.id);
    expect(revokeNotices(cur.ctv.id)[0]![2].reclaim_note).toMatch(/nhận lại/);

    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const prevMonth = new Date(Date.now() - 31 * 864e5);
    const a = await approved(ctv.id, 2_200_000, prevMonth);
    await approved(ctv.id, 8_000_000, prevMonth);
    const prevKey = vnMonthBounds(prevMonth).key;
    await affiliate.claimMilestone(ctv.id, 'milestone-10m', prevKey);
    await returned(a.order.id);
    await affiliate.reverseCommissionsForOrder(a.order.id);
    const notices = revokeNotices(ctv.id);
    expect(notices).toHaveLength(1);
    expect(notices[0]![2].reclaim_note).toBe('');
  });

  it('một lần đảo làm rơi cả mốc 3tr lẫn 10tr: CTV nhận đúng một tin nêu cả hai mốc và tổng điểm thu', async () => {
    const { ctv, first } = await claimedCtv(9_000_000, 1_200_000);
    await returned(first.order.id);
    await affiliate.reverseCommissionsForOrder(first.order.id);
    expect(await balance(ctv.id)).toBe(0);
    const notices = revokeNotices(ctv.id);
    expect(notices).toHaveLength(1);
    expect(notices[0]![2].milestone).toMatch(/3/);
    expect(notices[0]![2].milestone).toMatch(/10/);
    expect(notices[0]![2].points).toBe((250_000).toLocaleString('vi-VN'));
    await affiliate.reverseCommissionsForOrder(first.order.id);
    expect(new Set(revokeNotices(ctv.id).map((c) => c[3]?.dedupeKey)).size).toBe(1);
  });

  it('thu được 0 điểm (lô thưởng đã hết hạn hết) và không nợ: không báo CTV', async () => {
    const { ctv, first } = await claimedCtv();
    const claim = await prisma.ctvMilestoneClaim.findFirstOrThrow({ where: { userId: ctv.id, milestoneId: 'milestone-10m' } });
    await prisma.pointsTransaction.updateMany({
      where: { userId: ctv.id, refType: 'AFFILIATE_MILESTONE', refId: claim.id },
      data: { expiresAt: new Date(Date.now() - 864e5) },
    });
    await prisma.$transaction((tx) => applyPointsDelta(tx, { userId: ctv.id, delta: -200_000, lot: 'STANDARD', reason: 'POINTS_EXPIRED', refType: 'EXPIRE' }));
    await returned(first.order.id);
    await affiliate.reverseCommissionsForOrder(first.order.id);
    expect(await revokeRows(ctv.id)).toHaveLength(0);
    expect(revokeNotices(ctv.id)).toHaveLength(0);
  });

  it('tháng đã qua còn nợ: tin không hứa "sẽ trừ khi bạn nhận lại mốc"', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const prevMonth = new Date(Date.now() - 31 * 864e5);
    const a = await approved(ctv.id, 2_200_000, prevMonth);
    await approved(ctv.id, 8_000_000, prevMonth);
    await affiliate.claimMilestone(ctv.id, 'milestone-10m', vnMonthBounds(prevMonth).key);
    await prisma.$transaction((tx) => applyPointsDelta(tx, { userId: ctv.id, delta: -150_000, lot: 'STANDARD', reason: 'ORDER_REDEEM', refType: 'ORDER', refId: randCode() }));
    await returned(a.order.id);
    await affiliate.reverseCommissionsForOrder(a.order.id);
    const notices = revokeNotices(ctv.id);
    expect(notices).toHaveLength(1);
    expect(notices[0]![2].debt_note).toMatch(/chưa thu hết/);
    expect(notices[0]![2].debt_note).not.toMatch(/nhận lại/);
  });

  it('(e) chạy lại lần đảo: không trừ lần hai, không báo lần hai', async () => {
    const { ctv, first } = await claimedCtv();
    await returned(first.order.id);
    await affiliate.reverseCommissionsForOrder(first.order.id);
    await affiliate.reverseCommissionsForOrder(first.order.id);
    expect(await balance(ctv.id)).toBe(50_000);
    expect(await revokeRows(ctv.id)).toHaveLength(1);
    const keys = notify.mock.calls.filter((c) => c[0] === ctv.id && c[1] === 'COMMISSION_MILESTONE_REVOKED').map((c) => c[3]?.dedupeKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('mốc đã thu hồi: doanh số lên lại trên ngưỡng thì nhận lại được một lần, không cộng hai lần cho cùng một lần đạt', async () => {
    const { ctv, first } = await claimedCtv();
    await returned(first.order.id);
    await affiliate.reverseCommissionsForOrder(first.order.id);
    await expect(affiliate.claimMilestone(ctv.id, 'milestone-10m')).rejects.toThrow(/chưa đạt/);
    await approved(ctv.id, 3_000_000);
    const res = await affiliate.claimMilestone(ctv.id, 'milestone-10m');
    expect(res.rewardPoints).toBe(200_000);
    expect(await balance(ctv.id)).toBe(250_000);
    await expect(affiliate.claimMilestone(ctv.id, 'milestone-10m')).rejects.toThrow('Bạn đã nhận thưởng mốc này rồi.');
    expect(await balance(ctv.id)).toBe(250_000);
    await ledgerMatchesBalance(ctv.id);
  });

  it('(c) số dư thiếu: trừ hết số dư, phần còn lại ghi nợ REFERRAL_DEBT (delta 0); nhận lại thì trừ phần nợ', async () => {
    const { ctv, first } = await claimedCtv();
    await prisma.$transaction((tx) => applyPointsDelta(tx, { userId: ctv.id, delta: -240_000, lot: 'STANDARD', reason: 'IT_SPEND', refType: 'IT' }));
    expect(await balance(ctv.id)).toBe(10_000);
    await returned(first.order.id);
    await affiliate.reverseCommissionsForOrder(first.order.id);

    expect(await balance(ctv.id)).toBe(0);
    const rows = await revokeRows(ctv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.delta).toBe(-10_000);
    const debts = await debtRows(ctv.id);
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ delta: 0 });
    expect(debts[0]!.reason).toMatch(/:190000$/);
    await ledgerMatchesBalance(ctv.id);

    await approved(ctv.id, 3_000_000);
    const res = await affiliate.claimMilestone(ctv.id, 'milestone-10m');
    expect(res.rewardPoints).toBe(10_000);
    expect(await balance(ctv.id)).toBe(10_000);
    await ledgerMatchesBalance(ctv.id);
  });

  it('(d) hai đơn bị đảo song song: mốc chỉ bị trừ một lần', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    // Doanh số 1,1tr + 1,1tr + 8tr = 10,2tr; mỗi đơn A/B bị trả đều kéo xuống dưới 10tr.
    const first = await approved(ctv.id, 1_100_000);
    const second = await approved(ctv.id, 1_100_000);
    await approved(ctv.id, 8_000_000);
    await affiliate.claimMilestone(ctv.id, 'milestone-10m');
    expect(await balance(ctv.id)).toBe(200_000);
    await Promise.all([returned(first.order.id), returned(second.order.id)]);
    await Promise.all([affiliate.reverseCommissionsForOrder(first.order.id), affiliate.reverseCommissionsForOrder(second.order.id)]);
    expect(await balance(ctv.id)).toBe(0);
    expect(await revokeRows(ctv.id)).toHaveLength(1);
    expect(await debtRows(ctv.id)).toHaveLength(0);
    await ledgerMatchesBalance(ctv.id);
  });

  it('(d2) đảo song song với nhận mốc: không ai giữ thưởng khi doanh số đã rơi dưới ngưỡng', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const first = await approved(ctv.id, 2_000_000);
    await approved(ctv.id, 8_000_000);
    await returned(first.order.id);
    await Promise.allSettled([affiliate.claimMilestone(ctv.id, 'milestone-10m'), affiliate.reverseCommissionsForOrder(first.order.id)]);
    const claim = await prisma.ctvMilestoneClaim.findFirst({ where: { userId: ctv.id, milestoneId: 'milestone-10m' } });
    // Nhận trước thì đảo thu lại; đảo trước thì nhận bị từ chối. Cả hai đều không để 200.000 điểm nằm lại.
    expect(await balance(ctv.id)).toBe(0);
    if (claim) expect(await revokeRows(ctv.id)).toHaveLength(1);
    await ledgerMatchesBalance(ctv.id);
  });

  it('admin từ chối lệnh rút NH cũ có hoa hồng của đơn đã trả: doanh số còn dưới ngưỡng thì thu hồi mốc 10tr', async () => {
    const { ctv, first } = await claimedCtv();
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const payout = await prisma.payout.create({
      data: { userId: ctv.id, amount: 220_000, grossAmount: 220_000, method: 'BANK', status: 'REQUESTED' },
    });
    await prisma.commission.update({ where: { id: first.commission.id }, data: { payoutBatchId: payout.id } });
    await returned(first.order.id);
    await prisma.commission.update({ where: { id: first.commission.id }, data: { status: 'APPROVED' } });
    expect(await balance(ctv.id)).toBe(250_000);

    await affiliate.rejectPayout(admin.id, payout.id, 'IT từ chối');

    expect(await prisma.commission.findUniqueOrThrow({ where: { id: first.commission.id } })).toMatchObject({ status: 'REJECTED' });
    expect(await balance(ctv.id)).toBe(50_000);
    expect(await revokeRows(ctv.id)).toHaveLength(1);
    expect(revokeNotices(ctv.id)).toHaveLength(1);
    await ledgerMatchesBalance(ctv.id);
  });

  describe('(b) trả một phần', () => {
    async function variation(price: number) {
      const tag = randCode(8);
      const product = await prisma.product.create({
        data: { pancakeId: `it-cmr-p-${tag}`, brand: 'IT', slug: `it-cmr-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: price },
      });
      return prisma.variation.create({
        data: { pancakeId: `it-cmr-v-${tag}`, productId: product.id, sku: `ITCMR-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, affiliateRate: 10, stock: 50 },
      });
    }

    it('trả nửa đơn 10tr làm doanh số còn 5tr: trừ mốc 10tr, giữ mốc 3tr', async () => {
      const ctv = await createUser(prisma, { role: 'AFFILIATE' });
      const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const admin = await createUser(prisma, { role: 'ADMIN' });
      const v = await variation(5_000_000);
      const order = await createOrder(prisma, {
        userId: buyer.id,
        referrerUserId: ctv.id,
        status: 'DELIVERED',
        deliveredAt: new Date(),
        subtotal: 10_000_000,
        total: 10_000_000,
        items: { create: [{ variationId: v.id, productName: 'A', variationName: 'Mặc định', unitPrice: 5_000_000, quantity: 2, total: 10_000_000, paidTotal: 10_000_000 }] },
      });
      await affiliate.createCommissionForOrder(order.id);
      await affiliate.lockCommissionsForOrder(order.id);
      await prisma.commission.updateMany({ where: { orderId: order.id }, data: { lockedAt: new Date(Date.now() - 40 * 864e5) } });
      await affiliate.approveDueCommissions();
      expect(await prisma.commission.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: 'APPROVED', commissionableTotal: 10_000_000 });
      await affiliate.claimMilestone(ctv.id, 'milestone-3m');
      await affiliate.claimMilestone(ctv.id, 'milestone-10m');
      expect(await balance(ctv.id)).toBe(250_000);

      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      const req = await returns.request(buyer.id, order.code, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: item.id, quantity: 1 }], refundMethod: 'WALLET' });
      await returns.review(admin.id, req.id, { approve: true });

      expect(await prisma.commission.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ commissionableTotal: 5_000_000 });
      expect(await balance(ctv.id)).toBe(50_000);
      expect(await revokeRows(ctv.id)).toHaveLength(1);
      expect(notify.mock.calls.filter((c) => c[0] === ctv.id && c[1] === 'COMMISSION_MILESTONE_REVOKED')).toHaveLength(1);
      await ledgerMatchesBalance(ctv.id);
    });
  });
});
