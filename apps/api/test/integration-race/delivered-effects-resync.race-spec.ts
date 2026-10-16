import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { REFERRAL_ORDER2_PREFIX } from '../../src/modules/wallet/referral-reward';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { DeliveredEffectsResyncCron } from '../../src/modules/orders/delivered-effects-resync.cron';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { OpsHealthService, type OpsQueue } from '../../src/modules/ops/ops-health.service';
import { createOrder, createUser, markDeliveredEffectsDone, setConfig, sleep, summarize, warmPool } from './helpers';

const EARNED = 30;
const REWARD = 5;
const COMMISSION = 12_500;
const MIN = 60_000;
const DAY = 864e5;
const PROBLEM = 'orders.delivered_effects';

/**
 * Việc sau giao (cộng Điểm Xanh, khoá hoa hồng CTV, thưởng giới thiệu) chạy SAU khi lần lật DELIVERED commit. Lỗi ở đó
 * (deadlock, hết kết nối, tiến trình chết giữa chừng) trước đây mất vĩnh viễn: gọi lại DELIVERED là no-op. Nay đơn chỉ có mốc
 * deliveredEffectsAt khi mọi việc xong; cron quét đơn giao trong 14 ngày, quá 10 phút mà chưa có mốc thì chạy lại — mỗi việc
 * idempotent nên chạy song song với đường chính, với lần gọi DELIVERED lặp và với cron của replica khác vẫn chỉ cộng một lần.
 */
describe('Việc sau giao: chạy lại được, đúng một lần (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let loyalty: LoyaltyService;
  let cron: DeliveredEffectsResyncCron;
  let health: OpsHealthService;
  let savedConfig: { key: string; value: unknown }[] = [];
  const CONFIG_KEYS = ['referral.referrer_reward_points', 'referral.window_days', 'referral.milestones_points', 'referral.min_order_amount'];

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
        DeliveredEffectsResyncCron,
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
    loyalty = moduleRef.get(LoyaltyService);
    cron = moduleRef.get(DeliveredEffectsResyncCron);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'referral.referrer_reward_points', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.milestones_points', []);
    await setConfig(prisma, 'referral.min_order_amount', 200_000);

    const queue = (name: string): OpsQueue => ({
      name,
      getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0, failed: 0 }),
      getFailed: async () => [],
    });
    const sysConfig = {
      get: async <T,>(key: string, fallback: T): Promise<T> => {
        const row = await prisma.systemConfig.findUnique({ where: { key } });
        return (row?.value as T) ?? fallback;
      },
    };
    // Pancake/Gomdon chưa cấu hình: chỉ hàng việc sau giao quyết định sự cố.
    health = new OpsHealthService(
      prisma,
      { get: () => '' } as never,
      [queue('pancake-push')],
      sysConfig as never,
      { getConfig: async () => null, getHealth: () => null } as never,
      { notify: jest.fn().mockResolvedValue(undefined) } as never,
      jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never,
    );
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  // Chỉ khôi phục spy của spec này — restoreAllMocks xoá luôn implementation của các jest.fn() provider (notify…).
  const spies: jest.SpyInstance[] = [];
  function spy<T extends object>(obj: T, method: keyof T & string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = jest.spyOn(obj as any, method);
    spies.push(s);
    return s;
  }

  afterEach(() => {
    while (spies.length) spies.pop()?.mockRestore();
  });

  beforeEach(async () => {
    // DB dùng chung: đơn DELIVERED chưa xong việc của spec khác không phải việc của spec này.
    await markDeliveredEffectsDone(prisma);
    await prisma.opsHealthState.deleteMany({});
  });

  /**
   * Người mời (khách thường) → khách đã có một đơn giao 5 ngày trước; đơn thứ hai đang giao, CTV giới thiệu có hoa hồng PENDING.
   * Giao đơn thứ hai: +EARNED Điểm Xanh cho khách, hoa hồng LOCKED, người mời +REWARD (đơn thứ 2 trong cửa sổ).
   */
  async function scenario(data: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
    const referrer = await createUser(prisma, { role: 'CUSTOMER' });
    const customer = await createUser(prisma, { referredById: referrer.id });
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    await createOrder(prisma, {
      userId: customer.id,
      status: 'DELIVERED',
      total: 250_000,
      subtotal: 250_000,
      createdAt: new Date(Date.now() - 5 * DAY),
      deliveredAt: new Date(Date.now() - 4 * DAY),
      deliveredEffectsAt: new Date(Date.now() - 4 * DAY),
    });
    const order = await createOrder(prisma, {
      userId: customer.id,
      status: 'SHIPPING',
      total: 250_000,
      subtotal: 250_000,
      pointsEarned: EARNED,
      referrerUserId: ctv.id,
      createdAt: new Date(Date.now() - DAY),
      ...data,
    });
    await prisma.commission.create({
      data: { affiliateUserId: ctv.id, orderId: order.id, orderTotal: order.total, commissionableTotal: order.total, rate: 5, amount: COMMISSION },
    });
    return { referrer, customer, ctv, order };
  }

  async function ledgerMatches(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(sum._sum.delta ?? 0);
    return u.pointsBalance;
  }

  /** Mọi việc sau giao đã xảy ra ĐÚNG một lần. */
  async function expectAllEffectsOnce(s: Awaited<ReturnType<typeof scenario>>) {
    const credits = await prisma.pointsTransaction.findMany({ where: { userId: s.customer.id, reason: `ORDER_DELIVERED:${s.order.code}` } });
    expect(credits.map((c) => c.delta)).toEqual([EARNED]);
    expect(await ledgerMatches(s.customer.id)).toBe(EARNED);
    expect(await prisma.commission.findMany({ where: { orderId: s.order.id }, select: { status: true, amount: true } })).toEqual([
      { status: 'LOCKED', amount: COMMISSION },
    ]);
    const rewards = await prisma.pointsTransaction.findMany({ where: { userId: s.referrer.id, reason: `${REFERRAL_ORDER2_PREFIX}${s.customer.id}` } });
    expect(rewards.map((r) => r.delta)).toEqual([REWARD]);
    expect(await ledgerMatches(s.referrer.id)).toBe(REWARD);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } });
    expect(after.status).toBe('DELIVERED');
    expect(after.deliveredEffectsAt).not.toBeNull();
  }

  async function expectNoEffects(s: Awaited<ReturnType<typeof scenario>>) {
    expect(await prisma.pointsTransaction.count({ where: { userId: s.customer.id, reason: `ORDER_DELIVERED:${s.order.code}` } })).toBe(0);
    expect(await ledgerMatches(s.customer.id)).toBe(0);
    expect((await prisma.commission.findFirstOrThrow({ where: { orderId: s.order.id } })).status).toBe('PENDING');
    expect(await prisma.pointsTransaction.count({ where: { userId: s.referrer.id } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).deliveredEffectsAt).toBeNull();
  }

  const later = (minutes: number) => new Date(Date.now() + minutes * MIN);

  it('@Cron theo giờ Việt Nam, có tên', () => {
    const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, DeliveredEffectsResyncCron.prototype.handleCron);
    expect(meta).toMatchObject({ timeZone: 'Asia/Ho_Chi_Minh', name: 'orders.delivered-effects-resync' });
  });

  it('đường chính trơn tru: điểm cộng ngay trong request, có mốc; cron không còn việc gì với đơn đó', async () => {
    const s = await scenario();
    await orderStatus.setStatus(s.order.id, 'DELIVERED');
    await expectAllEffectsOnce(s);

    const resync = spy(orderStatus, 'resyncDeliveredEffects');
    await cron.resyncPending(later(15));
    expect(resync).not.toHaveBeenCalledWith(s.order.id);
  });

  it('cộng điểm lỗi lần đầu → DELIVERED báo lỗi như cũ, chưa có mốc, Sức khoẻ hệ thống báo; cron chạy lại đủ việc đúng một lần rồi hết báo', async () => {
    const s = await scenario();
    spy(loyalty, 'creditOrderPoints').mockRejectedValueOnce(new Error('Timed out fetching a new connection from the connection pool'));
    await expect(orderStatus.setStatus(s.order.id, 'DELIVERED')).rejects.toThrow('connection pool');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe('DELIVERED');
    await expectNoEffects(s);

    // Trong 10 phút đầu cron chưa đụng (đường chính có thể còn đang chạy) và chưa báo.
    const early = await health.snapshot(later(5));
    expect(early.problems.map((p) => p.key)).not.toContain(PROBLEM);
    const resync = spy(orderStatus, 'resyncDeliveredEffects');
    await cron.resyncPending(later(5));
    expect(resync).not.toHaveBeenCalled();

    const snap = await health.snapshot(later(15));
    expect(snap.orders.deliveredEffectsPending).toBe(1);
    expect(snap.orders.deliveredEffectsOrders.map((o) => o.code)).toEqual([s.order.code]);
    const problem = snap.problems.find((p) => p.key === PROBLEM);
    expect(problem?.message).toContain('đơn đã giao chưa xong việc sau giao');
    expect(problem?.message).toContain(s.order.code);
    // Báo theo cơ chế chống lặp sẵn có: lượt kiểm sau không báo lại cùng sự cố.
    await expect(health.checkAndAlert(later(15))).resolves.toMatchObject({ sent: 'ALERT' });
    await expect(health.checkAndAlert(later(20))).resolves.toMatchObject({ sent: null });

    const warn = spy(Logger.prototype, 'warn');
    const res = await cron.resyncPending(later(15));
    expect(res).toMatchObject({ scanned: 1, repaired: 1, failed: 0 });
    expect(warn.mock.calls.some(([m]) => String(m).includes(s.order.code))).toBe(true);
    await expectAllEffectsOnce(s);

    const after = await health.snapshot(later(25));
    expect(after.orders.deliveredEffectsPending).toBe(0);
    expect(after.problems.map((p) => p.key)).not.toContain(PROBLEM);

    // Lượt sau: đơn đã có mốc, không quét lại, không cộng lần hai.
    resync.mockClear();
    await expect(cron.resyncPending(later(25))).resolves.toMatchObject({ scanned: 0 });
    expect(resync).not.toHaveBeenCalled();
    await expectAllEffectsOnce(s);
  });

  it('thưởng giới thiệu lỗi (lỗi bị nuốt như cũ) → chưa có mốc; cron thưởng bù, điểm và hoa hồng không lặp', async () => {
    const s = await scenario();
    const affiliate = moduleRef.get(AffiliateService);
    spy(affiliate, 'grantReferralReward').mockRejectedValueOnce(new Error('deadlock detected'));
    await orderStatus.setStatus(s.order.id, 'DELIVERED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).deliveredEffectsAt).toBeNull();
    expect(await prisma.pointsTransaction.count({ where: { userId: s.referrer.id } })).toBe(0);

    await expect(cron.resyncPending(later(15))).resolves.toMatchObject({ repaired: 1, failed: 0 });
    await expectAllEffectsOnce(s);
  });

  it('mốc thưởng giới thiệu lỗi sau khi thưởng đơn 2 đã ghi → chưa có mốc xong; cron xét lại mốc: +5 và +7 đúng một lần', async () => {
    const sysConfig = moduleRef.get(SystemConfigService);
    const MILESTONE = 7;
    await setConfig(prisma, 'referral.milestones_points', [{ count: 1, bonusPoints: MILESTONE }]);
    (sysConfig as unknown as { cache: Map<string, unknown> }).cache.delete('referral.milestones_points');
    try {
      const s = await scenario();
      const rewards = moduleRef.get(RewardPointsService);
      spy(rewards as unknown as { awardReferralMilestones: () => Promise<void> }, 'awardReferralMilestones').mockRejectedValueOnce(
        new Error('deadlock detected'),
      );
      await orderStatus.setStatus(s.order.id, 'DELIVERED');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).deliveredEffectsAt).toBeNull();
      const referrerRows = () =>
        prisma.pointsTransaction.findMany({ where: { userId: s.referrer.id }, select: { reason: true, delta: true }, orderBy: { delta: 'asc' } });
      expect(await referrerRows()).toEqual([{ reason: `${REFERRAL_ORDER2_PREFIX}${s.customer.id}`, delta: REWARD }]);

      await expect(cron.resyncPending(later(15))).resolves.toMatchObject({ repaired: 1, failed: 0 });
      const after = await referrerRows();
      expect(after.map((r) => r.delta)).toEqual([REWARD, MILESTONE]);
      expect(after[1]?.reason.startsWith('REFERRAL_MILESTONE:')).toBe(true);
      expect(await ledgerMatches(s.referrer.id)).toBe(REWARD + MILESTONE);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).deliveredEffectsAt).not.toBeNull();

      await expect(cron.resyncPending(later(25))).resolves.toMatchObject({ scanned: 0 });
      await orderStatus.setStatus(s.order.id, 'DELIVERED');
      expect(await referrerRows()).toEqual(after);
    } finally {
      await setConfig(prisma, 'referral.milestones_points', []);
      (sysConfig as unknown as { cache: Map<string, unknown> }).cache.delete('referral.milestones_points');
    }
  });

  it('chết giữa chừng sau commit (lật xong, chưa việc nào chạy) → cron sửa; gọi lại DELIVERED cũng sửa ngay', async () => {
    const crashed = async () => {
      const s = await scenario({ status: 'DELIVERED', deliveredEffectsAt: null, deliveredAt: new Date(Date.now() - 30 * MIN) });
      await expectNoEffects(s);
      return s;
    };
    const a = await crashed();
    await expect(cron.resyncPending()).resolves.toMatchObject({ repaired: 1, failed: 0 });
    await expectAllEffectsOnce(a);

    const b = await crashed();
    await orderStatus.setStatus(b.order.id, 'DELIVERED');
    await expectAllEffectsOnce(b);

    // Chết sau khi đã cộng điểm, trước khi khoá hoa hồng: chạy lại chỉ làm phần còn thiếu.
    const c = await crashed();
    await loyalty.creditOrderPoints(c.order.id);
    await expect(cron.resyncPending()).resolves.toMatchObject({ repaired: 1, failed: 0 });
    await expectAllEffectsOnce(c);
  });

  it('đường chính ‖ DELIVERED lặp ‖ cron ‖ cron replica khác → đúng một lần cộng điểm, không 40P01, số dư khớp sổ', async () => {
    for (let round = 0; round < 3; round++) {
      const s = await scenario();
      const other = new DeliveredEffectsResyncCron(prisma, orderStatus);
      let arrived!: () => void;
      const atCredit = new Promise<void>((r) => (arrived = r));
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      // Lần cộng điểm của đường chính dừng ngay sau commit lần lật — chỗ cửa sổ mất việc trước đây.
      spy(loyalty, 'creditOrderPoints').mockImplementationOnce(async (id: string) => {
        arrived();
        await gate;
        return LoyaltyService.prototype.creditOrderPoints.call(loyalty, id);
      });
      const primary = orderStatus.setStatus(s.order.id, 'DELIVERED');
      await atCredit;

      // Giữ dòng users của khách: lần ghi sổ đầu tiên kẹt ở khoá FK, các lần sau xếp hàng sau nó ở unique index — mọi bên đều đã
      // qua bước "đã cộng chưa?" (chưa) trước khi bên nào commit.
      const hold = await holdUserRow(s.customer.id);
      open();
      const racers = [
        primary,
        orderStatus.setStatus(s.order.id, 'DELIVERED'),
        cron.resyncPending(later(15)),
        other.resyncPending(later(15)),
      ];
      const settled: boolean[] = racers.map(() => false);
      racers.forEach((p, i) => void p.then(() => (settled[i] = true), () => (settled[i] = true)));
      // Đường chính, DELIVERED lặp và cron đang quét đều đã vào tx cộng điểm và đứng chờ (trực tiếp hoặc xếp hàng) sau khoá giữ.
      await waitUntil(async () => (await lockWaiters(hold.pid)) >= 3, 'các bên cộng điểm');
      expect(settled.filter(Boolean)).toHaveLength(1);
      hold.release();
      await hold.done;
      const results = await Promise.allSettled(racers);
      const sum = summarize(results);
      expect(sum.errors).toEqual([]);
      // Hai cron cùng lúc: khoá advisory cho đúng một bên quét.
      const ticks = [results[2], results[3]].map((r) => (r as PromiseFulfilledResult<unknown>).value);
      expect(ticks).toEqual(expect.arrayContaining([{ skipped: 'LOCKED' }]));
      await expectAllEffectsOnce(s);
    }
  });

  it('chỉ đơn giao trong 14 ngày, quá 10 phút, chưa có mốc: đơn cũ hơn, đơn đã có mốc, đơn vừa giao không bị đụng', async () => {
    const old = await scenario({ status: 'DELIVERED', deliveredEffectsAt: null, deliveredAt: new Date(Date.now() - 20 * DAY) });
    const marked = await scenario({ status: 'DELIVERED', deliveredAt: new Date(Date.now() - DAY), deliveredEffectsAt: new Date(Date.now() - DAY) });
    const fresh = await scenario({ status: 'DELIVERED', deliveredEffectsAt: null, deliveredAt: new Date(Date.now() - 2 * MIN) });
    const returned = await scenario({ status: 'RETURNED', deliveredAt: new Date(Date.now() - DAY) });

    const resync = spy(orderStatus, 'resyncDeliveredEffects');
    await expect(cron.resyncPending()).resolves.toMatchObject({ scanned: 0 });
    for (const s of [old, marked, fresh, returned]) {
      expect(resync).not.toHaveBeenCalledWith(s.order.id);
      expect(await prisma.pointsTransaction.count({ where: { userId: s.customer.id } })).toBe(0);
      expect((await prisma.commission.findFirstOrThrow({ where: { orderId: s.order.id } })).status).toBe('PENDING');
    }
    // Đơn quá cửa sổ cron không tự sửa nữa nên vẫn hiện ở Sức khoẻ hệ thống cho người xử lý.
    const snap = await health.snapshot();
    expect(snap.orders.deliveredEffectsOrders.map((o) => o.code)).toEqual([old.order.code]);
    expect(snap.orders.deliveredEffectsStale).toBe(1);
    expect(snap.problems.find((p) => p.key === PROBLEM)?.message).toContain('KHÔNG tự chạy lại');
    // Đường chạy lại tay (endpoint admin) không giới hạn cửa sổ ngày.
    await expect(orderStatus.resyncDeliveredEffects(old.order.id)).resolves.toMatchObject({ outcome: 'DONE', pointsCredited: true, commissionsLocked: 1 });
    await expect(orderStatus.resyncDeliveredEffects(old.order.code)).resolves.toEqual({ outcome: 'ALREADY_DONE' });
    expect(await ledgerMatches(old.customer.id)).toBe(EARNED);
    expect((await health.snapshot()).orders.deliveredEffectsPending).toBe(0);
  });

  it('đơn đã trả/huỷ không bao giờ được cộng điểm muộn; đơn đã duyệt trả một phần chỉ được cộng phần còn lại', async () => {
    const returned = await scenario({ status: 'RETURNED', deliveredAt: new Date(Date.now() - DAY) });
    await loyalty.creditOrderPoints(returned.order.id);
    await orderStatus.resyncDeliveredEffects(returned.order.id);
    expect(await prisma.pointsTransaction.count({ where: { userId: returned.customer.id } })).toBe(0);

    const partial = await scenario({ status: 'DELIVERED', deliveredEffectsAt: null, deliveredAt: new Date(Date.now() - DAY) });
    // Duyệt trả một phần lúc điểm chưa được cộng: không thu hồi được gì, nhưng phần chia (10 điểm) đã ghi vào yêu cầu.
    await prisma.returnRequest.create({
      data: { orderId: partial.order.id, userId: partial.customer.id, reason: 'IT', status: 'APPROVED', fullReturn: false, pointsReversed: 10 },
    });
    await expect(cron.resyncPending()).resolves.toMatchObject({ repaired: 1 });
    const credits = await prisma.pointsTransaction.findMany({ where: { userId: partial.customer.id, reason: `ORDER_DELIVERED:${partial.order.code}` } });
    expect(credits.map((c) => c.delta)).toEqual([EARNED - 10]);
    expect(await ledgerMatches(partial.customer.id)).toBe(EARNED - 10);
  });

  it('đơn 0 điểm (hàng đối tác, đơn không tích điểm) vẫn có mốc và không bị quét lại mãi', async () => {
    const happy = await scenario({ pointsEarned: 0 });
    await orderStatus.setStatus(happy.order.id, 'DELIVERED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: happy.order.id } })).deliveredEffectsAt).not.toBeNull();

    const crashed = await scenario({ status: 'DELIVERED', deliveredEffectsAt: null, pointsEarned: 0, deliveredAt: new Date(Date.now() - 30 * MIN) });
    await expect(cron.resyncPending()).resolves.toMatchObject({ scanned: 1, repaired: 1 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: crashed.order.id } })).deliveredEffectsAt).not.toBeNull();
    expect((await prisma.commission.findFirstOrThrow({ where: { orderId: crashed.order.id } })).status).toBe('LOCKED');
    expect(await prisma.pointsTransaction.count({ where: { userId: crashed.customer.id } })).toBe(0);

    const resync = spy(orderStatus, 'resyncDeliveredEffects');
    await expect(cron.resyncPending()).resolves.toMatchObject({ scanned: 0 });
    expect(resync).not.toHaveBeenCalled();
  });

  it('migration: mọi đơn đã giao/đã trả cũ được đánh dấu xong (không bao giờ bị cron chạy lại); chạy lại không đổi gì', async () => {
    const u = await createUser(prisma, {});
    const deliveredAt = new Date(Date.now() - 3 * DAY);
    const delivered = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredEffectsAt: null, deliveredAt });
    const legacy = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredEffectsAt: null });
    const returned = await createOrder(prisma, { userId: u.id, status: 'RETURNED', deliveredAt });
    const open = await createOrder(prisma, { userId: u.id, status: 'SHIPPING' });
    const ids = [delivered.id, legacy.id, returned.id, open.id];

    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261016210000_r11_delivered_effects_marker/migration.sql'), 'utf8');
    const statements = sql
      .split(/;\s*$/m)
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    const apply = async () => {
      for (const st of statements) await prisma.$executeRawUnsafe(st);
      const rows = await prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, deliveredEffectsAt: true } });
      return new Map(rows.map((r) => [r.id, r.deliveredEffectsAt?.getTime() ?? null]));
    };
    const first = await apply();
    expect(first.get(delivered.id)).toBe(deliveredAt.getTime());
    expect(first.get(legacy.id)).not.toBeNull();
    expect(first.get(returned.id)).toBe(deliveredAt.getTime());
    expect(first.get(open.id)).toBeNull();
    expect(await prisma.order.count({ where: { status: { in: ['DELIVERED', 'RETURNED'] }, deliveredEffectsAt: null } })).toBe(0);

    expect(await apply()).toEqual(first);
  });

  async function holdUserRow(id: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id} FOR UPDATE`;
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await held;
    return { release, done, pid };
  }

  /** Số phiên đang chờ (trực tiếp hoặc xếp hàng sau phiên đang chờ) khoá do tx `holderPid` giữ. */
  async function lockWaiters(holderPid: number) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      WITH RECURSIVE "w" AS (
        SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
        UNION
        SELECT a."pid" FROM pg_stat_activity a JOIN "w" ON "w"."pid" = ANY(pg_blocking_pids(a."pid"))
      )
      SELECT count(*)::int AS "n" FROM "w"`;
    return row?.n ?? 0;
  }

  async function waitUntil(cond: () => Promise<boolean> | boolean, what: string) {
    for (let i = 0; !(await cond()); i++) {
      if (i > 200) throw new Error(`${what} không tới chỗ chờ khoá`);
      await sleep(25);
    }
  }
});
