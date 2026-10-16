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
import { ReferralNoticeReconcileCron } from '../../src/modules/wallet/referral-notice-reconcile.cron';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const REWARD = 100;
const MILESTONE = 20;
const UNIT = 50_000;
const DAY = 864e5;
const CODES = ['REFERRAL_REWARD_PAID', 'REFERRAL_MILESTONE_PAID', 'REFERRAL_REWARD_REVOKED'];

/**
 * R13-G4: tin báo người mời (R6-BUYER-7) chỉ best-effort nên tiến trình chết giữa lúc commit sổ điểm và lúc gửi làm mất tin.
 * Cron ReferralNoticeReconcileCron dựng lại tin từ sổ điểm và gửi bù qua đúng đường cũ (dedupeKey): đúng một tin mỗi dòng sổ,
 * lời tin giống đường trực tiếp. Chạy NotificationsService thật (ghi notification_logs) trên Postgres.
 */
describe('Gửi bù tin báo người mời về thưởng giới thiệu (real Postgres)', () => {
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
  /** Dòng sổ đã quá 5 phút: đồng hồ của cron đi trước, không phải sửa createdAt trong sổ. */
  const later = (ms = 10 * 60_000) => new Date(Date.now() + ms);
  const newCron = () => new ReferralNoticeReconcileCron(prisma, notifier as unknown as NotificationsService);

  /** Quét tới khi cron đi hết một vòng keyset (DB chung có dòng của spec khác trong cửa sổ). */
  async function sweepAll(cron: ReferralNoticeReconcileCron, now: Date) {
    const total = { scanned: 0, missing: 0, sent: 0, failed: 0, skippedNotices: 0 };
    for (let i = 0; i < 100; i++) {
      const r = await cron.sweep(now);
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += r[k];
      if (r.wrapped) return total;
    }
    throw new Error('cron không đi hết một vòng');
  }

  /** Mốc 1 người + trả một phần + trả cả đơn: cấp (PAID, MILESTONE), thu từng phần, thu nốt kèm thu hồi mốc. */
  async function lifecycle(opts: { refereeName?: string; spendBeforeReturn?: number } = {}) {
    await moduleRef.get(SystemConfigService).set('referral.milestones_points', [{ count: 1, bonusPoints: MILESTONE }], admin.id);
    const { referrer, referee, b } = await pair({ refereeName: opts.refereeName });
    await rewards.grantReferralOrderReward(referee.id);
    if (opts.spendBeforeReturn) await spend(referrer.id, opts.spendBeforeReturn);
    await returnUnits(referee.id, b, 1);
    await orderStatus.setStatus(b.id, 'RETURNED');
    return { referrer, referee };
  }

  it('(a) tin cấp thưởng bị sót (sổ commit, gửi tin không chạy): cron gửi đúng một tin; chạy lại, chạy hai cron song song không thêm', async () => {
    failNotify = true;
    const { referrer, referee } = await pair();
    expect(await rewards.grantReferralOrderReward(referee.id)).toBe(true);
    failNotify = false;
    expect(await inbox(referrer.id)).toEqual([]);

    const first = await sweepAll(newCron(), later());
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect(await inbox(referrer.id)).toEqual([['REFERRAL_REWARD_PAID', PAID_BODY]]);
    expect(await inbox(referee.id)).toEqual([]);

    const second = await sweepAll(newCron(), later());
    expect([second.sent, second.failed]).toEqual([0, 0]);
    await Promise.all([newCron().reconcile(later()), newCron().reconcile(later())]);
    expect(await inbox(referrer.id)).toEqual([['REFERRAL_REWARD_PAID', PAID_BODY]]);
    expect(await balanceOf(referrer.id)).toBe(REWARD);
  });

  it('(b) hai lượt quét song song cùng một tin sót: dedupeKey chặn trùng kể cả khi không có khoá cron', async () => {
    failNotify = true;
    const { referrer, referee } = await pair();
    await rewards.grantReferralOrderReward(referee.id);
    failNotify = false;
    const [x, y] = [newCron(), newCron()];
    await Promise.all([sweepAll(x, later()), sweepAll(y, later())]);
    expect(await inbox(referrer.id)).toEqual([['REFERRAL_REWARD_PAID', PAID_BODY]]);
    expect(await balanceOf(referrer.id)).toBe(REWARD);
  });

  it('(c) khoá cron: lượt thứ hai khi lượt đầu còn chạy bị bỏ qua (LOCKED), không gửi trùng', async () => {
    failNotify = true;
    const { referrer, referee } = await pair();
    await rewards.grantReferralOrderReward(referee.id);
    failNotify = false;
    const holder = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cron:wallet.referral_notice_reconcile'))`;
        const blocked = await newCron().reconcile(later());
        expect(blocked).toEqual({ skipped: 'LOCKED' });
        return blocked;
      },
      { timeout: 30_000 },
    );
    expect(holder).toEqual({ skipped: 'LOCKED' });
    expect(await inbox(referrer.id)).toEqual([]);
    const cron = newCron();
    expect(await cron.reconcile(later())).not.toHaveProperty('skipped');
    expect(await inbox(referrer.id)).toEqual([['REFERRAL_REWARD_PAID', PAID_BODY]]);
  });

  it('(d) dòng sổ trẻ hơn 5 phút và cũ hơn 3 ngày không bị quét; trong cửa sổ thì gửi', async () => {
    failNotify = true;
    const { referrer, referee } = await pair();
    await rewards.grantReferralOrderReward(referee.id);
    failNotify = false;
    const cron = newCron();
    await sweepAll(cron, new Date());
    expect(await inbox(referrer.id)).toEqual([]);
    await sweepAll(cron, later(4 * 864e5));
    expect(await inbox(referrer.id)).toEqual([]);
    await sweepAll(cron, later(2 * 864e5));
    expect(await inbox(referrer.id)).toEqual([['REFERRAL_REWARD_PAID', PAID_BODY]]);
  });

  it('(e) cả vòng đời bị sót (cấp, mốc, thu từng phần, thu nốt kèm mốc): cron gửi đúng các tin như đường trực tiếp', async () => {
    const live = await lifecycle();
    const liveInbox = await inbox(live.referrer.id);
    expect(liveInbox.map((r) => r[0])).toEqual(['REFERRAL_REWARD_PAID', 'REFERRAL_MILESTONE_PAID', 'REFERRAL_REWARD_REVOKED', 'REFERRAL_REWARD_REVOKED']);
    expect(liveInbox[3]?.[1]).toContain('đã trừ 87 Điểm Xanh');

    failNotify = true;
    const lost = await lifecycle();
    failNotify = false;
    expect(await inbox(lost.referrer.id)).toEqual([]);
    await sweepAll(newCron(), later());
    expect(await inbox(lost.referrer.id)).toEqual(liveInbox);
    await sweepAll(newCron(), later());
    expect(await inbox(lost.referrer.id)).toEqual(liveInbox);
    expect(await balanceOf(lost.referrer.id)).toBe(0);
  });

  it('(f) thu hồi khi người mời đã tiêu điểm (nợ) và tên số điện thoại: lời tin giống đường trực tiếp', async () => {
    const live = await lifecycle({ refereeName: '0912345678', spendBeforeReturn: 90 });
    const liveInbox = await inbox(live.referrer.id);
    expect(liveInbox.map((r) => r[1]).join('\n')).toContain('còn thiếu');
    expect(liveInbox.map((r) => r[1]).join('\n')).toContain('bạn bè');

    failNotify = true;
    const lost = await lifecycle({ refereeName: '0912345678', spendBeforeReturn: 90 });
    failNotify = false;
    await sweepAll(newCron(), later());
    expect(await inbox(lost.referrer.id)).toEqual(liveInbox);
    expect(await balanceOf(lost.referrer.id)).toBe(await balanceOf(live.referrer.id));
  });

  it('(g) gộp khách làm thưởng bị thu: tin thu hồi (ẩn tên) tới tài khoản giữ thưởng, không có tin "bạn nhận" nêu chính họ', async () => {
    failNotify = true;
    const g = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, fullName: 'Khách' });
    const t = await createUser(prisma, { role: 'CUSTOMER', zaloId: `zalo_${randCode(10)}`, referredById: g.id, fullName: 'Phạm Minh Tuấn' });
    await deliveredOrder(t.id, 9);
    await deliveredOrder(t.id, 4);
    expect(await rewards.grantReferralOrderReward(t.id)).toBe(true);
    zaloIdForNextCall = t.zaloId!;
    await auth.ensurePhoneForCurrentUser(g.id, 'code', 'access');
    failNotify = false;
    expect(await inbox(t.id)).toEqual([]);
    await sweepAll(newCron(), later());
    expect(await inbox(t.id)).toEqual([
      ['REFERRAL_REWARD_REVOKED', 'Thưởng giới thiệu từ bạn bè được thu lại vì liên kết giới thiệu không còn hợp lệ sau khi gộp tài khoản: đã trừ 100 Điểm Xanh.'],
    ]);
    expect(await inbox(g.id)).toEqual([]);
    expect(await balanceOf(t.id)).toBe(0);
  });

  it('(h) tin đã có (kể cả khách đã bấm đã đọc) không bị gửi lại; đường trực tiếp chạy bình thường rồi cron quét không thêm', async () => {
    const { referrer, referee } = await pair();
    await rewards.grantReferralOrderReward(referee.id);
    const log = await prisma.notificationLog.findFirstOrThrow({ where: { userId: referrer.id, templateCode: 'REFERRAL_REWARD_PAID' } });
    await real.markRead(referrer.id, log.id);
    const r = await sweepAll(newCron(), later());
    expect(r.sent).toBe(0);
    expect(await inbox(referrer.id)).toEqual([['REFERRAL_REWARD_PAID', PAID_BODY]]);
  });

  it('(i) cron gửi bù lỗi (notify ném): lượt chạy không ném, không có tin, lượt sau gửi lại đúng một tin', async () => {
    failNotify = true;
    const { referrer, referee } = await pair();
    await rewards.grantReferralOrderReward(referee.id);
    const cron = newCron();
    const res = await cron.reconcile(later());
    expect(res).not.toHaveProperty('skipped');
    expect((res as { failed: number }).failed).toBeGreaterThanOrEqual(1);
    expect(await inbox(referrer.id)).toEqual([]);
    failNotify = false;
    await sweepAll(cron, later());
    expect(await inbox(referrer.id)).toEqual([['REFERRAL_REWARD_PAID', PAID_BODY]]);
    expect(await balanceOf(referrer.id)).toBe(REWARD);
  });

  it('(k) hai lần trả một phần cộng lại đủ cả khoản (đóng khoản thưởng kèm thu mốc trong cùng sự kiện): một tin, cùng số điểm như đường trực tiếp', async () => {
    const scenario = async () => {
      await moduleRef.get(SystemConfigService).set('referral.milestones_points', [{ count: 1, bonusPoints: MILESTONE }], admin.id);
      const { referrer, referee, b } = await pair();
      await rewards.grantReferralOrderReward(referee.id);
      await returnUnits(referee.id, b, 1);
      await returnUnits(referee.id, b, 2);
      return referrer;
    };
    const live = await scenario();
    const liveInbox = await inbox(live.id);
    expect(liveInbox.map((r) => r[0])).toEqual(['REFERRAL_REWARD_PAID', 'REFERRAL_MILESTONE_PAID', 'REFERRAL_REWARD_REVOKED', 'REFERRAL_REWARD_REVOKED']);
    failNotify = true;
    const lost = await scenario();
    failNotify = false;
    await sweepAll(newCron(), later());
    expect(await inbox(lost.id)).toEqual(liveInbox);
    expect(await balanceOf(lost.id)).toBe(await balanceOf(live.id));
  });

  it('(j) handleCron không ném ra ngoài dù truy vấn hỏng', async () => {
    const broken = new ReferralNoticeReconcileCron(
      { $transaction: () => Promise.reject(new Error('db down')) } as unknown as PrismaService,
      real as unknown as NotificationsService,
    );
    await expect(broken.handleCron()).resolves.toBeUndefined();
  });
});
