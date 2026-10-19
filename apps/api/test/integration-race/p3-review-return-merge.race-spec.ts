import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import { reviewRewardLockKey } from '../../src/modules/reviews/review-eligibility';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { createOrder, createUser, randCode, setConfig, sleep, warmPool } from './helpers';

const UNIT = 100_000;
const PHOTO = ['https://res.cloudinary.com/it/review.jpg'];
const REWARD = 10_000;
const DAY = 86_400_000;

/**
 * P3 sau review đợt 1 (gói thuong-tra-hang): thưởng đánh giá sau lần trả, cờ rewardAvailable của canReview, và khoá đơn của
 * đánh giá đặt cạnh lần gộp phiên khách. Chạy ReviewsService, OrderReturnsService và AuthService thật trên Postgres thật.
 */
describe('Đánh giá sau trả hàng và gộp phiên khách (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reviews: ReviewsService;
  let returns: OrderReturnsService;
  let loyalty: LoyaltyService;
  let auth: AuthService;
  let admin: { id: string };
  let zaloIdForNextCall = '';
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        LoyaltyService,
        ReviewsService,
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
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    reviews = moduleRef.get(ReviewsService);
    returns = moduleRef.get(OrderReturnsService);
    loyalty = moduleRef.get(LoyaltyService);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    admin = await createUser(prisma, { role: 'ADMIN' });

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-p3', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function product(tag: string) {
    const p = await prisma.product.create({
      data: { pancakeId: `it-p3-p-${tag}`, brand: 'IT', slug: `it-p3-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-p3-v-${tag}`, productId: p.id, sku: `P3-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 50 },
    });
    return { p, v };
  }

  /** Đơn COD đã giao có đúng một sản phẩm `qty` chai. */
  async function deliveredOrder(userId: string, v: { id: string }, qty: number, deliveredAgoMs = 0) {
    const order = await createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: qty * UNIT,
      shippingFee: 0,
      total: qty * UNIT,
      deliveredAt: new Date(Date.now() - deliveredAgoMs),
      items: {
        create: [{ variationId: v.id, productName: 'SP', variationName: 'Chai', unitPrice: UNIT, quantity: qty, total: qty * UNIT, paidTotal: qty * UNIT }],
      },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { order, item };
  }

  async function returnLine(userId: string, o: { order: { code: string }; item: { id: string } }, quantity: number) {
    const req = await returns.request(userId, o.order.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: o.item.id, quantity }],
    });
    await returns.review(admin.id, req.id, { approve: true });
  }

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;
  const review = (userId: string, slug: string, orderId: string) =>
    reviews.create(userId, slug, { rating: 5, comment: 'tốt', images: PHOTO, orderId });

  describe('thưởng đánh giá sau lần trả (rewardAlreadyKept)', () => {
    it('đánh giá có thưởng, trả hết rồi mua lại: thưởng đã thu đủ nên đánh giá đơn mới được thưởng lại', async () => {
      const user = await createUser(prisma);
      touched.push(user.id);
      const a = await product(randCode(8));
      const o1 = await deliveredOrder(user.id, a.v, 1, 2 * DAY);
      expect((await review(user.id, a.p.slug, o1.order.id)).pointsEarned).toBe(REWARD);

      await returnLine(user.id, o1, 1);
      expect(await balance(user.id)).toBe(0);

      const o2 = await deliveredOrder(user.id, a.v, 1);
      const can = await reviews.canReview(user.id, a.p.slug);
      expect(can).toMatchObject({ canReview: true, rewardAvailable: true });
      expect((await review(user.id, a.p.slug, o2.order.id)).pointsEarned).toBe(REWARD);
      expect(await balance(user.id)).toBe(REWARD);
    });

    it('thu hồi chỉ được một phần (khách đã tiêu bớt): phần còn lại vẫn là thưởng đang giữ nên đơn mới không được thưởng thêm', async () => {
      const user = await createUser(prisma);
      touched.push(user.id);
      const a = await product(randCode(8));
      const o1 = await deliveredOrder(user.id, a.v, 1, 2 * DAY);
      await review(user.id, a.p.slug, o1.order.id);
      await prisma.$transaction([
        prisma.pointsTransaction.create({ data: { userId: user.id, delta: -5_000, reason: 'IT_SPEND', refType: 'GAME' } }),
        prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { decrement: 5_000 } } }),
      ]);

      await returnLine(user.id, o1, 1);
      expect(await balance(user.id)).toBe(0);

      const o2 = await deliveredOrder(user.id, a.v, 1);
      expect(await reviews.canReview(user.id, a.p.slug)).toMatchObject({ canReview: true, rewardAvailable: false });
      expect((await review(user.id, a.p.slug, o2.order.id)).pointsEarned).toBe(0);
    });
  });

  describe('canReview.rewardAvailable theo từng đơn', () => {
    it('sản phẩm đã có dòng trả được duyệt trên đơn duy nhất có thể đánh giá: không hứa thưởng', async () => {
      const user = await createUser(prisma);
      touched.push(user.id);
      const a = await product(randCode(8));
      const o1 = await deliveredOrder(user.id, a.v, 2, 2 * DAY);
      await returnLine(user.id, o1, 1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o1.order.id } })).status).toBe('DELIVERED');

      const can = await reviews.canReview(user.id, a.p.slug);
      expect(can).toMatchObject({ canReview: true, rewardAvailable: false });
      expect((await review(user.id, a.p.slug, o1.order.id)).pointsEarned).toBe(0);
    });

    it('có thêm đơn khác chưa trả: đơn đó đứng đầu danh sách (đơn FE chọn mặc định) và có thưởng', async () => {
      const user = await createUser(prisma);
      touched.push(user.id);
      const a = await product(randCode(8));
      const o1 = await deliveredOrder(user.id, a.v, 2, 3 * DAY);
      await returnLine(user.id, o1, 1);
      const o2 = await deliveredOrder(user.id, a.v, 1);

      const can = await reviews.canReview(user.id, a.p.slug);
      if (!can.canReview) throw new Error('phải viết được đánh giá');
      expect(can.rewardAvailable).toBe(true);
      expect(can.reviewableOrders.map((o) => o.orderId)).toEqual([o2.order.id, o1.order.id]);
      expect((await review(user.id, a.p.slug, can.reviewableOrders[0]!.orderId)).pointsEarned).toBe(REWARD);
    });
  });

  describe('khoá đơn của đánh giá và gộp phiên khách', () => {
    async function guestAndTarget() {
      const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, fullName: 'Khách' });
      const target = await createUser(prisma, { zaloId: `zalo_${randCode(10)}` });
      touched.push(guest.id, target.id);
      return { guest, target };
    }

    async function waitFor(cond: () => Promise<boolean>, what: string) {
      for (let i = 0; i < 100; i++) {
        if (await cond()) return;
        await sleep(50);
      }
      throw new Error(`quá hạn chờ: ${what}`);
    }

    it('đánh giá đang giữ khoá đơn (chờ khoá cặp) lúc gộp phiên bắt đầu: cả hai xong, không deadlock (40P01)', async () => {
      const { guest, target } = await guestAndTarget();
      const a = await product(randCode(8));
      const o = await deliveredOrder(guest.id, a.v, 1, DAY);

      let release!: () => void;
      let held!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const holding = new Promise<void>((r) => (held = r));
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reviewRewardLockKey(guest.id, a.p.id)}))`;
          held();
          await gate;
        },
        { timeout: 30_000 },
      );
      await holding;

      const writing = review(guest.id, a.p.slug, o.order.id);
      await waitFor(
        async () => ((await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)[0]?.n ?? 0) >= 1,
        'đánh giá chờ khoá cặp',
      );
      zaloIdForNextCall = target.zaloId!;
      const merging = auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
      await sleep(400);
      release();
      await holder;

      const [w, m] = await Promise.allSettled([writing, merging]);
      expect(w.status).toBe('fulfilled');
      expect(m.status).toBe('fulfilled');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).userId).toBe(target.id);
    });

    it('đơn đã chuyển sang tài khoản đích giữa lúc đọc và lúc ghi: đánh giá của phiên khách cũ bị từ chối, không thưởng điểm cho khách đã gộp', async () => {
      const { guest, target } = await guestAndTarget();
      const a = await product(randCode(8));
      const o = await deliveredOrder(guest.id, a.v, 1, DAY);

      const real = loyalty.pointsExpiresAt.bind(loyalty);
      jest.spyOn(loyalty, 'pointsExpiresAt').mockImplementationOnce(async (from: Date) => {
        zaloIdForNextCall = target.zaloId!;
        await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
        return real(from);
      });

      await expect(review(guest.id, a.p.slug, o.order.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(await prisma.review.count({ where: { orderId: o.order.id } })).toBe(0);
      expect(await prisma.pointsTransaction.count({ where: { userId: guest.id, refType: 'REVIEW' } })).toBe(0);
    });
  });

  describe('lời từ chối khi đơn vừa bị trả', () => {
    it('đơn bị trả cả đơn giữa lúc đọc và lúc ghi: nói đơn đã trả hàng, không nói "chưa giao tới bạn"', async () => {
      const user = await createUser(prisma);
      touched.push(user.id);
      const a = await product(randCode(8));
      const o = await deliveredOrder(user.id, a.v, 1, DAY);

      const real = loyalty.pointsExpiresAt.bind(loyalty);
      jest.spyOn(loyalty, 'pointsExpiresAt').mockImplementationOnce(async (from: Date) => {
        await returnLine(user.id, o, 1);
        return real(from);
      });

      const err = await review(user.id, a.p.slug, o.order.id).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toMatch(/đã trả hàng/);
      expect((err as BadRequestException).message).not.toMatch(/chưa giao tới bạn/);
      expect(await prisma.review.count({ where: { orderId: o.order.id } })).toBe(0);
    });
  });
});
