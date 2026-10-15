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
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { countReferralSuccesses } from '../../src/modules/wallet/referral-reward';
import { createOrder, createUser, randCode, setConfig, sleep, summarize, warmPool } from './helpers';

const REWARD = 100;
const MILESTONE = 20;
const UNIT = 50_000;
const DAY = 864e5;

/**
 * G6 (quyết định chủ dự án): khách G (người mời R) gộp vào tài khoản T thì các đơn của G sang T nhưng thưởng
 * REFERRAL_ORDER2:<G> của R ở lại. Sau gộp, trả/huỷ (cả đơn lẫn một phần) các đơn cũ của G KHÔNG thu hồi thưởng đó
 * và không khoá dòng users của R (hết đảo thứ tự khoá T → R so với tx trả đơn của R: R → T). Chưa gộp thì như cũ.
 */
describe('Thưởng giới thiệu tách khỏi đơn đã gộp sang tài khoản đích (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let returns: OrderReturnsService;
  let rewards: RewardPointsService;
  let auth: AuthService;
  let admin: { id: string };
  let zaloIdForNextCall = '';
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
    returns = moduleRef.get(OrderReturnsService);
    rewards = moduleRef.get(RewardPointsService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'referral.referrer_reward_points', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.min_order_amount', 100_000);
    await setConfig(prisma, 'referral.milestones_points', [{ count: 1, bonusPoints: MILESTONE }]);
    admin = await createUser(prisma, { role: 'ADMIN' });

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-g6', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  async function variation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-g6-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 100 },
    });
  }

  /** Đơn COD đã giao 3 × 50.000, tiền thực trả từng dòng đã lưu. */
  async function deliveredOrder(userId: string, daysAgo: number) {
    const v = await variation();
    const total = 3 * UNIT;
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
      items: {
        create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: UNIT, quantity: 3, total, paidTotal: total }],
      },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { ...order, item };
  }

  type Ord = Awaited<ReturnType<typeof deliveredOrder>>;

  /** `refereeId` có 2 đơn đã giao → người mời nhận thưởng (đường cấp thật, kèm mốc 1 lượt). */
  async function qualify(refereeId: string) {
    const o1 = await deliveredOrder(refereeId, 9);
    const o2 = await deliveredOrder(refereeId, 4);
    expect(await rewards.grantReferralOrderReward(refereeId)).toBe(true);
    return { o1, o2 };
  }

  async function merge(guestId: string, target: { zaloId: string | null }) {
    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guestId, 'code', 'access');
  }

  /** Khách G (người mời R) có 2 đơn đã giao, R đã nhận thưởng + mốc; `merged` thì G gộp vào T. */
  async function guestScenario(opts: { merged: boolean; targetReferrerId?: string }) {
    const referrer = await createUser(prisma, { role: 'CUSTOMER' });
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, referredById: referrer.id });
    const target = await createUser(prisma, { zaloId: `zalo_${randCode(10)}`, referredById: opts.targetReferrerId ?? null });
    const { o1, o2 } = await qualify(guest.id);
    expect(await balanceOf(referrer.id)).toBe(REWARD + MILESTONE);
    if (opts.merged) {
      await merge(guest.id, target);
      expect(await prisma.order.count({ where: { id: { in: [o1.id, o2.id] }, userId: target.id } })).toBe(2);
    }
    return { referrer, guest, target, o1, o2, owner: opts.merged ? target : guest };
  }

  async function balanceOf(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(sum._sum.delta ?? 0);
    return u.pointsBalance;
  }

  /** Mọi dòng thu hồi/ghi nợ thưởng giới thiệu (cả lượt lẫn mốc) của người mời. */
  async function revocationRows(referrerId: string) {
    const rows = await prisma.pointsTransaction.findMany({
      where: { userId: referrerId, refType: { in: ['REFERRAL', 'REFERRAL_DEBT'] } },
      select: { reason: true, delta: true, refId: true },
    });
    return rows.filter((r) => /_REVOKE:|_DEBT:/.test(r.reason));
  }

  const successes = (referrerId: string) => prisma.$transaction((tx) => countReferralSuccesses(tx, referrerId));

  async function returnUnits(ownerId: string, order: Ord, qty: number) {
    const req = await returns.request(ownerId, order.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: order.item.id, quantity: qty }],
    });
    await returns.review(admin.id, req.id, { approve: true });
    return req.id;
  }

  /** Tx thứ ba giữ khoá dòng users `ids` ở `mode` cho tới khi release(). */
  async function holdUsers(ids: string[], mode: 'FOR SHARE' | 'FOR KEY SHARE') {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        for (const id of ids) {
          if (mode === 'FOR SHARE') await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id} FOR SHARE`;
          else await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id} FOR KEY SHARE`;
        }
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

  /**
   * Chạy `fn` khi một tx khác giữ FOR SHARE trên dòng users của người mời: lockReferrer (FOR UPDATE) sẽ phải chờ, còn
   * các dòng sổ có khoá ngoại tới người mời (KEY SHARE) thì không. Trả về 'done' nếu `fn` xong khi khoá còn bị giữ.
   */
  async function runWhileReferrerHeld(referrerId: string, fn: () => Promise<unknown>) {
    const hold = await holdUsers([referrerId], 'FOR SHARE');
    const p = fn();
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      p.then(() => 'done' as const),
      new Promise<'blocked'>((resolve) => (timer = setTimeout(() => resolve('blocked'), 3000))),
    ]);
    clearTimeout(timer);
    const waiting = await lockWaiters(hold.pid);
    hold.release();
    await hold.done;
    await p;
    return { outcome, waiting };
  }

  it('(a) đã gộp: trả CẢ một đơn cũ của G → R giữ thưởng + mốc, không dòng thu hồi, lượt không đổi, không khoá R', async () => {
    const { referrer, o1, o2 } = await guestScenario({ merged: true });
    const r = await runWhileReferrerHeld(referrer.id, () => orderStatus.setStatus(o1.id, 'RETURNED'));
    expect(r).toEqual({ outcome: 'done', waiting: 0 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o1.id } })).status).toBe('RETURNED');
    await orderStatus.setStatus(o2.id, 'RETURNED');
    expect(await revocationRows(referrer.id)).toEqual([]);
    expect(await balanceOf(referrer.id)).toBe(REWARD + MILESTONE);
    expect(await successes(referrer.id)).toBe(1);
  });

  it('(b) đã gộp: trả MỘT PHẦN đơn cũ của G (rồi trả nốt) → không thu hồi từng phần, không khoá R', async () => {
    const { referrer, target, o1, o2 } = await guestScenario({ merged: true });
    const r = await runWhileReferrerHeld(referrer.id, () => returnUnits(target.id, o2, 1));
    expect(r).toEqual({ outcome: 'done', waiting: 0 });
    await returnUnits(target.id, o1, 2);
    await returnUnits(target.id, o2, 2);
    expect(await revocationRows(referrer.id)).toEqual([]);
    expect(await balanceOf(referrer.id)).toBe(REWARD + MILESTONE);
    expect(await successes(referrer.id)).toBe(1);
  });

  it('(c1) chưa gộp: trả cả đơn của G → thu hồi thưởng + mốc như cũ', async () => {
    const { referrer, guest, o1 } = await guestScenario({ merged: false });
    await orderStatus.setStatus(o1.id, 'RETURNED');
    const reasons = (await revocationRows(referrer.id)).map((x) => x.reason).sort();
    expect(reasons).toEqual([`REFERRAL_MILESTONE_REVOKE:${referrer.id}:1#0`, `REFERRAL_ORDER2_REVOKE:${guest.id}`]);
    expect(await balanceOf(referrer.id)).toBe(0);
    expect(await successes(referrer.id)).toBe(0);
  });

  it('(c2) chưa gộp: trả 1/3 đơn thứ hai của G → thu hồi từng phần 33 như cũ, lượt không đổi', async () => {
    const { referrer, guest, o2 } = await guestScenario({ merged: false });
    const reqId = await returnUnits(guest.id, o2, 1);
    expect(await revocationRows(referrer.id)).toEqual([
      { reason: `REFERRAL_ORDER2_PARTIAL_REVOKE:${guest.id}:${reqId}`, delta: -33, refId: o2.id },
    ]);
    expect(await balanceOf(referrer.id)).toBe(REWARD + MILESTONE - 33);
    expect(await successes(referrer.id)).toBe(1);
  });

  /**
   * (d) T mời R, R mời G, G gộp vào T. Tx A trả đơn cũ của G (nay của T): khoá T (người được mời theo chủ đơn) rồi —
   * trước fix — khoá R (người mời của G). Tx B trả đơn của R: khoá R rồi khoá T (người mời của R). Tx thứ ba giữ KEY SHARE
   * trên T và R: không chặn FOR NO KEY UPDATE (lockReferee) nhưng chặn FOR UPDATE (lockReferrer), nên cả hai tx đều lấy
   * được khoá đầu rồi đứng chờ khoá thứ hai; thả ra là A chờ B trên R, B chờ A trên T ⇒ 40P01. Sau fix A không đụng R.
   */
  it('(d) T mời R, R mời G, G gộp vào T: trả đơn cũ của G ‖ trả đơn của R → không deadlock (lặp 3 lần)', async () => {
    for (let round = 0; round < 3; round++) {
      const t = await createUser(prisma, { role: 'CUSTOMER', zaloId: `zalo_${randCode(10)}` });
      const r = await createUser(prisma, { role: 'CUSTOMER', referredById: t.id });
      const g = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, referredById: r.id });
      const rOrders = await qualify(r.id);
      const gOrders = await qualify(g.id);
      await merge(g.id, t);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: gOrders.o1.id } })).userId).toBe(t.id);
      const tBefore = await balanceOf(t.id);

      const hold = await holdUsers([t.id, r.id], 'FOR KEY SHARE');
      let aSettled = false;
      const pA = orderStatus.setStatus(gOrders.o1.id, 'RETURNED').finally(() => (aSettled = true));
      // A tới chỗ chờ khoá R (trước fix) hoặc xong hẳn (sau fix) rồi mới cho B chạy, để A giữ T trước khi B cần T.
      for (let i = 0; !aSettled && (await lockWaiters(hold.pid)) < 1; i++) {
        if (i > 200) throw new Error('A không tới chỗ chờ khoá');
        await sleep(25);
      }
      const pB = orderStatus.setStatus(rOrders.o1.id, 'RETURNED');
      for (let i = 0; (await lockWaiters(hold.pid)) < (aSettled ? 1 : 2); i++) {
        if (i > 200) throw new Error('B không tới chỗ chờ khoá');
        await sleep(25);
      }
      hold.release();
      await hold.done;
      const s = summarize(await Promise.allSettled([pA, pB]));
      expect(s.errors).toEqual([]);

      // R giữ thưởng của G; T bị thu thưởng của R (+ mốc của T).
      expect(await revocationRows(r.id)).toEqual([]);
      expect(await successes(r.id)).toBe(1);
      expect((await revocationRows(t.id)).map((x) => x.reason).sort()).toEqual(
        [`REFERRAL_MILESTONE_REVOKE:${t.id}:1#0`, `REFERRAL_ORDER2_REVOKE:${r.id}`].sort(),
      );
      expect(await successes(t.id)).toBe(0);
      expect(await balanceOf(t.id)).toBe(tBefore - REWARD - MILESTONE);
    }
  });

  it('(e) đã gộp vào T có người mời R2: đơn cũ của G (kể cả sau khi trả một đơn) không được dùng để thưởng R2', async () => {
    const r2 = await createUser(prisma, { role: 'CUSTOMER' });
    const { referrer, target, o1, o2 } = await guestScenario({ merged: true, targetReferrerId: r2.id });
    await orderStatus.setStatus(o1.id, 'RETURNED');
    const t1 = await deliveredOrder(target.id, 2);
    expect(await rewards.grantReferralOrderReward(target.id)).toBe(false);
    const t2 = await deliveredOrder(target.id, 1);
    expect(await rewards.grantReferralOrderReward(target.id)).toBe(true);
    const grant = await prisma.pointsTransaction.findFirstOrThrow({ where: { reason: `REFERRAL_ORDER2:${target.id}` } });
    expect(grant.refId).toBe(`${t1.id}:${t2.id}`);
    expect(grant.refId?.split(':')).not.toContain(o2.id);
    expect(await balanceOf(r2.id)).toBe(REWARD + MILESTONE);
    expect(await balanceOf(referrer.id)).toBe(REWARD + MILESTONE);
    expect(await revocationRows(referrer.id)).toEqual([]);
  });
});
