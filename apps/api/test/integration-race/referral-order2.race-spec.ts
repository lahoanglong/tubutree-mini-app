import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { applyPointsDelta } from '../../src/modules/loyalty/points-ledger';
import type { PointsLot } from '@prisma/client';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

/** PD-3: thưởng giới thiệu bằng Điểm Xanh (referral.referrer_reward_points); trước gộp là 5.000 xu. */
const REWARD = 5;
const LEGACY_REWARD_XU = 5000;
const DAY = 864e5;
const MIN_ORDER = 200_000;

/** Số dư một lô + tổng sổ của lô đó (bất biến PD-3: phải bằng nhau). */
async function lotOf(prisma: PrismaService, userId: string, lot: PointsLot) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { pointsBalance: true, pointsConvertedBalance: true },
  });
  const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot }, _sum: { delta: true } });
  return { balance: lot === 'CONVERTED' ? u.pointsConvertedBalance : u.pointsBalance, ledger: sum._sum.delta ?? 0 };
}

/** Thưởng mới không bao giờ đi vào sổ xu: không dòng coin mới, coinsBalance giữ 0. */
async function expectNoNewCoins(prisma: PrismaService, userId: string, legacyRows = 0) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coinsBalance: true } });
  expect(u.coinsBalance).toBe(0);
  expect(await prisma.coinTransaction.count({ where: { userId } })).toBe(legacyRows);
}

/** Cộng/trừ một lô qua helper sổ thật (giả lập khách tiêu điểm vào việc khác). */
async function movePoints(prisma: PrismaService, userId: string, lot: PointsLot, delta: number, reason: string) {
  await prisma.$transaction(async (tx) => {
    const res = await applyPointsDelta(tx, { userId, lot, delta, reason, refType: 'TEST' });
    if (!res.applied) throw new Error(`movePoints ${reason} không đủ số dư`);
  });
}

/**
 * Dựng lịch sử TRƯỚC gộp: các dòng thưởng xu ở coin_transactions, rồi đúng việc migration B làm với số
 * dư đó (dòng coin −tổng refType XU_MIGRATION, dòng điểm lô CONVERTED +tổng, 1 điểm = 1đ). Gọi tối đa
 * một lần mỗi user (khoá *_xu_migration_key theo refId = userId).
 */
async function legacyXuHistory(
  prisma: PrismaService,
  userId: string,
  rows: { delta: number; reason: string; refType?: string; refId?: string }[],
) {
  for (const r of rows) {
    await prisma.coinTransaction.create({
      data: { userId, delta: r.delta, reason: r.reason, refType: r.refType ?? 'REFERRAL', refId: r.refId ?? null },
    });
  }
  const total = rows.reduce((sum, r) => sum + r.delta, 0);
  if (total <= 0) return 0;
  const points = total;
  await prisma.coinTransaction.create({
    data: { userId, delta: -total, reason: `XU_TO_POINTS:${points}`, refType: 'XU_MIGRATION', refId: userId },
  });
  await prisma.pointsTransaction.create({
    data: { userId, delta: points, reason: `XU_TO_POINTS:${total}`, refType: 'XU_MIGRATION', refId: userId, lot: 'CONVERTED' },
  });
  await prisma.user.update({ where: { id: userId }, data: { pointsConvertedBalance: { increment: points } } });
  return points;
}

/**
 * Q-05 (C-003): một chương trình giới thiệu duy nhất. Người mời (users.referredById) nhận
 * referral.referrer_reward_points Điểm Xanh (PD-3; trước đây xu) khi người được mời có đơn THỨ 2 giao
 * thành công trong referral.window_days ngày kể từ đơn đầu; bị trả hàng thì thu hồi. Không còn voucher
 * REFER/REFERRED 50k+50k. Chạy trên Postgres thật: OrderStatusService + AffiliateService +
 * RewardPointsService thật.
 */
describe('Thưởng giới thiệu theo đơn thứ 2 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let affiliate: AffiliateService;

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
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orderStatus = moduleRef.get(OrderStatusService);
    affiliate = moduleRef.get(AffiliateService);
    await setConfig(prisma, 'referral.referrer_reward_points', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.milestones_points', []);
    await setConfig(prisma, 'referral.min_order_amount', MIN_ORDER);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function pair(referrerRole: 'CUSTOMER' | 'AFFILIATE' = 'CUSTOMER') {
    const referrer = await createUser(prisma, { role: referrerRole });
    const referee = await createUser(prisma, { referredById: referrer.id });
    return { referrer, referee };
  }

  /** Đơn đang SHIPPING, `daysAgo` ngày trước; giao bằng setStatus để chạy đúng side-effect DELIVERED. */
  async function shippingOrder(userId: string, daysAgo: number, referrerUserId?: string) {
    return createOrder(prisma, {
      userId,
      status: 'SHIPPING',
      total: 250_000,
      subtotal: 250_000,
      referrerUserId: referrerUserId ?? null,
      createdAt: new Date(Date.now() - daysAgo * DAY),
    });
  }

  async function deliveredOrder(userId: string, daysAgo: number, total = 250_000) {
    return createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      total,
      createdAt: new Date(Date.now() - daysAgo * DAY),
      deliveredAt: new Date(),
    });
  }

  /** Lô STANDARD (thưởng giới thiệu mới là Điểm Xanh thường). */
  const pointsOf = (userId: string) => lotOf(prisma, userId, 'STANDARD');

  async function referralCoupons(referrerId: string, refereeId: string) {
    return prisma.coupon.count({
      where: { code: { in: [`REFER-${referrerId}-${refereeId}`.toUpperCase(), `REFERRED-${refereeId}`.toUpperCase()] } },
    });
  }

  it('(a) đơn đầu giao xong: không voucher REFER/REFERRED, chưa thưởng điểm', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 5, referrer.id);
    await orderStatus.setStatus(o1.id, 'DELIVERED');

    expect(await referralCoupons(referrer.id, referee.id)).toBe(0);
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await pointsOf(referee.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(b) đơn thứ 2 trong 30 ngày giao xong → người mời +reward đúng 1 lần, người được mời không thêm điểm', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 20);
    const o2 = await shippingOrder(referee.id, 2);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');

    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await pointsOf(referee.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await referralCoupons(referrer.id, referee.id)).toBe(0);
    await expectNoNewCoins(prisma, referrer.id);

    // Đơn thứ 3 giao sau đó không thưởng thêm.
    const o3 = await shippingOrder(referee.id, 1);
    await orderStatus.setStatus(o3.id, 'DELIVERED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
  });

  it('(c) 2 đơn "thứ 2" giao song song + 5 lần gọi thưởng song song → người mời chỉ +reward 1 lần', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 10);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    const o2 = await shippingOrder(referee.id, 3);
    const o3 = await shippingOrder(referee.id, 2);

    const results = await Promise.allSettled([
      orderStatus.setStatus(o2.id, 'DELIVERED'),
      orderStatus.setStatus(o3.id, 'DELIVERED'),
      ...Array.from({ length: 5 }, () => affiliate.grantReferralReward(o2.id)),
    ]);
    const s = summarize(results);
    expect(s.errors).toEqual([]);

    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    const grants = await prisma.pointsTransaction.count({ where: { userId: referrer.id, delta: { gt: 0 } } });
    expect(grants).toBe(1);
    await expectNoNewCoins(prisma, referrer.id);
  });

  it('(d) đơn thứ 2 ngoài cửa sổ 30 ngày → không thưởng', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 45);
    const o2 = await shippingOrder(referee.id, 1);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(e) người mời là CTV → chỉ hưởng hoa hồng, không điểm giới thiệu', async () => {
    const { referrer, referee } = await pair('AFFILIATE');
    const o1 = await shippingOrder(referee.id, 5, referrer.id);
    const o2 = await shippingOrder(referee.id, 1, referrer.id);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await referralCoupons(referrer.id, referee.id)).toBe(0);
  });

  it('(f) đơn thứ 2 bị trả hàng → thu hồi đủ điểm; trả lại lần nữa không trừ thêm', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect((await pointsOf(referrer.id)).balance).toBe(REWARD);

    await orderStatus.setStatus(o2.id, 'RETURNED');
    await orderStatus.setStatus(o2.id, 'RETURNED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });

    // Đã thu hồi thì không thưởng lại (tránh vòng giao/trả để cày điểm).
    const o3 = await shippingOrder(referee.id, 1);
    await orderStatus.setStatus(o3.id, 'DELIVERED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(g) đơn ĐẦU bị trả hàng sau khi đã thưởng → cũng thu hồi', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect((await pointsOf(referrer.id)).balance).toBe(REWARD);
    await orderStatus.setStatus(o1.id, 'RETURNED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(h) người mời đã tiêu bớt điểm → thu hồi phần còn lại, số dư không âm, ghi cờ nợ cho admin', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    await movePoints(prisma, referrer.id, 'STANDARD', -3, 'REDEEM_TEST');

    await orderStatus.setStatus(o2.id, 'RETURNED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    const debt = await prisma.pointsTransaction.findMany({ where: { userId: referrer.id, refType: 'REFERRAL_DEBT' } });
    expect(debt).toHaveLength(1);
    expect(debt[0]!.delta).toBe(0);
    expect(debt[0]!.lot).toBe('STANDARD');
    expect(debt[0]!.reason).toBe(`REFERRAL_ORDER2_DEBT:${referee.id}:3`);
  });

  it('(i) thưởng và trả đơn đầu chạy song song → kết cục luôn là người mời không giữ điểm', async () => {
    for (let i = 0; i < 5; i += 1) {
      const { referrer, referee } = await pair();
      const o1 = await deliveredOrder(referee.id, 9);
      const o2 = await deliveredOrder(referee.id, 4);
      const results = await Promise.allSettled([
        affiliate.grantReferralReward(o2.id),
        orderStatus.setStatus(o1.id, 'RETURNED'),
      ]);
      expect(summarize(results).errors).toEqual([]);
      const grants = await prisma.pointsTransaction.count({ where: { userId: referrer.id, delta: { gt: 0 } } });
      console.log('[i] vòng %d: thưởng trước rồi thu hồi=%s', i, grants === 1);
      expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    }
  });

  it('(j) người được mời đã có xu giới thiệu kiểu cũ (cashback) → không thưởng lần 2', async () => {
    const { referrer, referee } = await pair();
    await legacyXuHistory(prisma, referrer.id, [
      { delta: LEGACY_REWARD_XU, reason: `REFERRAL_CASHBACK:${referee.id}`, refId: referee.id },
    ]);
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await lotOf(prisma, referrer.id, 'CONVERTED')).toEqual({ balance: 5_000, ledger: 5_000 });
  });

  // ---- T13 (PD-3): thưởng đã cấp bằng xu trước gộp; idempotency đọc HỢP sổ điểm + sổ xu cũ.

  it('(l1) đã thưởng REFERRAL_ORDER2 bằng xu trước gộp → 5 lần xét thưởng song song + đơn thứ 3 không cấp điểm', async () => {
    const { referrer, referee } = await pair();
    const o1 = await deliveredOrder(referee.id, 9);
    const o2 = await deliveredOrder(referee.id, 4);
    await legacyXuHistory(prisma, referrer.id, [
      { delta: LEGACY_REWARD_XU, reason: `REFERRAL_ORDER2:${referee.id}`, refId: `${o1.id}:${o2.id}` },
    ]);

    const results = await Promise.allSettled([
      ...Array.from({ length: 5 }, () => affiliate.grantReferralReward(o2.id)),
      shippingOrder(referee.id, 1).then((o3) => orderStatus.setStatus(o3.id, 'DELIVERED')),
    ]);
    expect(summarize(results).errors).toEqual([]);

    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await lotOf(prisma, referrer.id, 'CONVERTED')).toEqual({ balance: 5_000, ledger: 5_000 });
    expect(await prisma.pointsTransaction.count({ where: { reason: `REFERRAL_ORDER2:${referee.id}` } })).toBe(0);
    await expectNoNewCoins(prisma, referrer.id, 2);
  });

  it('(l2) thưởng xu cũ rồi trả đơn → trừ lô CONVERTED theo xu (1:1), không âm, thiếu ghi REFERRAL_DEBT ở sổ điểm', async () => {
    const { referrer, referee } = await pair();
    const o1 = await deliveredOrder(referee.id, 9);
    const o2 = await deliveredOrder(referee.id, 4);
    // 4.500 xu thưởng + 700 xu khác → 5.200 điểm CONVERTED.
    const converted = await legacyXuHistory(prisma, referrer.id, [
      { delta: 4500, reason: `REFERRAL_ORDER2:${referee.id}`, refId: `${o1.id}:${o2.id}` },
      { delta: 700, reason: `GAME_SELL_HARVEST:${referrer.id}`, refType: 'GAME' },
    ]);
    expect(converted).toBe(5_200);
    await movePoints(prisma, referrer.id, 'CONVERTED', -3_000, 'REDEEM_TEST');

    // Thu hồi 4.500 điểm; lô còn 2.200 → trừ 2.200, thiếu 2.300.
    await orderStatus.setStatus(o2.id, 'RETURNED');
    await orderStatus.setStatus(o1.id, 'RETURNED');
    expect(await lotOf(prisma, referrer.id, 'CONVERTED')).toEqual({ balance: 0, ledger: 0 });
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    const revoke = await prisma.pointsTransaction.findMany({
      where: { userId: referrer.id, reason: `REFERRAL_ORDER2_REVOKE:${referee.id}` },
      select: { delta: true, lot: true },
    });
    expect(revoke).toEqual([{ delta: -2_200, lot: 'CONVERTED' }]);
    const debt = await prisma.pointsTransaction.findMany({
      where: { userId: referrer.id, refType: 'REFERRAL_DEBT' },
      select: { delta: true, lot: true, reason: true },
    });
    expect(debt).toEqual([{ delta: 0, lot: 'CONVERTED', reason: `REFERRAL_ORDER2_DEBT:${referee.id}:2300` }]);
    await expectNoNewCoins(prisma, referrer.id, 3);
  });

  it('(l3) thưởng mới là lô STANDARD có hạn; 5 lần trả đơn song song → đúng 1 dòng thu hồi, lô CONVERTED không bị đụng', async () => {
    const { referrer, referee } = await pair();
    await legacyXuHistory(prisma, referrer.id, [{ delta: 3000, reason: `GAME_SELL_HARVEST:${referrer.id}`, refType: 'GAME' }]);
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');

    const grant = await prisma.pointsTransaction.findFirstOrThrow({
      where: { reason: `REFERRAL_ORDER2:${referee.id}` },
      select: { userId: true, delta: true, lot: true, expiresAt: true },
    });
    expect(grant).toMatchObject({ userId: referrer.id, delta: REWARD, lot: 'STANDARD' });
    expect(grant.expiresAt).not.toBeNull();
    expect(grant.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 25 * DAY);

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => orderStatus.setStatus(o2.id, 'RETURNED')));
    const s = summarize(results);
    console.log('[l3] trả song song: fulfilled=%d errors=%j', s.fulfilled.length, s.errors);
    expect(await prisma.pointsTransaction.count({ where: { reason: `REFERRAL_ORDER2_REVOKE:${referee.id}` } })).toBe(1);
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await lotOf(prisma, referrer.id, 'CONVERTED')).toEqual({ balance: 3_000, ledger: 3_000 });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: o2.id }, select: { status: true } })).toEqual({ status: 'RETURNED' });
  });
  it('(i2) trả đơn đầu GIỮ khoá trước, lần thưởng chờ khoá → thưởng đọc thấy đơn đã trả, không cấp gì', async () => {
    const { referrer, referee } = await pair();
    const o1 = await deliveredOrder(referee.id, 9);
    const o2 = await deliveredOrder(referee.id, 4);
    const results = await runWithFirstHoldingRefereeLock(
      pauseAfterReversal,
      () => orderStatus.setStatus(o1.id, 'RETURNED'),
      () => affiliate.grantReferralReward(o2.id),
    );
    expect(summarize(results).errors).toEqual([]);
    const rows = await prisma.pointsTransaction.findMany({ where: { userId: referrer.id }, select: { reason: true } });
    expect(rows).toEqual([]);
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(i3) thưởng GIỮ khoá trước, lần trả đơn đầu chờ khoá → thưởng rồi bị thu hồi đủ', async () => {
    const { referrer, referee } = await pair();
    const o1 = await deliveredOrder(referee.id, 9);
    const o2 = await deliveredOrder(referee.id, 4);
    const results = await runWithFirstHoldingRefereeLock(
      pauseAfterReferralGrant,
      () => affiliate.grantReferralReward(o2.id),
      () => orderStatus.setStatus(o1.id, 'RETURNED'),
    );
    expect(summarize(results).errors).toEqual([]);
    const reasons = (
      await prisma.pointsTransaction.findMany({ where: { userId: referrer.id }, select: { reason: true } })
    ).map((r) => r.reason);
    expect(reasons.sort()).toEqual([`REFERRAL_ORDER2:${referee.id}`, `REFERRAL_ORDER2_REVOKE:${referee.id}`]);
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(k) đơn dưới referral.min_order_amount không tính là đơn đầu/đơn thứ 2', async () => {
    const { referrer, referee } = await pair();
    const cheap = await deliveredOrder(referee.id, 10, MIN_ORDER - 1);
    const o2 = await deliveredOrder(referee.id, 6);
    await affiliate.grantReferralReward(o2.id);
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });

    const o3 = await deliveredOrder(referee.id, 2);
    await affiliate.grantReferralReward(o3.id);
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    const grant = await prisma.pointsTransaction.findFirstOrThrow({
      where: { reason: `REFERRAL_ORDER2:${referee.id}` },
      select: { refId: true },
    });
    expect(grant.refId).toBe(`${o2.id}:${o3.id}`);
    expect(grant.refId).not.toContain(cheap.id);
  });

  /**
   * Thao tác đầu chạy tới khi đã giữ khoá dòng users của người được mời và dừng lại ngay sau `hold` (vẫn trong tx của nó);
   * thao tác sau chạy và phải thật sự xếp hàng chờ khoá đó rồi thao tác đầu mới được commit. Không dùng một tx giữ khoá hộ:
   * tx trả hàng đã giữ KEY SHARE trên dòng users (chèn lịch sử trạng thái trỏ tới user) nên Postgres không xếp nó vào hàng
   * chờ khoá dòng theo thứ tự đến, và thứ tự giành khoá giữa hai thao tác thành ngẫu nhiên.
   */
  async function runWithFirstHoldingRefereeLock(
    hold: (paused: () => Promise<void>) => jest.SpyInstance,
    first: () => Promise<unknown>,
    second: () => Promise<unknown>,
  ) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let markHeld!: () => void;
    const held = new Promise<void>((r) => (markHeld = r));
    const spy = hold(async () => {
      markHeld();
      await gate;
    });
    const running = [first()];
    try {
      await Promise.race([held, running[0]]);
      running.push(second());
      await waitForLockWaiters(1);
    } finally {
      release();
    }
    const results = await Promise.allSettled(running);
    spy.mockRestore();
    return results;
  }

  function pauseAfterReversal(paused: () => Promise<void>) {
    const reversal = moduleRef.get(OrderReversalService);
    const original = reversal.reverseFinancials.bind(reversal);
    return jest.spyOn(reversal, 'reverseFinancials').mockImplementation(async (...args) => {
      const out = await original(...args);
      await paused();
      return out;
    });
  }

  function pauseAfterReferralGrant(paused: () => Promise<void>) {
    const rewards = moduleRef.get(RewardPointsService);
    const original = rewards.grant.bind(rewards);
    return jest.spyOn(rewards, 'grant').mockImplementation(async (...args) => {
      const out = await original(...args);
      await paused();
      return out;
    });
  }

  async function waitForLockWaiters(n: number) {
    for (let t = 0; t < 400; t += 1) {
      const [row] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if ((row?.n ?? 0) >= n) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`không thấy ${n} phiên chờ khoá`);
  }
});

/**
 * Gộp phiên khách (mergeGuestInto) chuyển đơn của khách sang tài khoản đích nhưng dòng thưởng
 * REFERRAL_ORDER2:<guestId> vẫn mang id khách. Chặn thưởng trùng theo ĐƠN; còn thu hồi thì tách khỏi đơn đã chuyển
 * (G6): trả đơn cũ của khách sau gộp không thu hồi thưởng của người mời khách.
 */
describe('Thưởng giới thiệu sau khi gộp phiên khách (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let auth: AuthService;
  let zaloIdForNextCall = '';

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
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orderStatus = moduleRef.get(OrderStatusService);
    await setConfig(prisma, 'referral.referrer_reward_points', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.milestones_points', []);
    await setConfig(prisma, 'referral.min_order_amount', MIN_ORDER);

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-ref', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** Lô STANDARD (thưởng giới thiệu mới là Điểm Xanh thường). */
  const pointsOf = (userId: string) => lotOf(prisma, userId, 'STANDARD');

  async function deliver(userId: string, daysAgo: number) {
    const o = await createOrder(prisma, {
      userId, status: 'SHIPPING', total: 250_000, subtotal: 250_000, createdAt: new Date(Date.now() - daysAgo * DAY),
    });
    await orderStatus.setStatus(o.id, 'DELIVERED');
    return o;
  }

  async function reasonsOf(userId: string) {
    const rows = await prisma.pointsTransaction.findMany({ where: { userId }, select: { reason: true } });
    return rows.map((r) => r.reason).sort();
  }

  /** Khách G (người mời R) có O1, O2 đã giao → R đã nhận thưởng; rồi G gộp vào T. */
  async function rewardedGuestMergedInto(targetReferrerId: string | null) {
    const referrer = await createUser(prisma);
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, referredById: referrer.id });
    const target = await createUser(prisma, {
      zaloId: `zalo_${randCode(10)}`,
      referredById: targetReferrerId === 'SAME' ? referrer.id : targetReferrerId,
    });
    const o1 = await deliver(guest.id, 9);
    const o2 = await deliver(guest.id, 4);
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });

    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    expect(await prisma.order.count({ where: { id: { in: [o1.id, o2.id] }, userId: target.id } })).toBe(2);
    return { referrer, guest, target, o1, o2 };
  }

  it('(g1) T cùng người mời R: đơn mới của T giao xong không thưởng lại cặp O1:O2; trả O1+O2 sau gộp không thu hồi', async () => {
    const { referrer, guest, target, o1, o2 } = await rewardedGuestMergedInto('SAME');
    await deliver(target.id, 1);
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await reasonsOf(referrer.id)).toEqual([`REFERRAL_ORDER2:${guest.id}`]);

    await orderStatus.setStatus(o1.id, 'RETURNED');
    await orderStatus.setStatus(o2.id, 'RETURNED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await reasonsOf(referrer.id)).toEqual([`REFERRAL_ORDER2:${guest.id}`]);
  });

  it('(g2) T không có người mời: trả O1 rồi O2 sau gộp không thu hồi thưởng của G', async () => {
    const { referrer, guest, o1, o2 } = await rewardedGuestMergedInto(null);
    await orderStatus.setStatus(o1.id, 'RETURNED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    await orderStatus.setStatus(o2.id, 'RETURNED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await reasonsOf(referrer.id)).toEqual([`REFERRAL_ORDER2:${guest.id}`]);
  });

  it('(g3) T có người mời khác R2: R2 chỉ được thưởng từ 2 đơn chưa dùng của T, không từ O1:O2', async () => {
    const r2 = await createUser(prisma);
    const { referrer, target, o1 } = await rewardedGuestMergedInto(r2.id);
    await deliver(target.id, 2);
    expect(await pointsOf(r2.id)).toEqual({ balance: 0, ledger: 0 });
    const o4 = await deliver(target.id, 1);
    expect(await pointsOf(r2.id)).toEqual({ balance: REWARD, ledger: REWARD });
    const grant = await prisma.pointsTransaction.findFirstOrThrow({
      where: { reason: `REFERRAL_ORDER2:${target.id}` },
      select: { refId: true },
    });
    expect(grant.refId?.split(':')).toContain(o4.id);
    expect(grant.refId?.split(':')).not.toContain(o1.id);

    // Trả O1 sau gộp không đụng thưởng của G (người mời R) lẫn thưởng của T.
    await orderStatus.setStatus(o1.id, 'RETURNED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await pointsOf(r2.id)).toEqual({ balance: REWARD, ledger: REWARD });
  });

  it('(g4) không gộp: 2 người được mời cùng R, trả đơn của A chỉ thu hồi lượt của A', async () => {
    const referrer = await createUser(prisma);
    const a = await createUser(prisma, { referredById: referrer.id });
    const b = await createUser(prisma, { referredById: referrer.id });
    const a1 = await deliver(a.id, 9);
    await deliver(a.id, 4);
    await deliver(b.id, 9);
    await deliver(b.id, 4);
    expect(await pointsOf(referrer.id)).toEqual({ balance: 2 * REWARD, ledger: 2 * REWARD });

    await orderStatus.setStatus(a1.id, 'RETURNED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await reasonsOf(referrer.id)).toEqual(
      [`REFERRAL_ORDER2:${a.id}`, `REFERRAL_ORDER2:${b.id}`, `REFERRAL_ORDER2_REVOKE:${a.id}`].sort(),
    );
  });
});

/**
 * Mốc thưởng thêm (referral.milestones_points; trước PD-3 là coins.referral_milestones bằng xu) là thưởng phái sinh của số lượt giới thiệu thành công:
 * lượt nào bị thu hồi làm số lượt còn hiệu lực tụt dưới mốc thì mốc đó cũng phải bị thu hồi.
 */
describe('Mốc thưởng giới thiệu bị thu hồi theo lượt giới thiệu (real Postgres)', () => {
  const MILESTONE = 20;
  const LEGACY_MILESTONE_XU = 20_000;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;

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
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orderStatus = moduleRef.get(OrderStatusService);
    await setConfig(prisma, 'referral.referrer_reward_points', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.min_order_amount', MIN_ORDER);
    await setConfig(prisma, 'referral.milestones_points', [{ count: 2, bonusPoints: MILESTONE }]);
  });

  afterAll(async () => {
    await setConfig(prisma, 'referral.milestones_points', []);
    await moduleRef?.close();
  });

  /** Lô STANDARD (thưởng giới thiệu mới là Điểm Xanh thường). */
  const pointsOf = (userId: string) => lotOf(prisma, userId, 'STANDARD');

  /** Một người được mời của `referrerId` có 2 đơn giao xong; trả về đơn thứ 2. */
  async function qualifiedReferee(referrerId: string) {
    const referee = await createUser(prisma, { referredById: referrerId });
    const o1 = await createOrder(prisma, {
      userId: referee.id, status: 'SHIPPING', total: 250_000, createdAt: new Date(Date.now() - 9 * DAY),
    });
    const o2 = await createOrder(prisma, {
      userId: referee.id, status: 'SHIPPING', total: 250_000, createdAt: new Date(Date.now() - 4 * DAY),
    });
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    return { referee, o2 };
  }

  /** Người được mời có 2 đơn đã giao TRƯỚC gộp (thưởng của họ nằm ở sổ xu cũ, không qua setStatus). */
  async function legacyReferee(referrerId: string) {
    const referee = await createUser(prisma, { referredById: referrerId });
    const mk = (daysAgo: number) =>
      createOrder(prisma, {
        userId: referee.id, status: 'DELIVERED', total: 250_000,
        createdAt: new Date(Date.now() - daysAgo * DAY), deliveredAt: new Date(Date.now() - (daysAgo - 1) * DAY),
      });
    const o1 = await mk(40);
    const o2 = await mk(35);
    return { referee, o1, o2, row: { delta: LEGACY_REWARD_XU, reason: `REFERRAL_ORDER2:${referee.id}`, refId: `${o1.id}:${o2.id}` } };
  }

  async function milestoneRows(referrerId: string) {
    return prisma.pointsTransaction.findMany({
      where: { userId: referrerId, refType: 'REFERRAL', reason: { startsWith: 'REFERRAL_MILESTONE' } },
      select: { reason: true, delta: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  it('(m1) đạt mốc rồi một lượt bị trả hàng → mốc bị thu hồi; trả lặp không trừ thêm', async () => {
    const referrer = await createUser(prisma);
    await qualifiedReferee(referrer.id);
    const b = await qualifiedReferee(referrer.id);
    expect(await pointsOf(referrer.id)).toEqual({ balance: 2 * REWARD + MILESTONE, ledger: 2 * REWARD + MILESTONE });

    await orderStatus.setStatus(b.o2.id, 'RETURNED');
    await orderStatus.setStatus(b.o2.id, 'RETURNED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect((await milestoneRows(referrer.id)).map((r) => r.delta)).toEqual([MILESTONE, -MILESTONE]);
  });

  it('(m2) mốc đã thu hồi được cấp lại đúng 1 lần khi có lượt giới thiệu mới bù vào', async () => {
    const referrer = await createUser(prisma);
    await qualifiedReferee(referrer.id);
    const b = await qualifiedReferee(referrer.id);
    await orderStatus.setStatus(b.o2.id, 'RETURNED');
    await qualifiedReferee(referrer.id);
    expect(await pointsOf(referrer.id)).toEqual({ balance: 2 * REWARD + MILESTONE, ledger: 2 * REWARD + MILESTONE });
    expect((await milestoneRows(referrer.id)).map((r) => r.delta)).toEqual([MILESTONE, -MILESTONE, MILESTONE]);
  });

  it('(m3) người mời đã tiêu điểm mốc → trừ phần còn lại, không âm, ghi REFERRAL_DEBT phần thiếu của mốc', async () => {
    const referrer = await createUser(prisma);
    await qualifiedReferee(referrer.id);
    const b = await qualifiedReferee(referrer.id);
    await movePoints(prisma, referrer.id, 'STANDARD', -25, 'REDEEM_TEST');

    await orderStatus.setStatus(b.o2.id, 'RETURNED');
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    const debts = await prisma.pointsTransaction.findMany({
      where: { userId: referrer.id, refType: 'REFERRAL_DEBT' },
      select: { delta: true, reason: true },
    });
    // Còn 5: lượt giới thiệu lấy đủ 5 trước, mốc 20 thiếu trọn.
    expect(debts.map((d) => d.delta)).toEqual([0]);
    expect(debts[0]!.reason).toMatch(/^REFERRAL_MILESTONE_DEBT:.*:20$/);
  });

  it('(m4) 2 lượt bị trả song song → mốc chỉ bị thu hồi 1 lần, số dư khớp sổ', async () => {
    const referrer = await createUser(prisma);
    const a = await qualifiedReferee(referrer.id);
    const b = await qualifiedReferee(referrer.id);
    const results = await Promise.allSettled([
      orderStatus.setStatus(a.o2.id, 'RETURNED'),
      orderStatus.setStatus(b.o2.id, 'RETURNED'),
    ]);
    expect(summarize(results).errors).toEqual([]);
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect((await milestoneRows(referrer.id)).map((r) => r.delta)).toEqual([MILESTONE, -MILESTONE]);
  });

  // ---- T13 (PD-3): mốc và lượt giới thiệu cấp bằng xu trước gộp.

  it('(m5) mốc cấp bằng xu trước gộp, lượt bị trả → thu hồi lượt + mốc ở lô CONVERTED theo xu (1:1)', async () => {
    const referrer = await createUser(prisma);
    const a = await legacyReferee(referrer.id);
    const b = await legacyReferee(referrer.id);
    await legacyXuHistory(prisma, referrer.id, [
      a.row,
      b.row,
      { delta: LEGACY_MILESTONE_XU, reason: `REFERRAL_MILESTONE:${referrer.id}:2`, refId: referrer.id },
    ]);
    expect(await lotOf(prisma, referrer.id, 'CONVERTED')).toEqual({ balance: 30_000, ledger: 30_000 });

    await orderStatus.setStatus(b.o2.id, 'RETURNED');
    await orderStatus.setStatus(b.o2.id, 'RETURNED');
    expect(await lotOf(prisma, referrer.id, 'CONVERTED')).toEqual({ balance: 5_000, ledger: 5_000 });
    expect(await pointsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    const rows = await prisma.pointsTransaction.findMany({
      where: { userId: referrer.id, refType: 'REFERRAL' },
      select: { reason: true, delta: true, lot: true },
      orderBy: { reason: 'asc' },
    });
    expect(rows).toEqual([
      { reason: `REFERRAL_MILESTONE_REVOKE:${referrer.id}:2#0`, delta: -LEGACY_MILESTONE_XU, lot: 'CONVERTED' },
      { reason: `REFERRAL_ORDER2_REVOKE:${b.referee.id}`, delta: -LEGACY_REWARD_XU, lot: 'CONVERTED' },
    ]);
    await expectNoNewCoins(prisma, referrer.id, 4);

    // Bù 1 lượt mới (điểm) → đếm hợp 2 sổ = 2 → mốc đời mới cấp bằng điểm STANDARD.
    await qualifiedReferee(referrer.id);
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD + MILESTONE, ledger: REWARD + MILESTONE });
    expect((await milestoneRows(referrer.id)).map((r) => r.delta)).toEqual([-LEGACY_MILESTONE_XU, MILESTONE]);
  });

  it('(m6) 1 lượt xu cũ + 1 lượt điểm mới → đạt mốc 2, cấp đúng 1 lần bằng điểm', async () => {
    const referrer = await createUser(prisma);
    const a = await legacyReferee(referrer.id);
    await legacyXuHistory(prisma, referrer.id, [a.row]);
    await qualifiedReferee(referrer.id);
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD + MILESTONE, ledger: REWARD + MILESTONE });
    expect(await lotOf(prisma, referrer.id, 'CONVERTED')).toEqual({ balance: 5_000, ledger: 5_000 });
    expect((await milestoneRows(referrer.id)).map((r) => r.delta)).toEqual([MILESTONE]);
  });

  it('(m7) mốc đã cấp bằng xu trước gộp → đạt lại mốc không cấp thêm bằng điểm', async () => {
    const referrer = await createUser(prisma);
    const a = await legacyReferee(referrer.id);
    const b = await legacyReferee(referrer.id);
    await legacyXuHistory(prisma, referrer.id, [
      a.row,
      b.row,
      { delta: LEGACY_MILESTONE_XU, reason: `REFERRAL_MILESTONE:${referrer.id}:2`, refId: referrer.id },
    ]);
    await qualifiedReferee(referrer.id);
    expect(await pointsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await milestoneRows(referrer.id)).toEqual([]);
  });
});
