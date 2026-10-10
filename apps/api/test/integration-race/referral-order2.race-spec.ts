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
import { CoinsService } from '../../src/modules/wallet/coins.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const REWARD = 5000;
const DAY = 864e5;
const MIN_ORDER = 200_000;

/**
 * Q-05 (C-003): một chương trình giới thiệu duy nhất. Người mời (users.referredById) nhận
 * coins.referrer_reward khi người được mời có đơn THỨ 2 giao thành công trong referral.window_days
 * ngày kể từ đơn đầu; bị trả hàng thì thu hồi. Không còn voucher REFER/REFERRED 50k+50k.
 * Chạy trên Postgres thật: OrderStatusService + AffiliateService + CoinsService thật.
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
        CoinsService,
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
    await setConfig(prisma, 'coins.referrer_reward', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'coins.referral_milestones', []);
    await setConfig(prisma, 'referral.min_order_amount', MIN_ORDER);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function pair(referrerRole: 'CUSTOMER' | 'AFFILIATE' = 'CUSTOMER') {
    const referrer = await createUser(prisma, { role: referrerRole, coinsBalance: 0 });
    const referee = await createUser(prisma, { referredById: referrer.id, coinsBalance: 0 });
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

  async function coinsOf(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coinsBalance: true } });
    const sum = await prisma.coinTransaction.aggregate({ where: { userId }, _sum: { delta: true } });
    return { balance: u.coinsBalance, ledger: sum._sum.delta ?? 0 };
  }

  async function referralCoupons(referrerId: string, refereeId: string) {
    return prisma.coupon.count({
      where: { code: { in: [`REFER-${referrerId}-${refereeId}`.toUpperCase(), `REFERRED-${refereeId}`.toUpperCase()] } },
    });
  }

  it('(a) đơn đầu giao xong: không voucher REFER/REFERRED, chưa thưởng xu', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 5, referrer.id);
    await orderStatus.setStatus(o1.id, 'DELIVERED');

    expect(await referralCoupons(referrer.id, referee.id)).toBe(0);
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await coinsOf(referee.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(b) đơn thứ 2 trong 30 ngày giao xong → người mời +reward đúng 1 lần, người được mời không thêm xu', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 20);
    const o2 = await shippingOrder(referee.id, 2);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');

    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await coinsOf(referee.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await referralCoupons(referrer.id, referee.id)).toBe(0);

    // Đơn thứ 3 giao sau đó không thưởng thêm.
    const o3 = await shippingOrder(referee.id, 1);
    await orderStatus.setStatus(o3.id, 'DELIVERED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
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

    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    const grants = await prisma.coinTransaction.count({ where: { userId: referrer.id, delta: { gt: 0 } } });
    expect(grants).toBe(1);
  });

  it('(d) đơn thứ 2 ngoài cửa sổ 30 ngày → không thưởng', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 45);
    const o2 = await shippingOrder(referee.id, 1);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(e) người mời là CTV → chỉ hưởng hoa hồng, không xu giới thiệu', async () => {
    const { referrer, referee } = await pair('AFFILIATE');
    const o1 = await shippingOrder(referee.id, 5, referrer.id);
    const o2 = await shippingOrder(referee.id, 1, referrer.id);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await referralCoupons(referrer.id, referee.id)).toBe(0);
  });

  it('(f) đơn thứ 2 bị trả hàng → thu hồi đủ xu; trả lại lần nữa không trừ thêm', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect((await coinsOf(referrer.id)).balance).toBe(REWARD);

    await orderStatus.setStatus(o2.id, 'RETURNED');
    await orderStatus.setStatus(o2.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });

    // Đã thu hồi thì không thưởng lại (tránh vòng giao/trả để cày xu).
    const o3 = await shippingOrder(referee.id, 1);
    await orderStatus.setStatus(o3.id, 'DELIVERED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(g) đơn ĐẦU bị trả hàng sau khi đã thưởng → cũng thu hồi', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect((await coinsOf(referrer.id)).balance).toBe(REWARD);
    await orderStatus.setStatus(o1.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(h) người mời đã tiêu bớt xu → thu hồi phần còn lại, số dư không âm, ghi cờ nợ cho admin', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    await moduleRef.get(CoinsService).spendCoins(referrer.id, 3000, 'GAME_BUY_SEEDS', 'GAME');

    await orderStatus.setStatus(o2.id, 'RETURNED');
    const c = await coinsOf(referrer.id);
    expect(c).toEqual({ balance: 0, ledger: 0 });
    const debt = await prisma.coinTransaction.findMany({ where: { userId: referrer.id, refType: 'REFERRAL_DEBT' } });
    expect(debt).toHaveLength(1);
    expect(debt[0]!.delta).toBe(0);
    expect(debt[0]!.reason).toBe(`REFERRAL_ORDER2_DEBT:${referee.id}:3000`);
  });

  it('(i) thưởng và trả đơn đầu chạy song song → kết cục luôn là người mời không giữ xu', async () => {
    for (let i = 0; i < 5; i += 1) {
      const { referrer, referee } = await pair();
      const o1 = await deliveredOrder(referee.id, 9);
      const o2 = await deliveredOrder(referee.id, 4);
      const results = await Promise.allSettled([
        affiliate.grantReferralReward(o2.id),
        orderStatus.setStatus(o1.id, 'RETURNED'),
      ]);
      expect(summarize(results).errors).toEqual([]);
      const grants = await prisma.coinTransaction.count({ where: { userId: referrer.id, delta: { gt: 0 } } });
      console.log('[i] vòng %d: thưởng trước rồi thu hồi=%s', i, grants === 1);
      expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    }
  });

  it('(j) người được mời đã có xu giới thiệu kiểu cũ (cashback) → không thưởng lần 2', async () => {
    const { referrer, referee } = await pair();
    await moduleRef.get(CoinsService).grantCoins(referrer.id, REWARD, `REFERRAL_CASHBACK:${referee.id}`, 'REFERRAL', referee.id);
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
  });
  it('(i2) trả đơn đầu GIỮ khoá trước, lần thưởng chờ khoá → thưởng đọc thấy đơn đã trả, không cấp gì', async () => {
    const { referrer, referee } = await pair();
    const o1 = await deliveredOrder(referee.id, 9);
    const o2 = await deliveredOrder(referee.id, 4);
    const results = await runQueuedOnRefereeLock(referee.id, [
      () => orderStatus.setStatus(o1.id, 'RETURNED'),
      () => affiliate.grantReferralReward(o2.id),
    ]);
    expect(summarize(results).errors).toEqual([]);
    const rows = await prisma.coinTransaction.findMany({ where: { userId: referrer.id }, select: { reason: true } });
    expect(rows).toEqual([]);
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(i3) thưởng GIỮ khoá trước, lần trả đơn đầu chờ khoá → thưởng rồi bị thu hồi đủ', async () => {
    const { referrer, referee } = await pair();
    const o1 = await deliveredOrder(referee.id, 9);
    const o2 = await deliveredOrder(referee.id, 4);
    const results = await runQueuedOnRefereeLock(referee.id, [
      () => affiliate.grantReferralReward(o2.id),
      () => orderStatus.setStatus(o1.id, 'RETURNED'),
    ]);
    expect(summarize(results).errors).toEqual([]);
    const reasons = (
      await prisma.coinTransaction.findMany({ where: { userId: referrer.id }, select: { reason: true } })
    ).map((r) => r.reason);
    expect(reasons.sort()).toEqual([`REFERRAL_ORDER2:${referee.id}`, `REFERRAL_ORDER2_REVOKE:${referee.id}`]);
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(k) đơn dưới referral.min_order_amount không tính là đơn đầu/đơn thứ 2', async () => {
    const { referrer, referee } = await pair();
    const cheap = await deliveredOrder(referee.id, 10, MIN_ORDER - 1);
    const o2 = await deliveredOrder(referee.id, 6);
    await affiliate.grantReferralReward(o2.id);
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });

    const o3 = await deliveredOrder(referee.id, 2);
    await affiliate.grantReferralReward(o3.id);
    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    const grant = await prisma.coinTransaction.findFirstOrThrow({
      where: { reason: `REFERRAL_ORDER2:${referee.id}` },
      select: { refId: true },
    });
    expect(grant.refId).toBe(`${o2.id}:${o3.id}`);
    expect(grant.refId).not.toContain(cheap.id);
  });

  /**
   * Một tx test giữ khoá dòng users của người được mời; chạy lần lượt từng thao tác và đợi tới khi
   * nó thật sự xếp hàng chờ khoá đó rồi mới chạy thao tác sau. Postgres trao khoá dòng cho người
   * chờ đầu tiên trước, nên thứ tự xếp hàng = thứ tự giành khoá.
   */
  async function runQueuedOnRefereeLock(refereeId: string, ops: (() => Promise<unknown>)[]) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let markLocked!: () => void;
    const locked = new Promise<void>((r) => (markLocked = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${refereeId} FOR UPDATE`;
        markLocked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await locked;
    const running: Promise<unknown>[] = [];
    try {
      for (const [i, op] of ops.entries()) {
        running.push(op());
        await waitForLockWaiters(i + 1);
      }
    } finally {
      release();
      await holder;
    }
    return Promise.allSettled(running);
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
 * REFERRAL_ORDER2:<guestId> vẫn mang id khách. Thu hồi và chặn thưởng trùng phải theo ĐƠN, không
 * theo chủ đơn hiện tại.
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
        CoinsService,
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
    await setConfig(prisma, 'coins.referrer_reward', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'coins.referral_milestones', []);
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

  async function coinsOf(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coinsBalance: true } });
    const sum = await prisma.coinTransaction.aggregate({ where: { userId }, _sum: { delta: true } });
    return { balance: u.coinsBalance, ledger: sum._sum.delta ?? 0 };
  }

  async function deliver(userId: string, daysAgo: number) {
    const o = await createOrder(prisma, {
      userId, status: 'SHIPPING', total: 250_000, subtotal: 250_000, createdAt: new Date(Date.now() - daysAgo * DAY),
    });
    await orderStatus.setStatus(o.id, 'DELIVERED');
    return o;
  }

  async function reasonsOf(userId: string) {
    const rows = await prisma.coinTransaction.findMany({ where: { userId }, select: { reason: true } });
    return rows.map((r) => r.reason).sort();
  }

  /** Khách G (người mời R) có O1, O2 đã giao → R đã nhận thưởng; rồi G gộp vào T. */
  async function rewardedGuestMergedInto(targetReferrerId: string | null) {
    const referrer = await createUser(prisma, { coinsBalance: 0 });
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, referredById: referrer.id });
    const target = await createUser(prisma, {
      zaloId: `zalo_${randCode(10)}`,
      referredById: targetReferrerId === 'SAME' ? referrer.id : targetReferrerId,
    });
    const o1 = await deliver(guest.id, 9);
    const o2 = await deliver(guest.id, 4);
    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });

    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    expect(await prisma.order.count({ where: { id: { in: [o1.id, o2.id] }, userId: target.id } })).toBe(2);
    return { referrer, guest, target, o1, o2 };
  }

  it('(g1) T cùng người mời R: đơn mới của T giao xong không thưởng lại cặp O1:O2; trả O1+O2 thu hồi đủ', async () => {
    const { referrer, guest, target, o1, o2 } = await rewardedGuestMergedInto('SAME');
    await deliver(target.id, 1);
    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await reasonsOf(referrer.id)).toEqual([`REFERRAL_ORDER2:${guest.id}`]);

    await orderStatus.setStatus(o1.id, 'RETURNED');
    await orderStatus.setStatus(o2.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await reasonsOf(referrer.id)).toEqual([`REFERRAL_ORDER2:${guest.id}`, `REFERRAL_ORDER2_REVOKE:${guest.id}`]);
  });

  it('(g2) T không có người mời: trả O1 sau gộp vẫn thu hồi thưởng của G; trả O2 không trừ thêm', async () => {
    const { referrer, guest, o1, o2 } = await rewardedGuestMergedInto(null);
    await orderStatus.setStatus(o1.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    await orderStatus.setStatus(o2.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await reasonsOf(referrer.id)).toEqual([`REFERRAL_ORDER2:${guest.id}`, `REFERRAL_ORDER2_REVOKE:${guest.id}`]);
  });

  it('(g3) T có người mời khác R2: R2 chỉ được thưởng từ 2 đơn chưa dùng của T, không từ O1:O2', async () => {
    const r2 = await createUser(prisma, { coinsBalance: 0 });
    const { referrer, target, o1 } = await rewardedGuestMergedInto(r2.id);
    await deliver(target.id, 2);
    expect(await coinsOf(r2.id)).toEqual({ balance: 0, ledger: 0 });
    const o4 = await deliver(target.id, 1);
    expect(await coinsOf(r2.id)).toEqual({ balance: REWARD, ledger: REWARD });
    const grant = await prisma.coinTransaction.findFirstOrThrow({
      where: { reason: `REFERRAL_ORDER2:${target.id}` },
      select: { refId: true },
    });
    expect(grant.refId?.split(':')).toContain(o4.id);
    expect(grant.refId?.split(':')).not.toContain(o1.id);

    // Trả O1 chỉ đụng thưởng của G (người mời R), không đụng thưởng của T.
    await orderStatus.setStatus(o1.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await coinsOf(r2.id)).toEqual({ balance: REWARD, ledger: REWARD });
  });

  it('(g4) không gộp: 2 người được mời cùng R, trả đơn của A chỉ thu hồi lượt của A', async () => {
    const referrer = await createUser(prisma, { coinsBalance: 0 });
    const a = await createUser(prisma, { referredById: referrer.id });
    const b = await createUser(prisma, { referredById: referrer.id });
    const a1 = await deliver(a.id, 9);
    await deliver(a.id, 4);
    await deliver(b.id, 9);
    await deliver(b.id, 4);
    expect(await coinsOf(referrer.id)).toEqual({ balance: 2 * REWARD, ledger: 2 * REWARD });

    await orderStatus.setStatus(a1.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await reasonsOf(referrer.id)).toEqual(
      [`REFERRAL_ORDER2:${a.id}`, `REFERRAL_ORDER2:${b.id}`, `REFERRAL_ORDER2_REVOKE:${a.id}`].sort(),
    );
  });
});

/**
 * Mốc thưởng thêm (coins.referral_milestones) là thưởng phái sinh của số lượt giới thiệu thành công:
 * lượt nào bị thu hồi làm số lượt còn hiệu lực tụt dưới mốc thì mốc đó cũng phải bị thu hồi.
 */
describe('Mốc thưởng giới thiệu bị thu hồi theo lượt giới thiệu (real Postgres)', () => {
  const MILESTONE = 20_000;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        CoinsService,
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
    await setConfig(prisma, 'coins.referrer_reward', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.min_order_amount', MIN_ORDER);
    await setConfig(prisma, 'coins.referral_milestones', [{ count: 2, bonus: MILESTONE }]);
  });

  afterAll(async () => {
    await setConfig(prisma, 'coins.referral_milestones', []);
    await moduleRef?.close();
  });

  async function coinsOf(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coinsBalance: true } });
    const sum = await prisma.coinTransaction.aggregate({ where: { userId }, _sum: { delta: true } });
    return { balance: u.coinsBalance, ledger: sum._sum.delta ?? 0 };
  }

  /** Một người được mời của `referrerId` có 2 đơn giao xong; trả về đơn thứ 2. */
  async function qualifiedReferee(referrerId: string) {
    const referee = await createUser(prisma, { referredById: referrerId, coinsBalance: 0 });
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

  async function milestoneRows(referrerId: string) {
    return prisma.coinTransaction.findMany({
      where: { userId: referrerId, refType: 'REFERRAL', reason: { startsWith: 'REFERRAL_MILESTONE' } },
      select: { reason: true, delta: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  it('(m1) đạt mốc rồi một lượt bị trả hàng → mốc bị thu hồi; trả lặp không trừ thêm', async () => {
    const referrer = await createUser(prisma, { coinsBalance: 0 });
    await qualifiedReferee(referrer.id);
    const b = await qualifiedReferee(referrer.id);
    expect(await coinsOf(referrer.id)).toEqual({ balance: 2 * REWARD + MILESTONE, ledger: 2 * REWARD + MILESTONE });

    await orderStatus.setStatus(b.o2.id, 'RETURNED');
    await orderStatus.setStatus(b.o2.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect((await milestoneRows(referrer.id)).map((r) => r.delta)).toEqual([MILESTONE, -MILESTONE]);
  });

  it('(m2) mốc đã thu hồi được cấp lại đúng 1 lần khi có lượt giới thiệu mới bù vào', async () => {
    const referrer = await createUser(prisma, { coinsBalance: 0 });
    await qualifiedReferee(referrer.id);
    const b = await qualifiedReferee(referrer.id);
    await orderStatus.setStatus(b.o2.id, 'RETURNED');
    await qualifiedReferee(referrer.id);
    expect(await coinsOf(referrer.id)).toEqual({ balance: 2 * REWARD + MILESTONE, ledger: 2 * REWARD + MILESTONE });
    expect((await milestoneRows(referrer.id)).map((r) => r.delta)).toEqual([MILESTONE, -MILESTONE, MILESTONE]);
  });

  it('(m3) người mời đã tiêu xu mốc → trừ phần còn lại, không âm, ghi REFERRAL_DEBT phần thiếu của mốc', async () => {
    const referrer = await createUser(prisma, { coinsBalance: 0 });
    await qualifiedReferee(referrer.id);
    const b = await qualifiedReferee(referrer.id);
    await moduleRef.get(CoinsService).spendCoins(referrer.id, 25_000, 'GAME_BUY_SEEDS', 'GAME');

    await orderStatus.setStatus(b.o2.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    const debts = await prisma.coinTransaction.findMany({
      where: { userId: referrer.id, refType: 'REFERRAL_DEBT' },
      select: { delta: true, reason: true },
    });
    // Còn 5000: lượt giới thiệu lấy đủ 5000 trước, mốc 20000 thiếu trọn.
    expect(debts.map((d) => d.delta)).toEqual([0]);
    expect(debts[0]!.reason).toMatch(/^REFERRAL_MILESTONE_DEBT:.*:20000$/);
  });

  it('(m4) 2 lượt bị trả song song → mốc chỉ bị thu hồi 1 lần, số dư khớp sổ', async () => {
    const referrer = await createUser(prisma, { coinsBalance: 0 });
    const a = await qualifiedReferee(referrer.id);
    const b = await qualifiedReferee(referrer.id);
    const results = await Promise.allSettled([
      orderStatus.setStatus(a.o2.id, 'RETURNED'),
      orderStatus.setStatus(b.o2.id, 'RETURNED'),
    ]);
    expect(summarize(results).errors).toEqual([]);
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect((await milestoneRows(referrer.id)).map((r) => r.delta)).toEqual([MILESTONE, -MILESTONE]);
  });
});
