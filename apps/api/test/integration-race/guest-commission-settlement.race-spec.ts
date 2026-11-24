import { Test, type TestingModule } from '@nestjs/testing';
import type { PaymentMethod, PaymentStatus, OrderStatus } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { AFFILIATE_AUTO_WALLET_TRANSFER_KEY } from '../../src/modules/affiliate/affiliate-auto-transfer-config';
import { countGuestCommissionsAwaitingPayment } from '../../src/modules/affiliate/guest-commission-settlement';
import { createOrder, createUser, pinConfig, uniquePhone, warmPool } from './helpers';

const DAY = 864e5;

/**
 * Cổng chốt hoa hồng đơn khách vãng lai web (tubu-w29-02, PO A3 phương án B) trên Postgres thật, qua cron duyệt thật:
 * hoa hồng của đơn khách chỉ LOCKED → APPROVED khi đơn DELIVERED, đã hết cửa sổ đổi/trả (không còn yêu cầu chờ duyệt) VÀ đã thu tiền
 * (PAID, hoặc COD đã giao). Đơn đăng nhập giữ luật cũ.
 */
describe('Cổng chốt hoa hồng đơn khách vãng lai (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  const restores: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AffiliateService,
        RewardPointsService,
        AnalyticsEventsService,
        { provide: PricingService, useValue: {} },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    restores.push(await pinConfig(prisma, AFFILIATE_AUTO_WALLET_TRANSFER_KEY, false));
    restores.push(await pinConfig(prisma, 'affiliate.hold_days', 10));
    restores.push(await pinConfig(prisma, 'returns.window_days', 7));
    (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
  });

  afterAll(async () => {
    for (const restore of restores.reverse()) await restore();
    await moduleRef?.close();
  });

  async function ctv() {
    return createUser(prisma, { role: 'AFFILIATE', phone: uniquePhone('097') });
  }

  /** Đơn đã giao + dòng hoa hồng LOCKED khoá từ `lockedDaysAgo` ngày trước. `guest` = đơn khách vãng lai web (có guestPhone). */
  async function lockedCommission(
    referrerId: string,
    o: { guest: boolean; paymentMethod: PaymentMethod; paymentStatus: PaymentStatus; status?: OrderStatus; lockedDaysAgo?: number },
  ) {
    const buyer = await createUser(prisma);
    const deliveredAt = new Date(Date.now() - (o.lockedDaysAgo ?? 30) * DAY);
    const order = await createOrder(prisma, {
      userId: buyer.id,
      referrerUserId: referrerId,
      status: o.status ?? 'DELIVERED',
      deliveredAt,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      total: 300_000,
      ...(o.guest ? { guestPhone: uniquePhone('091') } : {}),
    });
    const commission = await prisma.commission.create({
      data: {
        affiliateUserId: referrerId,
        orderId: order.id,
        orderTotal: 300_000,
        commissionableTotal: 300_000,
        rate: 10,
        amount: 30_000,
        status: 'LOCKED',
        lockedAt: deliveredAt,
      },
    });
    return { order, commission };
  }

  const statusOf = async (id: string) => (await prisma.commission.findUniqueOrThrow({ where: { id } })).status;

  it('đơn khách COD đã giao, hết hold: chốt APPROVED (COD giao xong là đã thu tiền)', async () => {
    const a = await ctv();
    const { commission } = await lockedCommission(a.id, { guest: true, paymentMethod: 'COD', paymentStatus: 'UNPAID' });
    await affiliate.approveDueCommissions();
    expect(await statusOf(commission.id)).toBe('APPROVED');
  });

  it('đơn khách chuyển khoản đã giao mà chưa thu tiền: giữ LOCKED, trang CTV báo chờ thanh toán (không hứa ngày); tiền về thì lượt cron sau chốt', async () => {
    const a = await ctv();
    const { order, commission } = await lockedCommission(a.id, { guest: true, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    await affiliate.approveDueCommissions();
    expect(await statusOf(commission.id)).toBe('LOCKED');
    const [row] = await affiliate.listCommissions(a.id);
    expect(row).toMatchObject({ id: commission.id, awaitingPayment: true, unlockEstimateAt: null });
    expect(JSON.stringify(row)).not.toContain(order.guestPhone!);

    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID', paidAt: new Date() } });
    await affiliate.approveDueCommissions();
    expect(await statusOf(commission.id)).toBe('APPROVED');
  });

  it('đơn khách đã thu tiền nhưng còn trong cửa sổ đổi/trả: giữ LOCKED', async () => {
    const a = await ctv();
    const { commission } = await lockedCommission(a.id, { guest: true, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', lockedDaysAgo: 3 });
    await affiliate.approveDueCommissions();
    expect(await statusOf(commission.id)).toBe('LOCKED');
    const [row] = await affiliate.listCommissions(a.id);
    expect(row).toMatchObject({ awaitingPayment: false });
    expect(row!.unlockEstimateAt).toBeInstanceOf(Date);
  });

  it('đơn khách đã hoàn tiền hay thanh toán lỗi, dù đã giao và hết hold: không chốt', async () => {
    const a = await ctv();
    const refunded = await lockedCommission(a.id, { guest: true, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'REFUNDED' });
    const failed = await lockedCommission(a.id, { guest: true, paymentMethod: 'COD', paymentStatus: 'FAILED' });
    await affiliate.approveDueCommissions();
    expect(await statusOf(refunded.commission.id)).toBe('LOCKED');
    expect(await statusOf(failed.commission.id)).toBe('LOCKED');
  });

  it('đơn khách còn yêu cầu đổi/trả chờ duyệt, hay đơn đã lật khỏi DELIVERED: không chốt', async () => {
    const a = await ctv();
    const pendingReturn = await lockedCommission(a.id, { guest: true, paymentMethod: 'COD', paymentStatus: 'UNPAID' });
    await prisma.returnRequest.create({ data: { orderId: pendingReturn.order.id, userId: pendingReturn.order.userId, reason: 'hỏng' } });
    const returned = await lockedCommission(a.id, { guest: true, paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'RETURNED' });
    await affiliate.approveDueCommissions();
    expect(await statusOf(pendingReturn.commission.id)).toBe('LOCKED');
    expect(await statusOf(returned.commission.id)).toBe('LOCKED');
  });

  it('đơn đăng nhập giữ luật cũ: chuyển khoản đã giao chưa lật PAID vẫn chốt sau hold', async () => {
    const a = await ctv();
    const { commission } = await lockedCommission(a.id, { guest: false, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    await affiliate.approveDueCommissions();
    expect(await statusOf(commission.id)).toBe('APPROVED');
    const [row] = await affiliate.listCommissions(a.id);
    expect(row).toMatchObject({ awaitingPayment: false });
  });

  it('khoản chưa chốt không vào số chuyển được và không vào doanh số đã chốt (bậc/mốc); chốt xong thì vào', async () => {
    const a = await ctv();
    const { order } = await lockedCommission(a.id, { guest: true, paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID' });
    await affiliate.approveDueCommissions();
    const before = await affiliate.dashboard(a.id);
    expect(before).toMatchObject({ withdrawableCommission: 0, pendingCommission: 30_000, monthRevenue: 0 });
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID', paidAt: new Date() } });
    await affiliate.approveDueCommissions();
    const after = await affiliate.dashboard(a.id);
    expect(after).toMatchObject({ withdrawableCommission: 30_000, pendingCommission: 0, monthRevenue: 300_000 });
  });

  it('mốc thưởng: "Đang chờ chốt" không cộng khoản đơn khách chưa thu tiền (không chốt sau holdDays); tiền về thì cộng lại', async () => {
    const a = await ctv();
    const guest = await lockedCommission(a.id, { guest: true, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    await lockedCommission(a.id, { guest: false, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', lockedDaysAgo: 3 });
    expect((await affiliate.getMilestones(a.id)).pendingRevenue).toBe(300_000);
    await prisma.order.update({ where: { id: guest.order.id }, data: { paymentStatus: 'PAID', paidAt: new Date() } });
    expect((await affiliate.getMilestones(a.id)).pendingRevenue).toBe(600_000);
  });

  it('cron đêm đếm đúng khoản đơn khách đã giao, quá hạn giữ mà chưa thu tiền (chỉ đọc)', async () => {
    const cutoff = () => new Date(Date.now() - 10 * DAY);
    const base = await countGuestCommissionsAwaitingPayment(prisma, cutoff());
    const a = await ctv();
    const stuckBank = await lockedCommission(a.id, { guest: true, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const stuckFailed = await lockedCommission(a.id, { guest: true, paymentMethod: 'COD', paymentStatus: 'FAILED' });
    await lockedCommission(a.id, { guest: true, paymentMethod: 'COD', paymentStatus: 'UNPAID' });
    await lockedCommission(a.id, { guest: true, paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' });
    await lockedCommission(a.id, { guest: false, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    await lockedCommission(a.id, { guest: true, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', lockedDaysAgo: 3 });
    await lockedCommission(a.id, { guest: true, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', status: 'RETURNED' });
    expect(await countGuestCommissionsAwaitingPayment(prisma, cutoff())).toBe(base + 2);
    await prisma.order.update({ where: { id: stuckBank.order.id }, data: { paymentStatus: 'PAID', paidAt: new Date() } });
    await prisma.commission.update({ where: { id: stuckFailed.commission.id }, data: { status: 'REJECTED' } });
    expect(await countGuestCommissionsAwaitingPayment(prisma, cutoff())).toBe(base);
  });

  it('lật thanh toán song song với 4 lượt cron: hoa hồng chốt đúng một lần, không chốt khi đơn chưa PAID', async () => {
    const a = await ctv();
    const { order, commission } = await lockedCommission(a.id, { guest: true, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    await Promise.all([
      affiliate.approveDueCommissions(),
      affiliate.approveDueCommissions(),
      prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID', paidAt: new Date() } }),
      affiliate.approveDueCommissions(),
      affiliate.approveDueCommissions(),
    ]);
    await affiliate.approveDueCommissions();
    const c = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(c.status).toBe('APPROVED');
    expect(c.approvedAt).toBeInstanceOf(Date);
  });
});
