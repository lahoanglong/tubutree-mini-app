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
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { sendReferralNotices } from '../../src/modules/wallet/referral-notify';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const REWARD = 100;
const MILESTONE = 20;
const UNIT = 50_000;
const DAY = 864e5;
const CODES = ['REFERRAL_REWARD_PAID', 'REFERRAL_MILESTONE_PAID', 'REFERRAL_REWARD_REVOKED'];

/**
 * R6-BUYER-7: người mời được báo trong app khi thưởng giới thiệu được cấp, thưởng mốc được cấp, hoặc thưởng bị thu lại (trả cả
 * đơn, trả một phần, gộp khách). Tin gửi SAU khi tx sổ điểm commit, đúng một tin mỗi dòng sổ dù luồng chạy lại hay chạy song
 * song, và lỗi gửi tin không đổi sổ/số dư. Chạy NotificationsService thật (ghi notification_logs) trên Postgres.
 */
describe('Báo người mời về thưởng giới thiệu (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let returns: OrderReturnsService;
  let rewards: RewardPointsService;
  let auth: AuthService;
  let real: NotificationsService;
  let admin: { id: string };
  let failNotify = false;
  let zaloIdForNextCall = '';
  const notifier = {
    notify: (...args: Parameters<NotificationsService['notify']>) =>
      failNotify ? Promise.reject(new Error('notify down')) : real.notify(...args),
  };
  const CONFIG_KEYS = [
    'returns.window_days',
    'referral.referrer_reward_points',
    'referral.window_days',
    'referral.min_order_amount',
    'referral.milestones_points',
  ];
  let savedConfig: { key: string; value: unknown }[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        RewardPointsService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: notifier },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    real = new NotificationsService(
      prisma,
      { sendTemplate: jest.fn() } as unknown as ZnsClient,
      { recordBestEffort: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService,
    );
    orderStatus = moduleRef.get(OrderStatusService);
    returns = moduleRef.get(OrderReturnsService);
    rewards = moduleRef.get(RewardPointsService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'referral.referrer_reward_points', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.min_order_amount', 100_000);
    await setConfig(prisma, 'referral.milestones_points', []);
    admin = await createUser(prisma, { role: 'ADMIN' });

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-r12', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30, JWT_REFRESH_REUSE_GRACE_SECONDS: 60 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac, notifier as unknown as NotificationsService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  afterEach(async () => {
    failNotify = false;
    await moduleRef.get(SystemConfigService).set('referral.milestones_points', [], admin.id);
  });

  async function deliveredOrder(userId: string, daysAgo: number, qty = 3) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-r12-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 100 },
    });
    const total = qty * UNIT;
    const order = await createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: total,
      shippingFee: 0,
      total,
      createdAt: new Date(Date.now() - daysAgo * DAY),
      deliveredAt: new Date(),
      items: { create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: UNIT, quantity: qty, total, paidTotal: total }] },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { ...order, item };
  }
  type Ord = Awaited<ReturnType<typeof deliveredOrder>>;

  async function pair(opts: { referrerName?: string; refereeName?: string } = {}) {
    const referrer = await createUser(prisma, { role: 'CUSTOMER', fullName: opts.referrerName ?? 'Lê Thị Hoa' });
    const referee = await createUser(prisma, { role: 'CUSTOMER', referredById: referrer.id, fullName: opts.refereeName ?? 'Nguyễn Văn An' });
    const a = await deliveredOrder(referee.id, 9);
    const b = await deliveredOrder(referee.id, 4);
    return { referrer, referee, a, b };
  }

  async function returnUnits(ownerId: string, order: Ord, qty: number) {
    const req = await returns.request(ownerId, order.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: order.item.id, quantity: qty }],
    });
    await returns.review(admin.id, req.id, { approve: true });
    return req.id;
  }

  /** Tin giới thiệu (theo thứ tự gửi) của một user: [mã, nội dung]. */
  async function inbox(userId: string) {
    const rows = await prisma.notificationLog.findMany({
      where: { userId, templateCode: { in: CODES } },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
      select: { templateCode: true, channel: true, payload: true },
    });
    for (const r of rows) expect(r.channel).toBe('INAPP');
    return rows.map((r) => [r.templateCode, (r.payload as { body: string }).body]);
  }

  /** Số dư lô thường khớp tổng sổ, không âm. */
  async function balanceOf(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(sum._sum.delta ?? 0);
    expect(u.pointsBalance).toBeGreaterThanOrEqual(0);
    return u.pointsBalance;
  }

  async function spend(userId: string, points: number) {
    await prisma.$transaction(async (tx) => {
      await tx.pointsTransaction.create({ data: { userId, delta: -points, lot: 'STANDARD', reason: `IT_SPEND:${randCode(6)}`, refType: 'IT' } });
      await tx.user.update({ where: { id: userId }, data: { pointsBalance: { decrement: points } } });
    });
  }

  const PAID_BODY = `Bạn nhận ${REWARD} Điểm Xanh vì An đã mua đơn thứ hai. Cảm ơn bạn đã giới thiệu Tubu Tree 🌿`;

  it('(a) cấp thưởng: người mời nhận đúng một tin, chạy lại và chạy song song không thêm; người được mời không nhận gì', async () => {
    const { referrer, referee } = await pair();
    const results = await Promise.all([1, 2, 3, 4].map(() => rewards.grantReferralOrderReward(referee.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await rewards.grantReferralOrderReward(referee.id)).toBe(false);
    expect(await inbox(referrer.id)).toEqual([['REFERRAL_REWARD_PAID', PAID_BODY]]);
    expect(await inbox(referee.id)).toEqual([]);
    const body = PAID_BODY;
    expect(body).not.toContain('Nguyễn');
    expect(await balanceOf(referrer.id)).toBe(REWARD);
  });

  it('(b) thưởng mốc: một tin cho mốc, gọi lại không gửi lại', async () => {
    await moduleRef.get(SystemConfigService).set('referral.milestones_points', [{ count: 1, bonusPoints: MILESTONE }], admin.id);
    const { referrer, referee } = await pair();
    expect(await rewards.grantReferralOrderReward(referee.id)).toBe(true);
    await rewards.grantReferralOrderReward(referee.id);
    expect(await inbox(referrer.id)).toEqual([
      ['REFERRAL_REWARD_PAID', PAID_BODY],
      ['REFERRAL_MILESTONE_PAID', `Bạn đã giới thiệu thành công 1 người bạn và nhận thêm ${MILESTONE} Điểm Xanh thưởng mốc 🌿`],
    ]);
    expect(await balanceOf(referrer.id)).toBe(REWARD + MILESTONE);
  });

  it('(c) trả một phần rồi trả cả đơn: mỗi lần thu một tin với đúng số đã trừ; trả lần nữa không báo', async () => {
    const { referrer, referee, b } = await pair();
    await rewards.grantReferralOrderReward(referee.id);
    await returnUnits(referee.id, b, 1);
    await orderStatus.setStatus(b.id, 'RETURNED');
    await orderStatus.setStatus(b.id, 'RETURNED').catch(() => undefined);
    expect((await inbox(referrer.id)).slice(1)).toEqual([
      ['REFERRAL_REWARD_REVOKED', 'Thưởng giới thiệu từ An được thu lại vì một phần đơn hàng của bạn ấy đã được trả lại: đã trừ 33 Điểm Xanh.'],
      ['REFERRAL_REWARD_REVOKED', 'Thưởng giới thiệu từ An được thu lại vì đơn hàng của bạn ấy đã được trả lại: đã trừ 67 Điểm Xanh.'],
    ]);
    expect(await inbox(referee.id)).toEqual([]);
    expect(await balanceOf(referrer.id)).toBe(0);
  });

  it('(d) trả một phần khi người mời đã tiêu điểm: tin nêu số thực trừ và số còn thiếu', async () => {
    const { referrer, referee, b } = await pair({ refereeName: '0912345678' });
    await rewards.grantReferralOrderReward(referee.id);
    await spend(referrer.id, 90);
    await returnUnits(referee.id, b, 1);
    expect((await inbox(referrer.id)).slice(1)).toEqual([
      [
        'REFERRAL_REWARD_REVOKED',
        'Thưởng giới thiệu từ bạn bè được thu lại vì một phần đơn hàng của bạn ấy đã được trả lại: đã trừ 10 Điểm Xanh; số dư không đủ nên còn thiếu 23 điểm, Tubu Tree đã ghi nhận phần này.',
      ],
    ]);
    expect(await balanceOf(referrer.id)).toBe(0);
  });

  it('(e) đơn không dùng để thưởng bị trả: không báo ai', async () => {
    const { referrer, referee } = await pair();
    await rewards.grantReferralOrderReward(referee.id);
    const other = await deliveredOrder(referee.id, 1);
    await returnUnits(referee.id, other, 1);
    expect(await inbox(referrer.id)).toEqual([['REFERRAL_REWARD_PAID', PAID_BODY]]);
  });

  it('(f) gửi tin lỗi: thưởng và thu hồi vẫn commit đúng, sổ khớp số dư, không có tin nào', async () => {
    failNotify = true;
    const { referrer, referee, b } = await pair();
    expect(await rewards.grantReferralOrderReward(referee.id)).toBe(true);
    expect(await balanceOf(referrer.id)).toBe(REWARD);
    await returnUnits(referee.id, b, 1);
    expect(await balanceOf(referrer.id)).toBe(REWARD - 33);
    await orderStatus.setStatus(b.id, 'RETURNED');
    expect(await balanceOf(referrer.id)).toBe(0);
    const rows = await prisma.pointsTransaction.findMany({ where: { userId: referrer.id, refType: 'REFERRAL' }, select: { reason: true, delta: true } });
    expect(rows.map((r) => r.delta).sort((x, y) => x - y)).toEqual([-67, -33, REWARD]);
    expect(await inbox(referrer.id)).toEqual([]);
  });

  it('(g) cùng sự kiện gửi lại nhiều lần song song → đúng một tin', async () => {
    const { referrer, referee } = await pair();
    const notice = { kind: 'PAID' as const, referrerId: referrer.id, refereeId: referee.id, points: 7, key: `IT-DUP:${randCode(6)}` };
    const ctx = { prisma, notifications: real, logger: { warn: jest.fn() } };
    await Promise.all([1, 2, 3, 4, 5, 6].map(() => sendReferralNotices(ctx, [notice])));
    expect(await inbox(referrer.id)).toEqual([['REFERRAL_REWARD_PAID', 'Bạn nhận 7 Điểm Xanh vì An đã mua đơn thứ hai. Cảm ơn bạn đã giới thiệu Tubu Tree 🌿']]);
  });

  it('(h) gộp khách: G mời T, T đủ điều kiện, G gộp vào T → T (đang giữ thưởng) nhận tin thu lại, không phải dòng khách', async () => {
    const g = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, fullName: 'Khách' });
    const t = await createUser(prisma, { role: 'CUSTOMER', zaloId: `zalo_${randCode(10)}`, referredById: g.id, fullName: 'Phạm Minh Tuấn' });
    await deliveredOrder(t.id, 9);
    await deliveredOrder(t.id, 4);
    expect(await rewards.grantReferralOrderReward(t.id)).toBe(true);
    expect((await inbox(g.id)).map((r) => r[0])).toEqual(['REFERRAL_REWARD_PAID']);
    zaloIdForNextCall = t.zaloId!;
    await auth.ensurePhoneForCurrentUser(g.id, 'code', 'access');
    expect(await inbox(t.id)).toEqual([
      ['REFERRAL_REWARD_REVOKED', 'Thưởng giới thiệu từ bạn bè được thu lại vì liên kết giới thiệu không còn hợp lệ sau khi gộp tài khoản: đã trừ 100 Điểm Xanh.'],
    ]);
    expect((await inbox(g.id)).map((r) => r[0])).toEqual(['REFERRAL_REWARD_PAID']);
    expect(await balanceOf(t.id)).toBe(0);
  });
});
