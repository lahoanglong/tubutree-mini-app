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
const M3 = 20;
const M5 = 40;
const UNIT = 50_000;
const DAY = 864e5;

/**
 * Khách G là NGƯỜI MỜI rồi gộp vào tài khoản T (UAT vòng 6, nhóm "khách là người mời"): danh tính giới thiệu của G
 * (người G đã mời, mã của G, mốc thưởng của G) sang T; liên kết tạo vòng hoặc tự mời bị cắt và thưởng đã cấp bị thu ngay
 * lúc gộp; gộp khoá theo thứ tự yêu cầu trả → đơn → users (người được mời trước người mời) như đường duyệt trả.
 */
describe('Khách là người mời: gộp mang theo danh tính giới thiệu (real Postgres)', () => {
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
    await setConfig(prisma, 'referral.milestones_points', [
      { count: 3, bonusPoints: M3 },
      { count: 5, bonusPoints: M5 },
    ]);
    admin = await createUser(prisma, { role: 'ADMIN' });

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-r11', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
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

  afterEach(() => jest.restoreAllMocks());

  async function variation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-r11-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 100 },
    });
  }

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

  async function qualify(refereeId: string) {
    const o1 = await deliveredOrder(refereeId, 9);
    const o2 = await deliveredOrder(refereeId, 4);
    expect(await rewards.grantReferralOrderReward(refereeId)).toBe(true);
    return { o1, o2 };
  }

  const zaloUser = (data: { referredById?: string } = {}) => createUser(prisma, { role: 'CUSTOMER', zaloId: `zalo_${randCode(10)}`, ...data });
  const guestUser = (data: { referredById?: string } = {}) => createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, ...data });

  /** Khách đăng nhập bằng mã giới thiệu qua đường thật (resolveReferrerId). */
  async function guestWithCode(code: string) {
    const res = await auth.loginAsGuest(`dev_${randCode(10)}`, code);
    return prisma.user.findUniqueOrThrow({ where: { id: res.user.id } });
  }

  async function merge(guestId: string, target: { zaloId: string | null }) {
    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guestId, 'code', 'access');
  }

  async function balanceOf(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(sum._sum.delta ?? 0);
    return u.pointsBalance;
  }

  async function referralRows(userId: string) {
    return prisma.pointsTransaction.findMany({
      where: { userId, refType: { in: ['REFERRAL', 'REFERRAL_DEBT'] } },
      select: { reason: true, delta: true },
      orderBy: { reason: 'asc' },
    });
  }

  const successes = (referrerId: string) => prisma.$transaction((tx) => countReferralSuccesses(tx, referrerId));
  const referrerOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { referredById: true } })).referredById;

  async function returnUnits(ownerId: string, order: Ord, qty: number) {
    const req = await returns.request(ownerId, order.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: order.item.id, quantity: qty }],
    });
    await returns.review(admin.id, req.id, { approve: true });
    return req.id;
  }

  /** Tx thứ ba giữ khoá dòng `table` `ids` ở `mode` cho tới khi release(). */
  async function holdRows(table: 'users' | 'orders', ids: string[], mode: 'FOR SHARE' | 'FOR KEY SHARE') {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        for (const id of ids) {
          if (table === 'users' && mode === 'FOR SHARE') await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id} FOR SHARE`;
          else if (table === 'users') await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id} FOR KEY SHARE`;
          else if (mode === 'FOR SHARE') await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${id} FOR SHARE`;
          else await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${id} FOR KEY SHARE`;
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

  async function waitForWaiters(holderPid: number, n: number, settled: () => boolean = () => false) {
    for (let i = 0; !settled() && (await lockWaiters(holderPid)) < n; i++) {
      if (i > 200) throw new Error(`không đủ ${n} phiên chờ khoá`);
      await sleep(25);
    }
  }

  it('(1) gộp G vào T: người G đã mời, mã của G (kể cả người mới nhập sau gộp) và người còn trỏ G đều thưởng cho T', async () => {
    const g = await guestUser();
    const t = await zaloUser();
    const x1 = await guestWithCode(g.referralCode.toLowerCase());
    expect(x1.referredById).toBe(g.id);
    await merge(g.id, t);

    expect(await referrerOf(x1.id)).toBe(t.id);
    const x2 = await guestWithCode(g.referralCode);
    expect(x2.referredById).toBe(t.id);
    // Người được mời chen vào giữa lúc đọc và lúc khoá của lần gộp vẫn trỏ dòng khách đã gộp.
    const x3 = await createUser(prisma, { referredById: g.id });

    await qualify(x1.id);
    await qualify(x2.id);
    await qualify(x3.id);
    for (const x of [x1, x2, x3]) {
      const grant = await prisma.pointsTransaction.findFirstOrThrow({ where: { reason: `REFERRAL_ORDER2:${x.id}` } });
      expect(grant.userId).toBe(t.id);
    }
    expect(await prisma.pointsTransaction.count({ where: { userId: g.id } })).toBe(0);
    expect(await successes(t.id)).toBe(3);
    expect(await balanceOf(t.id)).toBe(3 * REWARD + M3);
    expect(await balanceOf(g.id)).toBe(0);
  });

  it('(1b) lần gộp commit giữa lúc cấp thưởng đọc người mời (ngoài tx) và lúc khoá → thưởng cho T, không cho dòng khách', async () => {
    const g = await guestUser();
    const t = await zaloUser();
    const x = await createUser(prisma, { referredById: g.id });
    await deliveredOrder(x.id, 9);
    await deliveredOrder(x.id, 4);
    const original = prisma.user.findUnique.bind(prisma.user);
    let merged = false;
    jest.spyOn(prisma.user, 'findUnique').mockImplementation((async (args: Parameters<typeof original>[0]) => {
      const res = await original(args);
      if (!merged && (args.select as { role?: boolean } | undefined)?.role) {
        merged = true;
        await merge(g.id, t);
      }
      return res;
    }) as never);
    expect(await rewards.grantReferralOrderReward(x.id)).toBe(true);
    expect(merged).toBe(true);
    expect((await prisma.pointsTransaction.findFirstOrThrow({ where: { reason: `REFERRAL_ORDER2:${x.id}` } })).userId).toBe(t.id);
    expect(await prisma.pointsTransaction.count({ where: { userId: g.id } })).toBe(0);
    expect(await balanceOf(t.id)).toBe(REWARD);
  });

  it('(2a) SYNC-1: G mời 3 (mốc 3), T có người được mời riêng; gộp → mốc 3 không cấp lần hai; trả hàng thu cả mốc gốc G', async () => {
    const g = await guestUser();
    const hs = [await createUser(prisma, { referredById: g.id }), await createUser(prisma, { referredById: g.id }), await createUser(prisma, { referredById: g.id })];
    const hOrders = [];
    for (const h of hs) hOrders.push(await qualify(h.id));
    expect(await balanceOf(g.id)).toBe(3 * REWARD + M3);

    const t = await zaloUser();
    const ra = await createUser(prisma, { referredById: t.id });
    await qualify(ra.id);
    await merge(g.id, t);
    expect(await successes(t.id)).toBe(4);
    expect(await balanceOf(t.id)).toBe(4 * REWARD + M3);

    const rb = await createUser(prisma, { referredById: t.id });
    await qualify(rb.id);
    const milestoneGrants = (await referralRows(t.id)).filter((r) => r.reason.startsWith('REFERRAL_MILESTONE:'));
    expect(milestoneGrants).toEqual([
      { reason: `REFERRAL_MILESTONE:${t.id}:3`, delta: M3 },
      { reason: `REFERRAL_MILESTONE:${t.id}:5`, delta: M5 },
    ]);
    expect(await balanceOf(t.id)).toBe(5 * REWARD + M3 + M5);

    const settled = summarize(await Promise.allSettled(hOrders.map((o) => orderStatus.setStatus(o.o1.id, 'RETURNED'))));
    expect(settled.errors).toEqual([]);
    const revokes = (await referralRows(t.id)).filter((r) => r.reason.startsWith('REFERRAL_MILESTONE_REVOKE:')).map((r) => r.reason);
    expect(revokes.sort()).toEqual([`REFERRAL_MILESTONE_REVOKE:${t.id}:3#0`, `REFERRAL_MILESTONE_REVOKE:${t.id}:5#0`]);
    expect(await successes(t.id)).toBe(2);
    expect(await balanceOf(t.id)).toBe(2 * REWARD);
  });

  it('(2b) G và T cùng giữ mốc 3 trước gộp: đổi khoá mốc của G sang đời mới không đụng unique; trả hàng thu cả hai đời', async () => {
    const g = await guestUser();
    const t = await zaloUser();
    const gRefs = [];
    const tRefs = [];
    for (let i = 0; i < 3; i++) gRefs.push(await qualify((await createUser(prisma, { referredById: g.id })).id));
    for (let i = 0; i < 3; i++) tRefs.push(await qualify((await createUser(prisma, { referredById: t.id })).id));
    await merge(g.id, t);
    const reasons = (await referralRows(t.id)).filter((r) => r.reason.startsWith('REFERRAL_MILESTONE:')).map((r) => r.reason);
    expect(reasons.sort()).toEqual([`REFERRAL_MILESTONE:${t.id}:3`, `REFERRAL_MILESTONE:${t.id}:3#1`]);
    expect(await successes(t.id)).toBe(6);
    expect(await balanceOf(t.id)).toBe(6 * REWARD + 2 * M3);

    for (const o of [...gRefs, tRefs[0]!]) await orderStatus.setStatus(o.o1.id, 'RETURNED');
    const revokes = (await referralRows(t.id)).filter((r) => r.reason.startsWith('REFERRAL_MILESTONE_REVOKE:')).map((r) => r.reason);
    expect(revokes.sort()).toEqual([`REFERRAL_MILESTONE_REVOKE:${t.id}:3#0`, `REFERRAL_MILESTONE_REVOKE:${t.id}:3#1`]);
    expect(await successes(t.id)).toBe(2);
    expect(await balanceOf(t.id)).toBe(2 * REWARD);

    // Đạt lại mốc 3 thì cấp đời mới, không trùng hai đời cũ.
    await qualify((await createUser(prisma, { referredById: t.id })).id);
    expect(await successes(t.id)).toBe(3);
    expect(await prisma.pointsTransaction.count({ where: { reason: `REFERRAL_MILESTONE:${t.id}:3#2` } })).toBe(1);
    expect(await balanceOf(t.id)).toBe(3 * REWARD + M3);
  });

  it('(3a) B4 tự mời: R tạo khách bằng mã của chính R, khách có 2 đơn giao, gộp vào R → thu thưởng ngay lúc gộp, trả sau không thu thêm', async () => {
    const r = await zaloUser();
    const g = await guestWithCode(r.referralCode);
    expect(g.referredById).toBe(r.id);
    const { o1, o2 } = await qualify(g.id);
    expect(await balanceOf(r.id)).toBe(REWARD);

    await merge(g.id, r);
    expect(await referrerOf(g.id)).toBeNull();
    expect((await referralRows(r.id)).map((x) => [x.reason, x.delta])).toEqual([
      [`REFERRAL_ORDER2:${g.id}`, REWARD],
      [`REFERRAL_ORDER2_REVOKE:${g.id}`, -REWARD],
    ]);
    expect(await successes(r.id)).toBe(0);
    expect(await balanceOf(r.id)).toBe(0);

    await returnUnits(r.id, o2, 1);
    await orderStatus.setStatus(o1.id, 'RETURNED');
    expect(await referralRows(r.id)).toHaveLength(2);
    expect(await balanceOf(r.id)).toBe(0);
  });

  it('(3b) G mời chính T: gộp cắt liên kết tự mời của T và thu thưởng G đã nhận cho T', async () => {
    const g = await guestUser();
    const t = await zaloUser({ referredById: g.id });
    await qualify(t.id);
    await merge(g.id, t);
    expect(await referrerOf(t.id)).toBeNull();
    expect((await referralRows(t.id)).map((x) => x.reason)).toEqual([`REFERRAL_ORDER2:${t.id}`, `REFERRAL_ORDER2_REVOKE:${t.id}`]);
    expect(await balanceOf(t.id)).toBe(0);
    expect(await successes(t.id)).toBe(0);
  });

  it('(3c) vòng 2: G mời X, X mời T; gộp G vào T → cắt X khỏi T, thu thưởng của X, X giữ thưởng mời T', async () => {
    const g = await guestUser();
    const x = await createUser(prisma, { referredById: g.id });
    const t = await zaloUser({ referredById: x.id });
    await qualify(x.id);
    await qualify(t.id);
    await merge(g.id, t);
    expect(await referrerOf(x.id)).toBeNull();
    expect(await referrerOf(t.id)).toBe(x.id);
    expect((await referralRows(t.id)).map((r) => r.reason)).toEqual([`REFERRAL_ORDER2:${x.id}`, `REFERRAL_ORDER2_REVOKE:${x.id}`]);
    expect(await balanceOf(t.id)).toBe(0);
    expect(await balanceOf(x.id)).toBe(REWARD);
    expect(await successes(x.id)).toBe(1);
  });

  it('(3d) G6 giữ nguyên: G được R mời (R ≠ T) → gộp không cắt, không thu thưởng của R', async () => {
    const r = await zaloUser();
    const g = await guestUser({ referredById: r.id });
    const t = await zaloUser();
    await qualify(g.id);
    await merge(g.id, t);
    expect(await referrerOf(g.id)).toBe(r.id);
    expect((await referralRows(r.id)).map((x) => x.reason)).toEqual([`REFERRAL_ORDER2:${g.id}`]);
    expect(await balanceOf(r.id)).toBe(REWARD);
  });

  it('(4a) SYNC-2: gộp khách ‖ admin duyệt trả đơn của khách (ép xen kẽ) → không deadlock (10 vòng)', async () => {
    for (let round = 0; round < 10; round++) {
      const r = await zaloUser();
      const g = await guestUser({ referredById: r.id });
      const t = await zaloUser();
      const { o2 } = await qualify(g.id);
      const req = await returns.request(g.id, o2.code, {
        reasonCode: 'OTHER',
        reason: 'Không còn nhu cầu dùng nữa',
        items: [{ orderItemId: o2.item.id, quantity: 1 }],
      });

      const hold = await holdRows('orders', [o2.id], 'FOR SHARE');
      const pA = returns.review(admin.id, req.id, { approve: true });
      await waitForWaiters(hold.pid, 1);
      const pB = merge(g.id, t);
      await waitForWaiters(hold.pid, 2);
      hold.release();
      await hold.done;
      const s = summarize(await Promise.allSettled([pA, pB]));
      expect(s.errors).toEqual([]);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o2.id } })).userId).toBe(t.id);
      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('APPROVED');
      await balanceOf(r.id);
      await balanceOf(t.id);
      expect(await balanceOf(g.id)).toBe(0);
    }
  });

  it('(4b) B2: G mời X, X mời T, gộp G vào T; trả đơn X ‖ trả đơn T (ép xen kẽ) → không deadlock (3 vòng)', async () => {
    for (let round = 0; round < 3; round++) {
      const g = await guestUser();
      const x = await createUser(prisma, { referredById: g.id });
      const t = await zaloUser({ referredById: x.id });
      const xOrders = await qualify(x.id);
      const tOrders = await qualify(t.id);
      await merge(g.id, t);

      const hold = await holdRows('users', [t.id, x.id], 'FOR KEY SHARE');
      let aSettled = false;
      const pA = orderStatus.setStatus(xOrders.o1.id, 'RETURNED').finally(() => (aSettled = true));
      await waitForWaiters(hold.pid, 1, () => aSettled);
      const pB = orderStatus.setStatus(tOrders.o1.id, 'RETURNED');
      for (let i = 0; (await lockWaiters(hold.pid)) < (aSettled ? 1 : 2); i++) {
        if (i > 200) throw new Error('B không tới chỗ chờ khoá');
        await sleep(25);
      }
      hold.release();
      await hold.done;
      const s = summarize(await Promise.allSettled([pA, pB]));
      expect(s.errors).toEqual([]);
      expect((await referralRows(x.id)).map((r) => r.reason)).toEqual([`REFERRAL_ORDER2:${t.id}`, `REFERRAL_ORDER2_REVOKE:${t.id}`]);
      expect(await balanceOf(x.id)).toBe(0);
      expect(await balanceOf(t.id)).toBe(0);
    }
  });

  it('(5) B5: lần gộp commit giữa lúc setStatus đọc đơn và lúc lật → dùng chủ đơn hiện tại (G6: R giữ thưởng)', async () => {
    const r = await zaloUser();
    const g = await guestUser({ referredById: r.id });
    const t = await zaloUser();
    const { o1 } = await qualify(g.id);
    const original = prisma.order.findFirst.bind(prisma.order);
    jest.spyOn(prisma.order, 'findFirst').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const res = await original(args);
      await merge(g.id, t);
      return res;
    }) as never);
    await orderStatus.setStatus(o1.id, 'RETURNED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o1.id } })).status).toBe('RETURNED');
    expect((await referralRows(r.id)).map((x) => x.reason)).toEqual([`REFERRAL_ORDER2:${g.id}`]);
    expect(await balanceOf(r.id)).toBe(REWARD);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: o1.id, toStatus: 'RETURNED' } })).toBe(1);
    expect(await prisma.pointsTransaction.count({ where: { userId: g.id } })).toBe(0);
    expect(await prisma.walletTransaction.count({ where: { userId: g.id } })).toBe(0);
  });
});
